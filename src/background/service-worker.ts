import { FormPilotMessage, MessageType, Step } from "../types";
import { StorageManager } from "../storage/StorageManager";

console.log("FormPilot Service Worker initialized.");

// Allow content scripts to read/write chrome.storage.session
if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .then(() => console.log("SW: Session storage access level set to TRUSTED_AND_UNTRUSTED_CONTEXTS"))
    .catch((err) => console.error("SW: Failed to set session storage access level:", err));
}

// Track the tab we're recording on so we can route STOP to it
let activeRecordingTabId: number | null = null;

// Serialize step persistence to prevent race conditions
// when multiple RECORDING_EVENTs arrive rapidly
let stepQueue: Step[] = [];
let isProcessingQueue = false;

async function processStepQueue() {
  if (isProcessingQueue || stepQueue.length === 0) return;
  isProcessingQueue = true;

  try {
    const state = await StorageManager.getRecordingState();
    if (state && state.isRecording) {
      // Drain all queued steps at once
      const pendingSteps = stepQueue.splice(0);
      state.activeRecordingSteps.push(...pendingSteps);
      await StorageManager.setRecordingState(state);
      console.log(`SW: Persisted ${pendingSteps.length} step(s). Total: ${state.activeRecordingSteps.length}`);
    } else {
      console.warn("SW: Step queue had items but recording state is inactive. Clearing queue.");
      stepQueue = [];
    }
  } catch (err) {
    console.error("SW: Failed to persist steps from queue:", err);
  } finally {
    isProcessingQueue = false;
    // If more steps arrived while we were processing, process again
    if (stepQueue.length > 0) {
      processStepQueue();
    }
  }
}

