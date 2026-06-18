import { 
  Step, 
  Action, 
  ExcelRow, 
  RowStatus, 
  ExecutionState, 
  ExecutionStatus, 
  MessageType, 
  FormPilotMessage, 
  StepResult, 
  LogStatus
} from "../types";
import { StateManager } from "./engines/StateManager";
import { RetryEngine, ErrorClassification } from "./engines/RetryEngine";
import { SmartWaitEngine } from "./engines/SmartWaitEngine";
import { SelectorEngine } from "./engines/SelectorEngine";
import { ResponseDetectionEngine } from "./engines/ResponseDetectionEngine";
import { 
  MAX_PAGE_RETRIES, 
  STEP_DELAY,
  EXCEL_CHUNK_SIZE,
  POST_ROW_DELAY_MS,
  POST_SUBMIT_SETTLE_MS,
  WAIT_DOM_STABLE_TIMEOUT
} from "../shared/constants";
import { logger } from "../utils/logger";

export class Executor {
  private isRunning = false;
  private isPaused = false;
  private sessionId = "";
  private recordingSteps: Step[] = [];
  private siteUrl = "";
  
  constructor() {
    this.setupMessageListener();
    this.checkAutoResume();
  }

  private async checkAutoResume() {
    // Wait a bit to ensure state is settled from any background syncs
    await new Promise(r => setTimeout(r, 500));
    
    // Guard: Do not resume if execution has already been actively triggered via messages
    if (this.isRunning) {
      logger.debug('Executor', 'checkAutoResume: Execution already running, skipping auto-resume.');
      return;
    }
    
    try {
      const state = await StateManager.getState();
      if (state && state.status === ExecutionStatus.RUNNING && state.recordingId && state.sessionId) {
        // Only resume if we are still on the same site/domain and roughly the same path
        if (state.currentUrl) {
          try {
            const currentUrlObj = new URL(window.location.href);
            const stateUrlObj = new URL(state.currentUrl);
            
            if (currentUrlObj.hostname !== stateUrlObj.hostname || currentUrlObj.pathname !== stateUrlObj.pathname) {
              logger.debug('Executor', `Auto-resume skipped. Expected URL: ${stateUrlObj.pathname}, Current: ${currentUrlObj.pathname}`);
              
              // If we're on the same domain but wrong path, try to navigate back to the expected path
              if (currentUrlObj.hostname === stateUrlObj.hostname) {
                logger.info('Executor', `Redirecting to correct path for auto-resume: ${state.currentUrl}`);
                window.location.href = state.currentUrl;
                return; // Will auto-resume on the new page
              }
              
              return;
            }
          } catch(e) {}
        } else if (state.siteUrl) {
          try {
            const siteHost = new URL(state.siteUrl).hostname;
            if (!window.location.hostname.includes(siteHost)) {
              return;
            }
          } catch(e) {}
        }
        
        logger.info('Executor', 'Auto-resuming from previous state...');
        // Re-hydrate and start (will pick up from state.currentRowIndex)
        this.start(state.recordingId, state.sessionId);
      }
    } catch (err) {
      logger.error('Executor', 'Failed auto-resume check', err);
    }
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message: FormPilotMessage, _sender, sendResponse) => {
      switch (message.type) {
        case MessageType.START_EXECUTION:
          const payload = message.payload as { recordingId: string; sessionId: string };
          this.start(payload?.recordingId, payload?.sessionId || message.sessionId, message.tabId);
          break;
        case MessageType.PAUSE_EXECUTION:
          this.pause();
          break;
        case MessageType.RESUME_EXECUTION:
          this.resume();
          break;
        case MessageType.ABORT_EXECUTION:
          this.abort();
          break;
      }
      sendResponse({ received: true });
      return true;
    });
  }

  private safeSendMessage(message: any, timeoutMs = 2000): Promise<any> {
    return new Promise((resolve) => {
      let resolved = false;
      
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.warn('Executor', `sendMessage timed out after ${timeoutMs}ms for type: ${message.type}`);
          resolve({ error: "TIMEOUT", timeout: true });
        }
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              logger.warn('Executor', `sendMessage lastError: ${chrome.runtime.lastError.message}`);
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          }
        });
      } catch (err: any) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          logger.error('Executor', "sendMessage threw exception:", err);
          resolve({ error: err.message });
        }
      }
    });
  }

  // ─── INITIAL START ──────────────────────────────────────────────────

  async start(recordingId: string, sessionId: string, tabId: number = -1) {
    if (this.isRunning) {
      logger.warn('Executor', "Executor is already running.");
      return;
    }

    // Immediate storage mutex check to prevent multi-tab race conditions
    const currentState = await StateManager.getState();
    if (currentState?.mutexLock && currentState.mutexLock !== sessionId) {
      logger.warn('Executor', `Executor blocked: Mutex locked by session ${currentState.mutexLock}`);
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.sessionId = sessionId;
    try {
      // 1. Fetch the targeted recording via background proxy
      const recordingRes = await this.safeSendMessage({
        type: MessageType.GET_RECORDING_DATA,
        payload: { recordingId },
        sessionId: this.sessionId,
        timestamp: Date.now()
      }, 5000);
      if (recordingRes?.error || !recordingRes?.recording) {
        throw new Error(recordingRes?.error || `Recording with ID ${recordingId} not found via extension proxy.`);
      }
      this.recordingSteps = recordingRes.recording.steps;
      this.siteUrl = recordingRes.recording.siteUrl || window.location.href;

      // 2. Fetch total rows count to process via background proxy
      const countRes = await this.safeSendMessage({
        type: MessageType.GET_EXCEL_DATA,
        payload: { countOnly: true },
        sessionId: this.sessionId,
        timestamp: Date.now()
      }, 5000);
      if (countRes?.error || countRes?.count === undefined || countRes.count === 0) {
        throw new Error(countRes?.error || "No Excel data found for execution via extension proxy.");
      }
      const totalRows = countRes.count;

      // 3. Mutex check and state initialization
      let state;
      const isResume = currentState && currentState.sessionId === sessionId && currentState.status === ExecutionStatus.RUNNING;
      
      if (isResume) {
        state = currentState;
        logger.debug('Executor', 'Re-using existing active session state for auto-resume:', state);
      } else {
        state = await StateManager.initializeSession(
          this.sessionId, 
          totalRows,
          recordingId,
          this.siteUrl,
          tabId
        );
        logger.info('Executor', 'Session initialized with state:', state);
      }

      // Send initial state update (status is RUNNING)
      this.broadcastStateUpdate(state);

      // 4. Start the main execution loop
      await this.runAllRows(totalRows);

    } catch (err: any) {
      logger.error('Executor', "Execution failed to start:", err);
      this.handleFatalError(err.message);
    }
  }

  // ─── MAIN EXECUTION LOOP ───────────────────────────────────────────
  // Processes ALL rows sequentially in a single JS context.
  // Between rows, resets the form by dismissing success modals and
  // navigating back to the form's initial state.
  // ─────────────────────────────────────────────────────────────────────

  private async runAllRows(totalRows: number) {
    let state = (await StateManager.getState()) || this.createFallbackState(totalRows);

    let excelRows: ExcelRow[] = [];
    let currentChunkOffset = -1;

    for (let rowIdx = state.currentRowIndex; rowIdx < totalRows; rowIdx++) {
      if (!this.isRunning) break;

      // Load chunk if needed
      const neededChunkOffset = Math.floor(rowIdx / EXCEL_CHUNK_SIZE) * EXCEL_CHUNK_SIZE;
      if (currentChunkOffset !== neededChunkOffset) {
        const chunkRes = await this.safeSendMessage({
          type: MessageType.GET_EXCEL_DATA,
          payload: { offset: neededChunkOffset, limit: EXCEL_CHUNK_SIZE },
          sessionId: this.sessionId,
          timestamp: Date.now()
        }, 5000);
        if (chunkRes?.error || !chunkRes?.excelRows) {
          throw new Error(chunkRes?.error || "Failed to load Excel row chunk.");
        }
        excelRows = chunkRes.excelRows;
        currentChunkOffset = neededChunkOffset;
      }

      const row = excelRows[rowIdx - currentChunkOffset];
      if (!row) {
        throw new Error(`Row ${rowIdx} not found in loaded chunk.`);
      }

      // Skip already-completed rows (from previous partial runs)
      if (row.status === RowStatus.SUCCESS || row.status === RowStatus.SKIPPED) {
        state = await StateManager.updateState({
          currentRowIndex: rowIdx + 1,
          currentStepIndex: 0
        });
        this.broadcastStateUpdate(state);
        continue;
      }

      // Process this row
      logger.info('Executor', `Processing row index: ${row.rowIndex} (${rowIdx + 1} of ${totalRows})`);

      const rowResult = await this.executeRow(row, state);

      if (rowResult === "ABORTED") return;

      // Update counters based on result
      const updates: Partial<ExecutionState> = {
        currentRowIndex: rowIdx + 1,
        currentStepIndex: 0,
        pageRetryCount: 0 // Reset page retries for the next row
      };

      if (rowResult === "SUCCESS") {
        updates.completedRows = state.completedRows + 1;
        row.status = RowStatus.SUCCESS;
      } else if (rowResult === "SKIPPED") {
        updates.skippedRows = state.skippedRows + 1;
        row.status = RowStatus.SKIPPED;
      } else {
        updates.failedRows = state.failedRows + 1;
        row.status = RowStatus.FAILED;
      }

      // Persist Excel row status back to IndexedDB via background proxy
      // We send back only the modified row to update it.
      const setExcelRes = await this.safeSendMessage({
        type: MessageType.SET_EXCEL_DATA,
        payload: { excelRows: [row], updateOnly: true }, // Send only the updated row to be merged
        sessionId: this.sessionId,
        timestamp: Date.now()
      }, 3000);
      if (setExcelRes?.error && setExcelRes.error !== "TIMEOUT") {
        logger.error('Executor', 'Failed to persist Excel status:', setExcelRes.error);
      }

      // Update and broadcast state
      state = await StateManager.updateState(updates);
      this.broadcastStateUpdate(state);

      // If more rows remain, reset the form for the next row
      if (rowIdx + 1 < totalRows && this.isRunning) {
        logger.debug('Executor', `Resetting form for row ${rowIdx + 2}...`);
        await this.resetFormBetweenRows();
        // After reset, wait for DOM to fully stabilize before starting next row
        await SmartWaitEngine.waitForDOMStability(WAIT_DOM_STABLE_TIMEOUT).catch(() => {});
      }
    }

    // Mark completion
    if (this.isRunning) {
      await this.completeExecution(state);
    }
  }

  // ─── FORM RESET BETWEEN ROWS ───────────────────────────────────────
  // After a successful submission, forms typically show a success modal,
  // toast, or redirect. This method dismisses success UI and resets the
  // form back to its initial state for the next row.
  // ─────────────────────────────────────────────────────────────────────

  private async resetFormBetweenRows() {
    // 1. Wait briefly for any success modal/overlay to fully render
    await new Promise(r => setTimeout(r, POST_ROW_DELAY_MS));

    // 2. Try to dismiss success modals/overlays by clicking common buttons
    const dismissed = await this.dismissSuccessUI();
    
    if (dismissed) {
      // Wait for form to reset after dismissal and DOM to stabilize
      await new Promise(r => setTimeout(r, 1500));
      await SmartWaitEngine.waitForDOMStability(WAIT_DOM_STABLE_TIMEOUT).catch(() => {});
      
      // Check if the first form element is now available — retry up to 3 times with increasing waits
      const firstStep = this.recordingSteps[0];
      if (firstStep) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const formReady = SelectorEngine.findElement(firstStep.selectorMeta, firstStep.selector);
          if (formReady) {
            // Also verify the element is actually visible (not hidden in an inactive section)
            const el = formReady.element as HTMLElement;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden") {
              logger.debug('Executor', `Form reset successful (attempt ${attempt + 1}), ready for next row.`);
              return;
            }
          }
          // Wait progressively longer between checks (500ms, 1000ms, 1500ms)
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      } else {
        // No recorded steps to verify against, just proceed
        logger.debug('Executor', 'No first step to verify, proceeding.');
        return;
      }
    }

    // 3. Fallback: navigate to original siteUrl to get a clean form
    logger.info('Executor', 'In-page reset failed, navigating to start URL...');
    
    // Save state to service worker before navigation
    const state = await StateManager.getState();
    if (state) {
      await this.safeSendMessage({
        type: MessageType.SET_EXECUTION_STATE,
        payload: { state },
        sessionId: this.sessionId,
        timestamp: Date.now()
      }, 5000);
    }

    if (this.siteUrl && window.location.href !== this.siteUrl) {
      window.location.href = this.siteUrl;
      // After navigation, this executor instance is destroyed.
      // The auto-resume logic will pick up execution on the new page.
      await new Promise(r => setTimeout(r, 10000)); // Safety net
    } else {
      // If we are already on the siteUrl and it's an SPA, navigate away then back
      // instead of reload() which destroys the JS context and can break auto-resume.
      logger.info('Executor', 'Already at start URL, navigating via history.back() + siteUrl redirect.');
      
      if (window.history.length > 1) {
        // Step 1: Navigate back in history to move away from current page
        const currentHref = window.location.href;
        window.history.back();
        
        // Step 2: Wait for the URL to actually change (history.back is async)
        await SmartWaitEngine.waitForURLChange(currentHref, 5000);
        
        // Step 3: Navigate forward to the siteUrl for a clean form load
        window.location.href = this.siteUrl;
        await new Promise(r => setTimeout(r, 5000)); // Allow page load before executor restarts
      } else {
        // No history available — assign siteUrl directly (triggers full page load like a fresh visit)
        window.location.href = this.siteUrl;
        await new Promise(r => setTimeout(r, 5000)); // Allow page load
      }
    }
  }

  /**
   * Attempts to dismiss success modals, overlays, toasts, and alerts by
   * finding and clicking common dismiss/close/ok/complete buttons.
   * Returns true if a dismiss button was found and clicked.
   */
  private async dismissSuccessUI(): Promise<boolean> {
    // Strategy 1: Look for buttons with common dismiss text
    const dismissKeywords = ['complete', 'finish', 'done', 'close', 'ok', 'continue', 'dismiss', 'got it', 'next'];
    const allButtons = Array.from(document.querySelectorAll('button, a.btn, [role="button"], input[type="button"]'));
    
    for (const btn of allButtons) {
      const text = (btn as HTMLElement).textContent?.trim().toLowerCase() || '';
      const isVisible = (btn as HTMLElement).offsetParent !== null;
      if (isVisible && dismissKeywords.some(kw => text.includes(kw))) {
        logger.debug('Executor', `Clicking dismiss button: "${(btn as HTMLElement).textContent?.trim()}"`);
        (btn as HTMLElement).click();
        await new Promise(r => setTimeout(r, 500));
        return true;
      }
    }

    // Strategy 2: Look for common modal dismiss selectors
    const dismissSelectors = [
      '#receipt-overlay button',           // KRP portal specific
      '.modal .btn-close',
      '.modal [data-dismiss="modal"]',
      '.modal [data-bs-dismiss="modal"]',
      '.toast .btn-close',
      '.alert .close',
      '[aria-label="Close"]',
      '.overlay-close'
    ];

    for (const selector of dismissSelectors) {
      const el = document.querySelector(selector);
      if (el && (el as HTMLElement).offsetParent !== null) {
        logger.debug('Executor', `Clicking dismiss selector: ${selector}`);
        (el as HTMLElement).click();
        await new Promise(r => setTimeout(r, 500));
        return true;
      }
    }

    // Strategy 3: Try pressing Escape key to close modals
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    // Check if any modal/overlay was dismissed
    const overlays = document.querySelectorAll('.modal.show, .modal-backdrop, [class*="overlay"][class*="active"]');
    if (overlays.length === 0) {
      return true; // No visible overlays, consider it dismissed
    }

    return false;
  }

  // ─── SINGLE ROW EXECUTION ──────────────────────────────────────────

  private async executeRow(row: ExcelRow, state: ExecutionState): Promise<"SUCCESS" | "FAILED" | "SKIPPED" | "ABORTED"> {
    logger.debug('Executor', `Processing row index: ${row.rowIndex}`);
    
    let isRowSkipped = false;
    let stepIndex = state.currentStepIndex;

    while (stepIndex < this.recordingSteps.length) {
      if (!this.isRunning) return "ABORTED";

      // Handle pause state
      if (this.isPaused) {
        state = await StateManager.updateState({ status: ExecutionStatus.PAUSED });
        this.broadcastStateUpdate(state);
        while (this.isPaused && this.isRunning) {
          await new Promise(r => setTimeout(r, 200));
        }
        if (!this.isRunning) return "ABORTED";
        state = await StateManager.updateState({ status: ExecutionStatus.RUNNING });
        this.broadcastStateUpdate(state);
      }

      const step = this.recordingSteps[stepIndex];

      // Page Retry Threshold Check
      if (state.pageRetryCount > MAX_PAGE_RETRIES) {
        logger.error('Executor', `Page retry ceiling (${MAX_PAGE_RETRIES}) exceeded for step ${step.id}. Aborting row.`);
        await this.logStepFailure(row.rowIndex, step, new Error("Page retry limit exceeded."));
        return "FAILED";
      }

      // Human-like pacing delay
      await new Promise(r => setTimeout(r, STEP_DELAY));

      // After navigation/page-transition clicks, wait for DOM to stabilize before proceeding
      // This handles SPA wizard transitions where sections toggle visibility
      if (stepIndex > 0) {
        const prevStep = this.recordingSteps[stepIndex - 1];
        if (prevStep && (prevStep.action === Action.CLICK || prevStep.action === Action.NAVIGATE_NEXT)) {
          const prevEl = SelectorEngine.findElement(prevStep.selectorMeta, prevStep.selector);
          if (prevEl) {
            const tagName = (prevEl.element as HTMLElement).tagName?.toLowerCase();
            const textContent = (prevEl.element as HTMLElement).textContent?.toLowerCase() || '';
            const isNavigationClick = tagName === 'button' || tagName === 'a' || 
              (prevEl.element as HTMLElement).getAttribute('role') === 'button' ||
              textContent.includes('next') || textContent.includes('continue') || 
              textContent.includes('submit') || textContent.includes('proceed');
            
            if (isNavigationClick || prevStep.action === Action.NAVIGATE_NEXT) {
              logger.debug('Executor', `Post-navigation DOM stability wait after step: ${prevStep.id}`);
              await SmartWaitEngine.waitForDOMStability(WAIT_DOM_STABLE_TIMEOUT).catch(() => {});
            }
          }
        }
      }

      // Mid-step CAPTCHA Check
      const captchaResult = await ResponseDetectionEngine.handleCaptchaIfPresent(this.sessionId);
      if (captchaResult === "TIMEOUT") {
        await this.logStepFailure(row.rowIndex, step, new Error("CAPTCHA timeout mid-step."));
        return "FAILED";
      }

      // 1. Run Step execution via RetryEngine
      const startTime = Date.now();
      const res = await RetryEngine.executeStepWithRetry(step, row.data);
      const duration = Date.now() - startTime;

      if (res.success) {
        // Step completed successfully (or optionally skipped)
        const logStatus: LogStatus = (res.resolvedStatus as LogStatus) || "FILLED";
        const resultType = logStatus === "STEP_SKIPPED" ? StepResult.SKIPPED : StepResult.SUCCESS;

        await this.safeSendMessage({
          type: MessageType.ADD_LOG_ENTRY,
          payload: {
            entry: {
              id: this.generateUUID(),
              sessionId: this.sessionId,
              timestamp: Date.now(),
              rowIndex: row.rowIndex,
              stepId: step.id,
              action: step.action,
              selector: step.selector,
              strategy: res.selectorStrategy !== undefined ? res.selectorStrategy.toString() : undefined,
              value: logStatus === "STEP_SKIPPED" ? undefined : step.value,
              result: resultType,
              status: logStatus,
              retryCount: res.retriesUsed,
              duration
            }
          },
          sessionId: this.sessionId,
          timestamp: Date.now()
        }, 2000);

        // 2. Perform immediate inline error validation check
        const selectorResult = SelectorEngine.findElement(step.selectorMeta, step.selector);
        if (selectorResult) {
          const inlineErr = ResponseDetectionEngine.detectInlineError(selectorResult.element as HTMLElement);
          if (inlineErr) {
            await this.safeSendMessage({
              type: MessageType.ADD_LOG_ENTRY,
              payload: {
                entry: {
                  id: this.generateUUID(),
                  sessionId: this.sessionId,
                  timestamp: Date.now(),
                  rowIndex: row.rowIndex,
                  stepId: step.id,
                  action: step.action,
                  selector: step.selector,
                  result: StepResult.FAILED,
                  status: "WARN",
                  error: `Inline field error: ${inlineErr}`,
                  retryCount: 0,
                  duration: 0
                }
              },
              sessionId: this.sessionId,
              timestamp: Date.now()
            }, 2000);
          }
        }

        // Reset page retries on successful page transition
        if (step.action === Action.NAVIGATE_NEXT) {
          state = await StateManager.updateState({ pageRetryCount: 0 });
        }

        stepIndex++;
        
        // 3. Save state Checkpoint after every successful step
        state = await StateManager.updateState({ 
          currentStepIndex: stepIndex,
          lastStepResult: res.resolvedStatus || "SUCCESS"
        });
        this.broadcastStateUpdate(state);

      } else {
        // Step execution failed after retries
        if (res.classification === ErrorClassification.FATAL) {
          if (res.resolvedStatus === "ROW_SKIPPED") {
            // Option 1: Missing column / required value skip
            await this.safeSendMessage({
              type: MessageType.ADD_LOG_ENTRY,
              payload: {
                entry: {
                  id: this.generateUUID(),
                  sessionId: this.sessionId,
                  timestamp: Date.now(),
                  rowIndex: row.rowIndex,
                  stepId: step.id,
                  action: step.action,
                  selector: step.selector,
                  result: StepResult.SKIPPED,
                  status: "ROW_SKIPPED",
                  error: res.error?.message,
                  retryCount: res.retriesUsed,
                  duration
                }
              },
              sessionId: this.sessionId,
              timestamp: Date.now()
            }, 2000);
            isRowSkipped = true;
            break; // Break step loop to advance to next row
          } else {
            // Option 2: Unrecoverable context destroyed / network error
            this.handleFatalError(res.error?.message || "Unrecoverable FATAL step execution error.");
            return "ABORTED";
          }
        } else {
          // Escalates to page retry increment
          const isOverCap = await StateManager.incrementPageRetry(MAX_PAGE_RETRIES);
          state = (await StateManager.getState()) || state;
          
          if (isOverCap) {
            await this.logStepFailure(row.rowIndex, step, new Error("Page retry cap exceeded."));
            return "FAILED";
          } else {
            // Within retry limit: wait for DOM to stabilize and retry this same step
            await SmartWaitEngine.waitForDOMStability(5000).catch(() => {});
          }
        }
      }
    }

    if (isRowSkipped) {
      return "SKIPPED";
    }

    // 4. Wait for submission result to settle (success modal, redirect, etc.)
    await new Promise(r => setTimeout(r, POST_SUBMIT_SETTLE_MS));

    // 5. Run final submission detection checks on page
    const finalOutcome = await ResponseDetectionEngine.runSubmissionDetection(
      window.location.href,
      this.sessionId
    );

    // Row status summary logging
    await this.safeSendMessage({
      type: MessageType.ADD_LOG_ENTRY,
      payload: {
        entry: {
          id: this.generateUUID(),
          sessionId: this.sessionId,
          timestamp: Date.now(),
          rowIndex: row.rowIndex,
          stepId: "row_summary",
          action: Action.SUBMIT,
          selector: "page_summary",
          result: finalOutcome === "SUCCESS" ? StepResult.SUCCESS : StepResult.FAILED,
          status: finalOutcome === "SUCCESS" ? "SUCCESS" : "FAILED",
          error: finalOutcome === "FAILED" ? "Submission check returned FAILED." : undefined,
          retryCount: 0,
          duration: 0
        }
      },
      sessionId: this.sessionId,
      timestamp: Date.now()
    }, 2000);

    return finalOutcome === "SUCCESS" ? "SUCCESS" : "FAILED";
  }

  // ─── COMPLETION ────────────────────────────────────────────────────

  /**
   * Marks the execution session as complete, releases the mutex, and cleans up.
   */
  private async completeExecution(_state: ExecutionState) {
    const finalState = await StateManager.updateState({
      status: ExecutionStatus.COMPLETE,
      mutexLock: null // Release Mutex
    });
    this.broadcastStateUpdate(finalState);

    chrome.runtime.sendMessage({
      type: MessageType.EXECUTION_COMPLETE,
      sessionId: this.sessionId,
      payload: { state: finalState },
      timestamp: Date.now()
    });

    this.cleanup();
  }

  // ─── EXECUTION CONTROLS ────────────────────────────────────────────

  pause() {
    this.isPaused = true;
    logger.info('Executor', 'Paused.');
  }

  resume() {
    this.isPaused = false;
    // Broadcast message to Service Worker so badge clears immediately on resume
    chrome.runtime.sendMessage({
      type: MessageType.CLEAR_BADGE,
      sessionId: this.sessionId,
      payload: {},
      timestamp: Date.now()
    }).catch(() => {});
    
    // Resolve any pending CAPTCHA promise
    ResponseDetectionEngine.forceResolveCaptcha();
    
    logger.info('Executor', 'Resumed.');
  }

  async abort() {
    logger.warn('Executor', 'Aborting...');
    this.isRunning = false;
    this.isPaused = false;
    
    const finalState = await StateManager.getState();
    if (finalState) {
      // Broadcast the abort state to popup before clearing
      this.broadcastStateUpdate({
        ...finalState,
        status: ExecutionStatus.IDLE,
        mutexLock: null
      });
    }

    await StateManager.clearSession();
    this.cleanup();
  }

  // ─── ERROR HANDLING & LOGGING ──────────────────────────────────────

  private async handleFatalError(errMsg: string) {
    logger.error('Executor', `FormPilot Fatal Error: ${errMsg}`);
    this.isRunning = false;
    this.isPaused = false;

    const state = await StateManager.getState();
    if (state) {
      const failedState = {
        ...state,
        status: ExecutionStatus.FAILED,
        mutexLock: null // Release Mutex
      };
      this.broadcastStateUpdate(failedState);

      // Notify service worker to clear badge icon
      chrome.runtime.sendMessage({
        type: MessageType.EXECUTION_COMPLETE,
        sessionId: this.sessionId,
        payload: { state: failedState },
        timestamp: Date.now()
      }).catch(() => {});
    }
    
    await StateManager.clearSession();
    this.cleanup();
  }

  private async logStepFailure(rowIndex: number, step: Step, err: Error) {
    await this.safeSendMessage({
      type: MessageType.ADD_LOG_ENTRY,
      payload: {
        entry: {
          id: this.generateUUID(),
          sessionId: this.sessionId,
          timestamp: Date.now(),
          rowIndex,
          stepId: step.id,
          action: step.action,
          selector: step.selector,
          result: StepResult.FAILED,
          status: "FAILED",
          error: err.message,
          retryCount: 0,
          duration: 0
        }
      },
      sessionId: this.sessionId,
      timestamp: Date.now()
    }, 2000);
  }

  // ─── UTILITIES ─────────────────────────────────────────────────────

  private broadcastStateUpdate(state: ExecutionState) {
    chrome.runtime.sendMessage({
      type: MessageType.STATE_UPDATE,
      sessionId: this.sessionId,
      payload: { state },
      timestamp: Date.now()
    }).catch(() => {
      // Catch error when popup is closed (no listener)
    });
  }

  private cleanup() {
    this.isRunning = false;
    this.isPaused = false;
    this.recordingSteps = [];
    ResponseDetectionEngine.removeCaptchaOverlay();
  }

  private createFallbackState(totalRows: number): ExecutionState {
    return {
      sessionId: this.sessionId,
      currentRowIndex: 0,
      currentStepIndex: 0,
      currentPageId: "",
      status: ExecutionStatus.RUNNING,
      totalRows,
      completedRows: 0,
      failedRows: 0,
      skippedRows: 0,
      pageRetryCount: 0,
      mutexLock: null,
      captchaPending: false,
      tabContext: -1,
      lastStepResult: ""
    };
  }

  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Instantiate and bind to content script context
new Executor();