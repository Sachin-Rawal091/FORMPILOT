import { FormPilotMessage, MessageType } from "../types";
import { StorageManager } from "../storage/StorageManager";
import { RecordingQueueHandler } from "./handlers/RecordingQueueHandler";
import { DataHandler } from "./handlers/DataHandler";
import { logger } from "../utils/logger";

logger.info('ServiceWorker', 'Initialized.');

// Allow content scripts to read/write chrome.storage.session
if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .then(() => logger.debug('ServiceWorker', 'Session storage access level set to TRUSTED_AND_UNTRUSTED_CONTEXTS'))
    .catch((err) => logger.error('ServiceWorker', 'Failed to set session storage access level:', err));
}

chrome.runtime.onMessage.addListener((message: FormPilotMessage, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;

  // 1. Start Recording: Save state and route to content script in current tab
  if (message.type === MessageType.START_RECORDING) {
    const payload = message.payload as { recordingId: string; url: string };
    
    if (tabId) {
      RecordingQueueHandler.setActiveTab(tabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          RecordingQueueHandler.setActiveTab(tabs[0].id);
          chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
        }
      });
    }

    RecordingQueueHandler.resetQueue();

    StorageManager.setRecordingState({
      isRecording: true,
      activeRecordingSteps: [],
      activeRecordingUrl: payload.url,
      recordingId: payload.recordingId
    }).catch(err => logger.error('ServiceWorker', 'Failed to init recording state:', err));

    if (tabId) {
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }

    sendResponse({ received: true });
    return;
  }

  // 1b. Get status of current active recording
  if (message.type === MessageType.GET_STATUS) {
    RecordingQueueHandler.flushQueue().then(() => {
      return StorageManager.getRecordingState();
    }).then((state) => {
      sendResponse({ recordingState: state });
    }).catch(err => {
      logger.error('ServiceWorker', 'Failed to get recording state:', err);
      sendResponse({ recordingState: null });
    });
    return true; // Keep channel open for async response
  }

  // 2. Stop Recording: Route to content script on the recorded tab
  if (message.type === MessageType.STOP_RECORDING) {
    const targetTabId = tabId || RecordingQueueHandler.getActiveTab();
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
    }
    RecordingQueueHandler.setActiveTab(null);
    sendResponse({ received: true });
    return;
  }

  // 2b. Intercept Recording Events to persist steps even when Popup is closed
  if (message.type === MessageType.RECORDING_EVENT) {
    const step = (message.payload as any)?.step;
    if (step) {
      if (sender.tab?.id) {
        RecordingQueueHandler.setActiveTab(sender.tab.id);
      }
      RecordingQueueHandler.enqueueStep(step);
    }
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

  // 4. CAPTCHA Detected Event Handler
  if (message.type === MessageType.CAPTCHA_DETECTED) {
    if (tabId) {
      chrome.tabs.update(tabId, { active: true });
      chrome.action.setBadgeText({ text: "!", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444", tabId });

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

  // 5. Execution State Reset: Clear action badges on complete or resume
  if (message.type === MessageType.EXECUTION_COMPLETE || message.type === MessageType.CLEAR_BADGE) {
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
        sendResponse({ error: err.message });
      });
    return true; 
  }

  // 7-11. Data operations via handlers
  if (message.type === MessageType.GET_EXCEL_DATA) {
    DataHandler.handleGetExcelData(message, sendResponse);
    return true;
  }
  if (message.type === MessageType.SET_EXCEL_DATA) {
    DataHandler.handleSetExcelData(message, sendResponse);
    return true;
  }
  if (message.type === MessageType.ADD_LOG_ENTRY) {
    DataHandler.handleAddLogEntry(message, sendResponse);
    return true;
  }
  if (message.type === MessageType.SET_EXECUTION_STATE) {
    DataHandler.handleSetExecutionState(message, sendResponse);
    return true;
  }
  if (message.type === MessageType.GET_EXECUTION_STATE) {
    DataHandler.handleGetExecutionState(sendResponse);
    return true;
  }

  // Default acknowledge receipt
  sendResponse({ received: true });
});