chrome.runtime.onMessage.addListener((message: FormPilotMessage, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;

  // 1. Start Recording: Save state and route to content script in current tab
  if (message.type === MessageType.START_RECORDING) {
    const payload = message.payload as { recordingId: string; url: string };
    
    // Track which tab we're recording on
    if (tabId) {
      activeRecordingTabId = tabId;
    } else {
      // If no tabId from sender (popup), query the active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          activeRecordingTabId = tabs[0].id;
          // Also route message to that tab
          chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
        }
      });
    }

    // Reset step queue
    stepQueue = [];
    isProcessingQueue = false;

    StorageManager.setRecordingState({
      isRecording: true,
      activeRecordingSteps: [],
      activeRecordingUrl: payload.url,
      recordingId: payload.recordingId
    }).then(() => {
      console.log("SW: Recording state initialized for:", payload.url);
    }).catch(err => console.error("SW: Failed to init recording state:", err));

    if (tabId) {
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }

    sendResponse({ received: true });
    return;
  }

  // 1b. Get status of current active recording
  if (message.type === MessageType.GET_STATUS) {
    // First flush any pending steps before responding
    const flush = stepQueue.length > 0 ? processStepQueue() : Promise.resolve();
    flush.then(() => {
      return StorageManager.getRecordingState();
    }).then((state) => {
      console.log("SW: GET_STATUS response — isRecording:", state?.isRecording, "steps:", state?.activeRecordingSteps?.length);
      sendResponse({ recordingState: state });
    }).catch(err => {
      console.error("SW: Failed to get recording state:", err);
      sendResponse({ recordingState: null });
    });
    return true; // Keep channel open for async response
  }

  // 2. Stop Recording: Route to content script on the recorded tab
  if (message.type === MessageType.STOP_RECORDING) {
    // Route to the tab we were recording on
    const targetTabId = tabId || activeRecordingTabId;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
    }
    // Do NOT clear recording state here — the popup reads it after this message
    activeRecordingTabId = null;
    sendResponse({ received: true });
    return;
  }

  // 2b. Intercept Recording Events to persist steps even when Popup is closed
  if (message.type === MessageType.RECORDING_EVENT) {
    const step = (message.payload as any)?.step;
    if (step) {
      // Track the tab that's sending recording events
      if (sender.tab?.id) {
        activeRecordingTabId = sender.tab.id;
      }
      // Enqueue and process — this prevents race conditions
      stepQueue.push(step);
      processStepQueue();
    }
    
    // Also forward the event to the popup (if open) for real-time UI updates
    // The popup listens on chrome.runtime.onMessage as well
    sendResponse({ received: true });
    return;
  }

  // 3. Start/Pause/Resume/Abort Execution: Route to Content script
  if (
    message.type === MessageType.START_EXECUTION ||
    message.type === MessageType.PAUSE_EXECUTION ||
    message.type === MessageType.RESUME_EXECUTION ||
    message.type === MessageType.ABORT_EXECUTION
  ) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }
    sendResponse({ received: true });
    return;
  }

  // 4. CAPTCHA Detected Event Handler: Activate tab, show notification, set badge
  if (message.type === MessageType.CAPTCHA_DETECTED) {
    if (tabId) {
      // Bring executing tab to the foreground
      chrome.tabs.update(tabId, { active: true });

      // Apply red "!" action badge to extension icon
      chrome.action.setBadgeText({ text: "!", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444", tabId });

      // Trigger standard Chrome system desktop notification (check if API exists)
      if (chrome.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "/icons/icon-128.png",
          title: "FormPilot: CAPTCHA Solver",
          message: "CAPTCHA detected on active form. Please solve it to resume execution.",
          priority: 2
        });
      }
    }
    sendResponse({ received: true });
    return;
  }

  // 5. Execution State Reset: Clear action badges on complete
  if (message.type === MessageType.EXECUTION_COMPLETE) {
    if (tabId) {
      chrome.action.setBadgeText({ text: "", tabId });
    }
    sendResponse({ received: true });
    return;
  }

  // 6. Get Recording Data from IndexedDB
  if (message.type === MessageType.GET_RECORDING_DATA) {
    const payload = message.payload as { recordingId: string };
    StorageManager.getRecordings()
      .then(recs => {
        const target = recs.find(r => r.id === payload.recordingId);
        sendResponse({ recording: target || null });
      })
      .catch(err => {
        console.error("SW: Failed to get recording:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }

  // 7. Get Excel Data from IndexedDB
  if (message.type === MessageType.GET_EXCEL_DATA) {
    const payload = (message.payload || {}) as { offset?: number; limit?: number; countOnly?: boolean };
    
    if (payload.countOnly) {
      StorageManager.getExcelDataCount()
        .then(count => {
          sendResponse({ count });
        })
        .catch(err => {
          console.error("SW: Failed to get excel data count:", err);
          sendResponse({ error: err.message });
        });
    } else {
      StorageManager.getExcelData(payload.offset, payload.limit)
        .then(rows => {
          sendResponse({ excelRows: rows || [] });
        })
        .catch(err => {
          console.error("SW: Failed to get excel data:", err);
          sendResponse({ error: err.message });
        });
    }
    return true; // Keep channel open for async response
  }

  // 8. Set Excel Data to IndexedDB
  if (message.type === MessageType.SET_EXCEL_DATA) {
    const payload = message.payload as { excelRows: any[]; updateOnly?: boolean };
    console.log("SW: Message received - SET_EXCEL_DATA. Saving", payload?.excelRows?.length, "rows...");
    StorageManager.setExcelData(payload.excelRows, !payload.updateOnly)
      .then(() => {
        console.log("SW: SET_EXCEL_DATA successfully written to IndexedDB.");
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error("SW: Failed to set excel data:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }

  // 9. Add Log Entry to IndexedDB
  if (message.type === MessageType.ADD_LOG_ENTRY) {
    const payload = message.payload as { entry: any };
    console.log("SW: Message received - ADD_LOG_ENTRY for step:", payload?.entry?.stepId, "row:", payload?.entry?.rowIndex);
    StorageManager.addLogEntry(payload.entry)
      .then(() => {
        console.log("SW: ADD_LOG_ENTRY successfully written to IndexedDB.");
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error("SW: Failed to add log entry:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }

  // 10. Set Execution State via Service Worker proxy
  // Critical for inter-row navigation: the content script needs to persist
  // state updates before navigating (which destroys its JS context).
  // Direct chrome.storage.session writes from content scripts can be lost
  // if navigation happens too quickly.
  if (message.type === MessageType.SET_EXECUTION_STATE) {
    const payload = message.payload as { state: any };
    console.log("SW: Message received - SET_EXECUTION_STATE. currentRowIndex:", payload?.state?.currentRowIndex);
    StorageManager.setExecutionState(payload.state)
      .then(() => {
        console.log("SW: SET_EXECUTION_STATE persisted. Row:", payload?.state?.currentRowIndex);
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error("SW: Failed to set execution state:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }

  // 11. Get Execution State via Service Worker proxy
  if (message.type === MessageType.GET_EXECUTION_STATE) {
    StorageManager.getExecutionState()
      .then(state => {
        sendResponse({ state: state || null });
      })
      .catch(err => {
        console.error("SW: Failed to get execution state:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }

  // Default acknowledge receipt
  sendResponse({ received: true });
});