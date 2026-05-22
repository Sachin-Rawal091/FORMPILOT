import { Step, Action, SelectorMeta, FormPilotMessage, MessageType } from "../types";
import { INPUT_DEBOUNCE_MS, DOUBLE_CLICK_WINDOW_MS } from "../shared/constants";

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
          console.log(`FormPilot Recording started for session ID: ${message.sessionId}, recordingId: ${this.recordingId}`);
          break;
        case MessageType.STOP_RECORDING:
          this.isRecording = false;
          console.log("FormPilot Recording stopped.");
          break;
      }
    });
  }

  private restoreRecordingState() {
    console.log("RecordingEngine: Attempting to restore recording state via GET_STATUS...");
    try {
      chrome.runtime.sendMessage({
        type: MessageType.GET_STATUS,
        sessionId: "",
        payload: {},
        timestamp: Date.now()
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("RecordingEngine: GET_STATUS failed:", chrome.runtime.lastError.message);
          return;
        }
        console.log("RecordingEngine: GET_STATUS response received:", JSON.stringify(response));
        if (response && response.recordingState) {
          const state = response.recordingState;
          console.log("RecordingEngine: Recording state from SW:", JSON.stringify({
            isRecording: state.isRecording,
            recordingId: state.recordingId,
            stepCount: state.activeRecordingSteps?.length,
            url: state.activeRecordingUrl
          }));
          if (state.isRecording) {
            this.isRecording = true;
            this.recordingId = state.recordingId || "default";
            this.currentStepIndex = state.activeRecordingSteps ? state.activeRecordingSteps.length : 0;
            console.log(`RecordingEngine: ✅ Restored recording state. isRecording: true, recordingId: ${this.recordingId}, stepIndex: ${this.currentStepIndex}`);
          } else {
            console.log("RecordingEngine: Recording state exists but isRecording is false.");
          }
        } else {
          console.log("RecordingEngine: No recording state in response.");
        }
      });
    } catch (err) {
      console.error("RecordingEngine: Error sending GET_STATUS:", err);
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
    
    console.log("RecordingEngine: DOM event listeners attached.");
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

    console.log(`RecordingEngine: Click event on <${el.tagName.toLowerCase()}> id=${el.id || 'none'} type=${el.getAttribute('type') || 'none'}`);

    // Filter out inputs that we handle via change or input listeners to prevent double capturing
    const tagName = el.tagName.toLowerCase();
    const typeAttr = el.getAttribute("type")?.toLowerCase() || "";

    if (
      (tagName === "input" && (typeAttr === "checkbox" || typeAttr === "radio" || typeAttr === "file" || typeAttr === "text" || typeAttr === "email" || typeAttr === "password" || typeAttr === "number" || typeAttr === "tel" || typeAttr === "url")) ||
      tagName === "select" ||
      tagName === "textarea"
    ) {
      return; // Handled by change or input events
    }

    // Deduplication of double-clicks
    const now = Date.now();
    if (now - this.lastClickTime < DOUBLE_CLICK_WINDOW_MS && this.lastClickedElement === el) {
      return;
    }
    this.lastClickTime = now;
    this.lastClickedElement = el;

    // Detect cross-origin frame interaction
    if (window !== window.top) {
      try {
        // Simple test to check if we are in cross-origin iframe
        if (window.parent.location.href) {
          // Access succeeds, same-origin
        }
      } catch (err) {
        this.addRecordedStep(Action.MANUAL_IFRAME, el, "");
        return;
      }
    }

    // Capture as CLICK
    this.addRecordedStep(Action.CLICK, el);
  }

  private handleInputEvent(e: Event) {
    if (!this.isRecording) return;

    const el = e.target as HTMLElement;
    if (!el) return;

    console.log(`RecordingEngine: Input event on <${el.tagName.toLowerCase()}> id=${el.id || 'none'} isRecording=${this.isRecording}`);

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
      required: true,
      retryable: true,
      maxRetries: 3
    };

    console.log("FormPilot Recorded Step:", newStep);

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
      console.error("FormPilot Recorder: Failed to send step to service worker:", err);
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
        meta.labelText = parentLabel.textContent?.trim();
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
        if (nth > 1 || current.nextElementSibling) {
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
      const pathIndex = index > 0 ? `[${index + 1}]` : "";
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
