import { Step, Action, SelectorMeta, FormPilotMessage, MessageType } from "../types";
import { INPUT_DEBOUNCE_MS, DOUBLE_CLICK_WINDOW_MS } from "../shared/constants";
import { logger } from "../utils/logger";

class RecordingEngine {
  private isRecording = false;
  private recordingId = "";
  private currentStepIndex = 0;
  private lastClickTime = 0;
  private lastClickedElement: HTMLElement | null = null;
  private debounceTimers: Map<HTMLElement, ReturnType<typeof setTimeout>> = new Map();

  constructor() {
    this.setupMessageListener();
    this.setupDOMEventListeners();
    this.restoreRecordingState();
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
          this.isRecording = false;
          // BUG-033: Clear all pending debounce timers to prevent steps being recorded after stop
          this.debounceTimers.forEach(timer => clearTimeout(timer));
          this.debounceTimers.clear();
          logger.info('Recorder', 'Recording stopped.');
          break;
      }
    });
  }

  private restoreRecordingState() {
    // BUG-039: Gate on lightweight session storage check before waking the service worker
    try {
      chrome.storage.session.get('recordingState', (result) => {
        if (chrome.runtime.lastError) {
          logger.warn('Recorder', 'Session storage check failed:', chrome.runtime.lastError.message);
          return;
        }
        // Only send GET_STATUS if there's evidence of an active recording
        if (!result || !result.recordingState) {
          logger.debug('Recorder', 'No recording state in session storage, skipping GET_STATUS.');
          return;
        }

        logger.debug('Recorder', 'Recording state found in session storage, sending GET_STATUS...');
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
    }).catch(() => {});
  }

  private handleClickEvent(e: MouseEvent) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    logger.debug('Recorder', `Click event on <${el.tagName.toLowerCase()}> id=${el.id || 'none'} type=${el.getAttribute('type') || 'none'}`);

    // BUG-024: Filter out ALL input types handled by change/input events to prevent double capturing
    const tagName = el.tagName.toLowerCase();

    if (tagName === "input" || tagName === "select" || tagName === "textarea") {
      return; // All input-like elements are handled by change or input events
    }

    // Deduplication of double-clicks
    const now = Date.now();
    if (now - this.lastClickTime < DOUBLE_CLICK_WINDOW_MS && this.lastClickedElement === el) {
      return;
    }
    this.lastClickTime = now;
    this.lastClickedElement = el;

    // BUG-018: Cross-origin iframe detection removed — content scripts can't be injected
    // cross-origin, making the previous check unreachable in practice.

    // Capture as CLICK
    this.addRecordedStep(Action.CLICK, el);
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
      }

      const timer = setTimeout(() => {
        const value = el.isContentEditable ? el.innerText : (el as HTMLInputElement).value;
        const isRichText = el.isContentEditable || el.classList.contains("mce-content-body") || el.classList.contains("ql-editor");
        
        this.addRecordedStep(isRichText ? Action.RICH_TEXT : Action.FILL, el, value);
        this.debounceTimers.delete(el);
      }, INPUT_DEBOUNCE_MS);

      this.debounceTimers.set(el, timer);
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
      maxRetries: 3
    };

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

    while (current && current.nodeType === Node.ELEMENT_NODE) {
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

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = current.nodeName.toLowerCase();
      const currNodeName = current.nodeName;
      // BUG-013: Always include [1] if there are any siblings of the same type,
      // even if this element is the first child — prevents ambiguous XPaths
      const hasSameTypeSiblings = current.parentElement
        ? Array.from(current.parentElement.children)
            .filter(c => c.nodeName === currNodeName).length > 1
        : false;
      const pathIndex = (index > 0 || hasSameTypeSiblings) ? `[${index + 1}]` : "";
      paths.unshift(`${tagName}${pathIndex}`);
      current = current.parentElement;
    }

    return paths.length ? `/${paths.join("/")}` : "";
  }

  private generateUUID(): string {
    // Simple robust RFC4122 compliant UUID v4 generator
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Instantiate the recorder
new RecordingEngine();
