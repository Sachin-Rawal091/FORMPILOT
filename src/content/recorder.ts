import { Step, Action, SelectorMeta, FormPilotMessage, MessageType, ExecutionState, ExecutionStatus } from "../types";
import { INPUT_DEBOUNCE_MS, DOUBLE_CLICK_WINDOW_MS, XPATH_MAX_DEPTH, SUBMIT_LATCH_SAFETY_MS } from "../shared/constants";
import { logger } from "../utils/logger";

export class RecordingEngine {
  private isRecording = false;
  private recordingId = "";
  private currentStepIndex = 0;
  private lastClickTime = 0;
  private lastClickedElement: HTMLElement | null = null;
  private debounceTimers: WeakMap<HTMLElement, ReturnType<typeof setTimeout>> = new WeakMap();
  private activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  // BUG-NEW-1 fix: replaces the old lastButtonSubmitTime timestamp comparison.
  // true once a submit-type click has been recorded synchronously, until either
  // the correlated native submit event is observed or the safety timer clears it.
  private recentClickWasSubmit = false;
  private submitLatchSafetyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.setupMessageListener();
    this.setupDOMEventListeners();
    this.restoreRecordingState();
    (globalThis as any).__FP_RECORDER_INSTANCE__ = this;
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message: FormPilotMessage) => {
      switch (message.type) {
        case MessageType.START_RECORDING:
          this.isRecording = true;
          this.recordingId = (message.payload as { recordingId: string })?.recordingId || "default";
          this.currentStepIndex = 0;
          logger.info('Recorder', `Recording started for session ID: ${message.sessionId}, recordingId: ${this.recordingId}`);
          break;
        case MessageType.STOP_RECORDING:
        case MessageType.START_EXECUTION:
          this.isRecording = false;
          // Clear all pending debounce timers to prevent steps being recorded after stop
          this.activeTimers.forEach(timer => clearTimeout(timer));
          this.activeTimers.clear();
          // BUG-NEW-1 fix: also reset the submit latch so state doesn't leak into a
          // subsequent recording session.
          if (this.submitLatchSafetyTimer) {
            clearTimeout(this.submitLatchSafetyTimer);
            this.submitLatchSafetyTimer = null;
          }
          this.recentClickWasSubmit = false;
          logger.info('Recorder', `Recording stopped/prevented due to message type: ${MessageType[message.type]}`);
          break;
      }
    });
  }

  private restoreRecordingState() {
    // Gate on lightweight local storage check before waking the service worker
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get('isRecordingActive', (result) => {
        if (chrome.runtime.lastError) {
          logger.warn('Recorder', 'Local storage check failed:', chrome.runtime.lastError.message);
          return;
        }
        // Only send GET_STATUS if there's evidence of an active recording
        if (!result || !result.isRecordingActive) {
          logger.debug('Recorder', 'No recording active in local storage, skipping GET_STATUS.');
          return;
        }

        logger.debug('Recorder', 'Recording state found in local storage, sending GET_STATUS...');
        chrome.runtime.sendMessage({
          type: MessageType.GET_STATUS,
          sessionId: "",
          payload: {},
          timestamp: Date.now()
        }, (response) => {
          if (chrome.runtime.lastError) {
            logger.warn('Recorder', 'GET_STATUS failed:', chrome.runtime.lastError.message);
            return;
          }
          logger.debug('Recorder', 'GET_STATUS response received:', JSON.stringify(response));
          if (response && response.recordingState) {
            const state = response.recordingState;
            if (state.isRecording) {
              this.isRecording = true;
              this.recordingId = state.recordingId || "default";
              this.currentStepIndex = state.activeRecordingSteps ? state.activeRecordingSteps.length : 0;
              logger.info('Recorder', `Restored recording state. isRecording: true, recordingId: ${this.recordingId}, stepIndex: ${this.currentStepIndex}`);
            }
          }
        });
      });
    } catch (err) {
      logger.error('Recorder', 'Error checking recording state:', err);
    }
  }

  private setupDOMEventListeners() {
    // Standard actions
    document.addEventListener("click", (e) => this.handleClickEvent(e), true);
    document.addEventListener("input", (e) => this.handleInputEvent(e), true);
    document.addEventListener("change", (e) => this.handleChangeEvent(e), true);
    
    // File upload drag & drop actions
    document.addEventListener("dragover", (e) => e.preventDefault(), true);
    document.addEventListener("drop", (e) => this.handleDropEvent(e), true);

    // Form submits
    document.addEventListener("submit", (e) => this.handleSubmitEvent(e), true);

    // Navigation tracking
    window.addEventListener("popstate", () => this.handleNavigationEvent());
    window.addEventListener("hashchange", () => this.handleNavigationEvent());
    // BUG-NEW-3 fix: Track pushState/replaceState for SPA navigation (React Router, Next.js, Vue Router)
    window.addEventListener("fp:locationchange", () => this.handleNavigationEvent());
    this.wrapHistoryMethods();
    
    logger.debug('Recorder', 'DOM event listeners attached.');
  }

  private handleNavigationEvent() {
    if (!this.isRecording) return;
    chrome.runtime.sendMessage({
      type: MessageType.PAGE_NAVIGATED,
      sessionId: this.recordingId,
      payload: { url: window.location.href },
      timestamp: Date.now()
    }).catch((err) => {
      logger.warn('Recorder', 'PAGE_NAVIGATED message failed:', err);
    });
  }

  /**
   * BUG-NEW-3 fix: Monkey-patch history.pushState/replaceState to dispatch navigation events.
   * pushState/replaceState do not fire popstate — this is the standard approach for SPA tracking.
   */
  private wrapHistoryMethods() {
    // Guard: don't double-wrap if content script re-injects on the same page
    if ((history.pushState as any).__fpWrapped) return;
    // Note: originals may themselves already be wrappers (e.g. from analytics or other extensions).
    // Capturing whatever is currently installed preserves the existing chain.
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      originalPushState.apply(this, args);
      window.dispatchEvent(new Event('fp:locationchange'));
    };
    (history.pushState as any).__fpWrapped = true;
    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('fp:locationchange'));
    };
    (history.replaceState as any).__fpWrapped = true;
  }

  private handleClickEvent(e: MouseEvent) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    // Skip recording clicks on checkboxes, radios, or their associated labels/containers
    // to prevent double-recording (the native change handler will record TOGGLE_CHECKBOX / SELECT_RADIO)
    if (this.isCheckboxOrRadioOrLabel(el)) {
      return;
    }

    logger.debug('Recorder', `Click event on <${el.tagName.toLowerCase()}> id=${el.id || 'none'} type=${el.getAttribute('type') || 'none'}`);

    const tagName = el.tagName.toLowerCase();

    // Ignore normal value inputs but allow submit buttons/inputs to be clicked and recorded
    if (tagName === "input" || tagName === "textarea") {
      const typeAttr = el.getAttribute("type")?.toLowerCase() || "";
      if (typeAttr !== "submit" && typeAttr !== "button" && typeAttr !== "image") {
        return;
      }
    }

    // BUG-NEW-2 fix: Skip native <select>/<option> clicks — handleChangeEvent owns SELECT recording
    if (tagName === "select" || tagName === "option") {
      return;
    }

    const button = el.closest("button");
    const targetElement = button || el;

    // Track submit button clicks to deduplicate subsequent form submit events
    const isSubmitButton = 
      (button && (button.getAttribute("type") || "submit") === "submit") ||
      (tagName === "input" && el.getAttribute("type") === "submit");

    if (isSubmitButton) {
      // BUG-NEW-1 fix: record the submit-type click synchronously, before any
      // deferred timer. If the click triggers real page navigation, the deferred
      // checkChanges chain (up to 500ms out) would never get a chance to run —
      // this was silently losing the exact "Save & Continue" step the extension
      // exists to automate. Prefer the enclosing <form> as the recorded element
      // to match how handleSubmitEvent has always recorded SUBMIT steps (and how
      // ExecutionEngine's Action.SUBMIT handler expects to receive one); fall
      // back to the button itself if there's no enclosing form.
      const formEl = targetElement.closest("form") as HTMLFormElement | null;
      this.addRecordedStep(Action.SUBMIT, formEl || targetElement);

      this.recentClickWasSubmit = true;
      if (this.submitLatchSafetyTimer) {
        clearTimeout(this.submitLatchSafetyTimer);
      }
      this.submitLatchSafetyTimer = setTimeout(() => {
        this.recentClickWasSubmit = false;
        this.submitLatchSafetyTimer = null;
      }, SUBMIT_LATCH_SAFETY_MS);
    }

    // Deduplication of double-clicks
    const now = Date.now();
    if (now - this.lastClickTime < DOUBLE_CLICK_WINDOW_MS && this.lastClickedElement === targetElement) {
      return;
    }
    this.lastClickTime = now;
    this.lastClickedElement = targetElement;

    // Capture values of all inputs on the page before they are programmatically modified by page scripts
    const inputsBeforeClick = new Map<HTMLInputElement | HTMLTextAreaElement, string>();
    document.querySelectorAll("input, textarea").forEach((input) => {
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        inputsBeforeClick.set(input, input.value);
      }
    });

    let programmaticChangeDetected = false;
    const recordedInputs = new Set<HTMLInputElement | HTMLTextAreaElement>();

    const checkChanges = () => {
      let changeFound = false;
      inputsBeforeClick.forEach((oldValue, inputEl) => {
        if (!document.body.contains(inputEl)) return;
        const newValue = inputEl.value;
        if (newValue !== oldValue && !recordedInputs.has(inputEl)) {
          // If the new value is empty, it's likely a form reset/clear, ignore it
          if (newValue === "" && oldValue !== "") {
            return;
          }

          recordedInputs.add(inputEl);
          changeFound = true;
          programmaticChangeDetected = true;
          logger.info('Recorder', `Detected programmatic value change on <${inputEl.tagName.toLowerCase()}> after click: "${oldValue}" -> "${newValue}"`);
          
          const isDateInput = 
            inputEl.type === 'date' || 
            inputEl.classList.contains('datepicker') || 
            inputEl.classList.contains('rmdp-input') || 
            inputEl.classList.contains('flatpickr-input') ||
            /date|calendar|picker|dob|birth|expiry/i.test(inputEl.name || inputEl.id || inputEl.className || '');
          
          const action = isDateInput ? Action.DATEPICKER : Action.FILL;
          this.addRecordedStep(action, inputEl, newValue);
        }
      });
      return changeFound;
    };

    // Run programmatic change checks at intervals to handle varying framework speeds: 50ms, 150ms, 300ms, 500ms
    const intervals = [50, 150, 300, 500];
    intervals.forEach((delay, idx) => {
      const timer = setTimeout(() => {
        checkChanges();
        this.activeTimers.delete(timer);

        // On the final check interval, if no programmatic changes occurred, record the click if appropriate
        if (idx === intervals.length - 1) {
          // BUG-NEW-1 fix: submit-type clicks were already recorded synchronously
          // above as Action.SUBMIT — skip the CLICK/SELECT fallback entirely for them.
          if (isSubmitButton) {
            return;
          }

          const isControlClick = this.isButtonOrLink(targetElement) && !this.isInsideDatePicker(targetElement);

          // BUG-042: Clicks inside a date picker (or on a calendar backdrop/overlay/popup wrapper)
          // should NEVER be recorded as separate CLICK steps, because the DATEPICKER action
          // handles the entire click -> navigate -> select -> close sequence internally.
          // Recording these clicks causes automation to stall on empty/closed calendar elements.
          if (!this.isInsideDatePicker(targetElement)) {
            // If no input was changed programmatically, or it is a control click, record the click
            if (!programmaticChangeDetected || isControlClick) {
              const selectEl = el.tagName.toLowerCase() === "select" ? el : el.closest("select");
              if (selectEl) {
                const selectVal = (selectEl as HTMLSelectElement).value;
                this.addRecordedStep(Action.SELECT, selectEl, selectVal);
              } else {
                this.addRecordedStep(Action.CLICK, targetElement);
              }
            }
          }
        }
      }, delay);
      this.activeTimers.add(timer);
    });
  }

  private isButtonOrLink(el: HTMLElement): boolean {
    const tagName = el.tagName.toLowerCase();
    if (tagName === "button" || tagName === "a") return true;
    if (el.closest("button") || el.closest("a")) return true;
    if (el.getAttribute("role") === "button") return true;
    
    // Check classes
    const classList = Array.from(el.classList);
    // BUG-NEW-9 fix: anchor the pattern so substrings like "disabled-button-label"
    // don't false-positive as a control click. We only want to match when "btn" or "button"
    // is a standalone word or term (e.g. "btn-primary", "primary-btn"), not a partial substring.
    if (classList.some(c => /^(?:btn|button)(?:[-_].*)?$/i.test(c) || /^.*[-_](?:btn|button)$/i.test(c))) return true;
    
    return false;
  }

  private isInsideDatePicker(el: HTMLElement): boolean {
    let current: HTMLElement | null = el;
    while (current && current !== document.body) {
      const idOrClass = (current.id || "") + " " + (current.className || "");
      // BUG-NEW-7 fix: Removed generic 'backdrop'/'overlay' terms that over-matched
      // MUI modals, Bootstrap dropdowns, and AntD components.
      if (/datepicker|calendar|rmdp|flatpickr|ui-datepicker/i.test(idOrClass)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  private handleInputEvent(e: Event) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    logger.debug('Recorder', `Input event on <${el.tagName.toLowerCase()}> id=${el.id || 'none'} isRecording=${this.isRecording}`);

    const tagName = el.tagName.toLowerCase();
    const typeAttr = el.getAttribute("type")?.toLowerCase() || "";

    // Handled under change event
    if (typeAttr === "checkbox" || typeAttr === "radio" || tagName === "select" || typeAttr === "file") {
      return;
    }

    // Handle standard inputs/textareas with debouncing to capture finalized values only
    if (tagName === "input" || tagName === "textarea" || el.isContentEditable) {
      const existingTimer = this.debounceTimers.get(el);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.activeTimers.delete(existingTimer);
      }

      const timer = setTimeout(() => {
        const value = el.isContentEditable ? el.innerText : (el as HTMLInputElement).value;
        const isRichText = el.isContentEditable || el.classList.contains("mce-content-body") || el.classList.contains("ql-editor");
        
        this.addRecordedStep(isRichText ? Action.RICH_TEXT : Action.FILL, el, value);
        this.debounceTimers.delete(el);
        this.activeTimers.delete(timer);
      }, INPUT_DEBOUNCE_MS);

      this.debounceTimers.set(el, timer);
      this.activeTimers.add(timer);
    }
  }

  private handleChangeEvent(e: Event) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    const tagName = el.tagName.toLowerCase();
    const typeAttr = el.getAttribute("type")?.toLowerCase() || "";

    if (tagName === "select") {
      const selectVal = (el as HTMLSelectElement).value;
      this.addRecordedStep(Action.SELECT, el, selectVal);
    } else if (tagName === "input") {
      if (typeAttr === "checkbox") {
        const isChecked = (el as HTMLInputElement).checked;
        this.addRecordedStep(Action.TOGGLE_CHECKBOX, el, isChecked ? "true" : "false", isChecked);
      } else if (typeAttr === "radio") {
        const radioVal = (el as HTMLInputElement).value;
        this.addRecordedStep(Action.SELECT_RADIO, el, radioVal);
      } else if (typeAttr === "file") {
        const fileInput = el as HTMLInputElement;
        const fileName = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0].name : "";
        this.addRecordedStep(Action.FILE_UPLOAD, el, fileName);
      }
    }
  }

  private handleDropEvent(e: DragEvent) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    // Check if files were dropped
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filename = e.dataTransfer.files[0].name;
      this.addRecordedStep(Action.FILE_UPLOAD, el, filename);
    }
  }

  private handleSubmitEvent(e: SubmitEvent) {
    if (!this.isRecording) return;

    const formEl = e.target as HTMLFormElement;
    if (!formEl) return;

    // BUG-NEW-1 / BUG-NEW-9 fix: use the synchronous-recording latch instead of a
    // fixed timestamp window. A fixed window can't simultaneously be "long enough"
    // for slow validation/captcha-gated submits and "short enough" not to eat a
    // genuinely separate second submit — the latch is cleared deterministically by
    // whichever happens first: this event firing, or the safety timeout.
    if (this.recentClickWasSubmit) {
      logger.info('Recorder', 'Ignored native submit event because it was already recorded synchronously on click.');
      this.recentClickWasSubmit = false;
      if (this.submitLatchSafetyTimer) {
        clearTimeout(this.submitLatchSafetyTimer);
        this.submitLatchSafetyTimer = null;
      }
      return;
    }

    // No preceding click recorded this submit (e.g. Enter-key submission) — record directly.
    this.addRecordedStep(Action.SUBMIT, formEl);
  }

  private addRecordedStep(action: Action, el: HTMLElement, value = "", checked?: boolean) {
    const selectorMeta = this.generateSelectorMeta(el);
    const primarySelector = selectorMeta.cssPath || el.tagName.toLowerCase();

    // Mapping steps to the active page flow context
    const currentUrl = window.location.href;
    const urlPath = window.location.pathname.replace(/[^a-zA-Z0-9]/g, "_");
    const pageId = "page_" + window.location.hostname.replace(/\./g, "_") + urlPath;

    const newStep: Step = {
      id: this.generateUUID(),
      action,
      selector: primarySelector,
      selectorMeta,
      value,
      pageId,
      checked,
      required: (el as any).required === true || el.hasAttribute('required'),
      retryable: true,
      maxRetries: 3,
      expectedType: action === Action.DATEPICKER ? "date" : undefined
    };

    // Mutually exclude recording events if an automation run is currently active
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.get('executionState', (result) => {
        if (chrome.runtime.lastError) {
          logger.warn('Recorder', 'Session storage check failed:', chrome.runtime.lastError.message);
          this.sendRecordingEvent(newStep, currentUrl);
          return;
        }
        const execState = result?.executionState as ExecutionState | undefined;
        if (execState) {
          const status = execState.status;
          // Ignore event if status is RUNNING (1), PAUSED (2), or CAPTCHA_PAUSED (3)
          if (
            status === ExecutionStatus.RUNNING ||
            status === ExecutionStatus.PAUSED ||
            status === ExecutionStatus.CAPTCHA_PAUSED
          ) {
            logger.warn('Recorder', 'Ignored recording step because execution is active.', { status });
            return;
          }
        }
        this.sendRecordingEvent(newStep, currentUrl);
      });
    } else {
      this.sendRecordingEvent(newStep, currentUrl);
    }
  }

  private sendRecordingEvent(newStep: Step, currentUrl: string) {
    logger.debug('Recorder', 'Recorded Step:', newStep);

    // Send the recorded step to service worker which persists it and forwards to popup
    chrome.runtime.sendMessage({
      type: MessageType.RECORDING_EVENT,
      sessionId: this.recordingId,
      payload: {
        step: newStep,
        url: currentUrl,
        stepIndex: this.currentStepIndex++
      },
      timestamp: Date.now()
    }).catch(err => {
      logger.error('Recorder', 'Failed to send step to service worker:', err);
    });
  }

  private generateSelectorMeta(el: HTMLElement): SelectorMeta {
    const meta: SelectorMeta = {};

    if (el.id) {
      meta.id = el.id;
    }

    const name = el.getAttribute("name");
    if (name) {
      meta.name = name;
    }

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      meta.ariaLabel = ariaLabel;
    }

    const placeholder = el.getAttribute("placeholder");
    if (placeholder) {
      meta.placeholder = placeholder;
    }

    // Try label finding
    meta.labelText = this.findAssociatedLabel(el);

    // BUG-NEW-6 fix: Capture data-testid and role for higher-fidelity selector metadata
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
    if (testId) {
      meta.testId = testId;
    }
    const role = el.getAttribute("role");
    if (role) {
      meta.role = role;
    }

    meta.cssPath = this.generateCssPath(el);
    meta.xpath = this.generateXPath(el);

    return meta;
  }

  private escapeValue(val: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(val);
    }
    return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private isDynamicId(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    // BUG-NEW-8 fix: Added chakra-/mantine- for Chakra UI and Mantine hash-style IDs
    if (/^(radix|headlessui|mui|jss|ng|ember|__BuiOuter|react-select-|dp-|chakra-|mantine-)/i.test(id)) {
      return true;
    }
    if (/:/.test(id)) {
      return true;
    }
    if (/\d{4,}/.test(id)) {
      return true;
    }
    if (/[-_]\d+$/.test(id)) {
      return true;
    }
    return false;
  }

  private cleanLabelText(label: HTMLElement): string {
    if (!label || !label.childNodes) return "";
    return Array.from(label.childNodes)
      .filter(n => n && n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent?.trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private findAssociatedLabel(el: HTMLElement): string | undefined {
    if (!el) return undefined;
    const elId = typeof el.getAttribute === 'function' ? el.getAttribute("id") : null;
    
    // 1. Explicit label with 'for' attribute matching el.id
    if (elId) {
      try {
        const label = document.querySelector(`label[for="${this.escapeValue(elId)}"]`);
        if (label && label.textContent) {
          return label.textContent.trim();
        }
      } catch (e) {
        // ignore invalid selector
      }
    }

    // 2. Nested label
    const parentLabel = typeof el.closest === 'function' ? el.closest("label") : null;
    if (parentLabel) {
      return this.cleanLabelText(parentLabel);
    }

    // 3. Sibling label (e.g., label is preceding sibling or inside preceding sibling)
    const container = typeof el.closest === 'function'
      ? el.closest(".form-group, .col-md-6, .col-sm-6, .form-row, td, tr") || el.parentElement
      : el.parentElement;
    if (container && typeof container.querySelector === 'function') {
      try {
        const label = container.querySelector("label");
        if (label && label.textContent) {
          return label.textContent.trim();
        }
        
        const customLabel = container.querySelector(".form-label, .control-label, strong, b");
        if (customLabel && customLabel.textContent) {
          return customLabel.textContent.trim();
        }
      } catch (e) {
        // ignore invalid selector
      }
    }

    // 4. Preceding sibling label
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.tagName === "LABEL" || prev.classList.contains("form-label")) {
        if (prev.textContent) {
          return prev.textContent.trim();
        }
      }
      prev = prev.previousElementSibling;
    }

    return undefined;
  }

  private generateCssPath(el: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = el;

    while (current && current !== document.body && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      const nameAttr = typeof current.getAttribute === 'function' ? current.getAttribute("name") : null;
      const curId = typeof current.getAttribute === 'function' ? current.getAttribute("id") : null;

      if (curId && !this.isDynamicId(curId)) {
        selector += `#${this.escapeValue(curId)}`;
        path.unshift(selector);
        break; // Unique stable ID, stop climbing
      } else if (nameAttr && !/^(radix|headlessui|react-select)/i.test(nameAttr)) {
        selector += `[name="${this.escapeValue(nameAttr)}"]`;
        try {
          if (document.querySelectorAll(`[name="${this.escapeValue(nameAttr)}"]`).length === 1) {
            path.unshift(selector);
            break;
          }
        } catch (e) {
          // ignore invalid querySelector
        }
        // BUG-NEW-4 fix: Name not globally unique (e.g. radio groups, repeated form rows).
        // Fall through to sibling-counting disambiguation.
        let nameSib = current.previousElementSibling;
        let nameNth = 1;
        while (nameSib) {
          if (nameSib.nodeName.toLowerCase() === current.nodeName.toLowerCase()) {
            nameNth++;
          }
          nameSib = nameSib.previousElementSibling;
        }
        const nameCurrNodeName = current.nodeName;
        const nameHasSameTypeSiblings = current.parentElement
          ? Array.from(current.parentElement.children)
              .filter(c => c.nodeName === nameCurrNodeName).length > 1
          : false;
        if (nameHasSameTypeSiblings) {
          selector += `:nth-of-type(${nameNth})`;
        }
      } else {
        let sib = current.previousElementSibling;
        let nth = 1;
        while (sib) {
          if (sib.nodeName.toLowerCase() === current.nodeName.toLowerCase()) {
            nth++;
          }
          sib = sib.previousElementSibling;
        }
        const currNodeName = current.nodeName;
        const hasSameTypeSiblings = current.parentElement
          ? Array.from(current.parentElement.children)
              .filter(c => c.nodeName === currNodeName).length > 1
          : false;
        if (hasSameTypeSiblings) {
          selector += `:nth-of-type(${nth})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(" > ");
  }

  private generateXPath(el: HTMLElement): string {
    const elId = typeof el.getAttribute === 'function' ? el.getAttribute("id") : null;
    if (elId && !this.isDynamicId(elId)) {
      return `//*[@id="${this.escapeValue(elId)}"]`;
    }

    const paths: string[] = [];
    let current: HTMLElement | null = el;
    let depth = 0;
    let anchor: string | null = null;

    while (current && current.nodeType === Node.ELEMENT_NODE && depth < XPATH_MAX_DEPTH) {
      const curId = typeof current.getAttribute === 'function' ? current.getAttribute("id") : null;
      // If we find an ancestor with a stable ID, anchor to it
      if (current !== el && curId && !this.isDynamicId(curId)) {
        anchor = `//*[@id="${this.escapeValue(curId)}"]`;
        break;
      }

      const tagName = current.nodeName.toLowerCase();
      if (current !== el && (tagName === "form" || tagName === "fieldset")) {
        if (curId && !this.isDynamicId(curId)) {
          anchor = `//${tagName}[@id="${this.escapeValue(curId)}"]`;
        } else {
          anchor = `//${tagName}`;
        }
        break;
      }

      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const pathIndex = index > 0 ? `[${index + 1}]` : "";
      paths.unshift(`${tagName}${pathIndex}`);
      
      current = current.parentElement;
      depth++;
    }

    if (anchor) {
      return `${anchor}/${paths.join("/")}`;
    }

    return paths.length ? `//${paths.join("/")}` : "";
  }

  private isCheckboxOrRadioOrLabel(el: HTMLElement): boolean {
    const tagName = el.tagName.toLowerCase();
    if (tagName === "input") {
      const type = (el as HTMLInputElement).type?.toLowerCase();
      if (type === "checkbox" || type === "radio") {
        return true;
      }
    }
    if (tagName === "label") {
      const label = el as HTMLLabelElement;
      if (label.htmlFor) {
        const target = document.getElementById(label.htmlFor);
        if (target instanceof HTMLInputElement) {
          const type = target.type?.toLowerCase();
          if (type === "checkbox" || type === "radio") {
            return true;
          }
        }
      }
      if (label.querySelector('input[type="checkbox"], input[type="radio"]')) {
        return true;
      }
    }
    const parentLabel = el.closest("label");
    if (parentLabel) {
      if (parentLabel.htmlFor) {
        const target = document.getElementById(parentLabel.htmlFor);
        if (target instanceof HTMLInputElement) {
          const type = target.type?.toLowerCase();
          if (type === "checkbox" || type === "radio") {
            return true;
          }
        }
      }
      if (parentLabel.querySelector('input[type="checkbox"], input[type="radio"]')) {
        return true;
      }
    }
    if (el.querySelector('input[type="checkbox"], input[type="radio"]')) {
      return true;
    }
    return false;
  }

  private generateUUID(): string {
    // BUG-040: Use crypto.randomUUID() for cryptographically strong UUIDs
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Instantiate the recorder with singleton guard
if (typeof window !== 'undefined' && !(globalThis as any).__FP_RECORDER_INIT__) {
  (globalThis as any).__FP_RECORDER_INIT__ = true;
  new RecordingEngine();
}
