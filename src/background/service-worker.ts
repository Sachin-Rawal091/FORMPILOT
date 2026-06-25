import { FormPilotMessage, MessageType, ExecutionStatus, Action, StepResult } from "../types";
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

// Action click listener to open the options page tab
chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab && activeTab.id && activeTab.url && !activeTab.url.startsWith('chrome-extension://')) {
      chrome.storage.local.set({ lastActiveWebTabId: activeTab.id });
    }
    chrome.runtime.openOptionsPage();
  });
});

// Helper for sending messages with retry to loaded tabs
async function sendMessageWithRetry(tabId: number, message: any, retries = 5, delay = 1000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn('ServiceWorker', `Failed to send message to tab ${tabId}, retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Handle closed tabs gracefully
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Check active recording tab
  const activeRecTab = RecordingQueueHandler.getActiveTab();
  if (activeRecTab === tabId) {
    logger.info('ServiceWorker', `Active recording tab ${tabId} was closed. Flushing queue and saving partial recording.`);
    await RecordingQueueHandler.flushQueue();
    const state = await StorageManager.getRecordingState();
    if (state && state.isRecording && state.activeRecordingSteps.length > 0) {
      try {
        const recordings = await StorageManager.getRecordings();
        const steps = state.activeRecordingSteps;
        const url = state.activeRecordingUrl;
        const pagesMap = new Map<string, string>();
        steps.forEach(step => {
          if (step.pageId && !pagesMap.has(step.pageId)) {
            pagesMap.set(step.pageId, step.pageId);
          }
        });
        const pages = Array.from(pagesMap.entries()).map(([id, pattern]) => ({
          id,
          urlPattern: pattern
        }));
        let siteId = "generic";
        try { siteId = new URL(url).hostname; } catch {}

        const newRecording = {
          id: state.recordingId || crypto.randomUUID(),
          name: `Partial: Recording on ${new Date().toLocaleDateString()}`,
          siteUrl: url,
          siteId,
          steps,
          pages,
          pageCount: pages.length || 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1
        };
        await StorageManager.setRecordings([...recordings, newRecording]);
        logger.info('ServiceWorker', `Partial recording saved successfully: ${newRecording.name}`);
      } catch (err) {
        logger.error('ServiceWorker', 'Failed to save partial recording on tab close:', err);
      }
    }
    await StorageManager.clearRecordingState();
    RecordingQueueHandler.setActiveTab(null);
    // Broadcast state update
    chrome.runtime.sendMessage({
      type: MessageType.STATE_UPDATE,
      payload: {},
      timestamp: Date.now()
    }).catch(() => {});
  }

  // Check executing tab
  const execState = await StorageManager.getExecutionState();
  if (execState && execState.tabContext === tabId && execState.status !== ExecutionStatus.COMPLETE && execState.status !== ExecutionStatus.FAILED) {
    logger.info('ServiceWorker', `Execution tab ${tabId} was closed. Aborting execution.`);
    const failedRowsCount = execState.totalRows - execState.completedRows - execState.skippedRows;
    const updatedState = {
      ...execState,
      status: ExecutionStatus.FAILED,
      failedRows: Math.max(0, failedRowsCount),
      mutexLock: null
    };
    await StorageManager.setExecutionState(updatedState);
    
    // Log the fatal error
    try {
      await StorageManager.addLogEntry({
        id: crypto.randomUUID(),
        sessionId: execState.sessionId,
        rowIndex: execState.currentRowIndex,
        stepId: "SYSTEM",
        action: Action.WAIT,
        selector: "window",
        result: StepResult.FAILED,
        status: "FAILED",
        error: "Target browser tab was closed accidentally by the user.",
        retryCount: 0,
        duration: 0,
        timestamp: Date.now()
      });
    } catch (err) {
      logger.error('ServiceWorker', 'Failed to log tab closure error:', err);
    }

    // Broadcast state update
    chrome.runtime.sendMessage({
      type: MessageType.STATE_UPDATE,
      payload: { state: updatedState },
      timestamp: Date.now()
    }).catch(() => {});
  }
});

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
          sendMessageWithRetry(tabs[0].id, message).catch(() => {});
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
      sendMessageWithRetry(tabId, message).catch(() => {});
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
    const sendFn = message.type === MessageType.START_EXECUTION ? sendMessageWithRetry : async (id: number, msg: any) => chrome.tabs.sendMessage(id, msg);
    if (tabId) {
      sendFn(tabId, message).catch(() => {});
      sendResponse({ received: true });
    } else {
      // Fallback: popup messages don't have sender.tab, query the active tab
      logger.warn('ServiceWorker', `No tabId for ${MessageType[message.type]}, falling back to active tab query.`);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const fallbackTabId = tabs[0]?.id;
        if (fallbackTabId) {
          sendFn(fallbackTabId, message).catch(() => {});
        } else {
          logger.error('ServiceWorker', `Could not resolve any tab for ${MessageType[message.type]}`);
        }
      });
      sendResponse({ received: true });
    }
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