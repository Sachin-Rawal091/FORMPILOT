import { Step, Action, SelectorMeta, FormPilotMessage, MessageType, ExecutionState, ExecutionStatus } from "../types";
import { INPUT_DEBOUNCE_MS, DOUBLE_CLICK_WINDOW_MS } from "../shared/constants";
import { logger } from "../utils/logger";

class RecordingEngine {
  private isRecording = false;
  private recordingId = "";
  private currentStepIndex = 0;
  private lastClickTime = 0;
  private lastClickedElement: HTMLElement | null = null;
  private debounceTimers: WeakMap<HTMLElement, ReturnType<typeof setTimeout>> = new WeakMap();
  private activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private lastButtonSubmitTime = 0;

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

  private handleClickEvent(e: MouseEvent) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    logger.debug('Recorder', `Click event on <${el.tagName.toLowerCase()}> id=${el.id || 'none'} type=${el.getAttribute('type') || 'none'}`);

    const tagName = el.tagName.toLowerCase();

    // Ignore normal value inputs but allow submit buttons/inputs to be clicked and recorded
    if (tagName === "input" || tagName === "select" || tagName === "textarea") {
      const typeAttr = el.getAttribute("type")?.toLowerCase() || "";
      if (typeAttr !== "submit" && typeAttr !== "button" && typeAttr !== "image") {
        return;
      }
    }

    const button = el.closest("button");
    const targetElement = button || el;

    // Track submit button clicks to deduplicate subsequent form submit events
    const isSubmitButton = 
      (button && (button.getAttribute("type") || "submit") === "submit") ||
      (tagName === "input" && el.getAttribute("type") === "submit");

    if (isSubmitButton) {
      this.lastButtonSubmitTime = Date.now();
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
          const isControlClick = this.isButtonOrLink(targetElement) && !this.isInsideDatePicker(targetElement);

          // BUG-042: Clicks inside a date picker (or on a calendar backdrop/overlay/popup wrapper)
          // should NEVER be recorded as separate CLICK steps, because the DATEPICKER action
          // handles the entire click -> navigate -> select -> close sequence internally.
          // Recording these clicks causes automation to stall on empty/closed calendar elements.
          if (!this.isInsideDatePicker(targetElement)) {
            // If no input was changed programmatically, or it is a control click, record the click
            if (!programmaticChangeDetected || isControlClick) {
              this.addRecordedStep(Action.CLICK, targetElement);
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
    if (classList.some(c => /btn|button/i.test(c))) return true;
    
    return false;
  }

  private isInsideDatePicker(el: HTMLElement): boolean {
    let current: HTMLElement | null = el;
    while (current && current !== document.body) {
      const idOrClass = (current.id || "") + " " + (current.className || "");
      if (/datepicker|calendar|rmdp|flatpickr|ui-datepicker|backdrop|overlay/i.test(idOrClass)) {
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

    // Deduplicate submit events triggered by an already recorded button/input click
    if (Date.now() - this.lastButtonSubmitTime < 200) {
      logger.info('Recorder', 'Ignored SUBMIT event because it was already recorded as a button click.');
      return;
    }

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
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) {
        meta.labelText = label.textContent?.trim();
      }
    }
    
    if (!meta.labelText) {
      const parentLabel = el.closest("label");
      if (parentLabel) {
        // BUG-012: Get only direct text nodes, not descendant text (avoids including
        // input values, tooltips, and icon text that make selectors unmatchable)
        meta.labelText = Array.from(parentLabel.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent?.trim())
          .filter(Boolean)
          .join(' ')
          .trim() || undefined;
      }
    }

    meta.cssPath = this.generateCssPath(el);
    meta.xpath = this.generateXPath(el);

    return meta;
  }

  private generateCssPath(el: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = el;

    while (current && current !== document.body && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break; // Unique ID, can safely stop climbing
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
    if (el.id) {
      return `//*[@id="${el.id}"]`;
    }

    const paths: string[] = [];
    let current: HTMLElement | null = el;
    let depth = 0;
    let anchor: string | null = null;

    while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5) {
      // If we find an ancestor with an ID, anchor to it
      if (current !== el && current.id) {
        anchor = `//*[@id="${current.id}"]`;
        break;
      }

      const tagName = current.nodeName.toLowerCase();
      if (current !== el && (tagName === "form" || tagName === "fieldset")) {
        if (current.id) {
          anchor = `//${tagName}[@id="${current.id}"]`;
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

      const currNodeName = current.nodeName;
      // Always include [1] if there are any siblings of the same type,
      // even if this element is the first child — prevents ambiguous XPaths
      const hasSameTypeSiblings = current.parentElement
        ? Array.from(current.parentElement.children)
            .filter(c => c.nodeName === currNodeName).length > 1
        : false;
      const pathIndex = (index > 0 || hasSameTypeSiblings) ? `[${index + 1}]` : "";
      paths.unshift(`${tagName}${pathIndex}`);
      
      current = current.parentElement;
      depth++;
    }

    if (anchor) {
      return `${anchor}/${paths.join("/")}`;
    }

    return paths.length ? `//${paths.join("/")}` : "";
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
