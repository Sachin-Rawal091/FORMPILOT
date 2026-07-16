import { FormPilotMessage, MessageType, ExecutionStatus, Action, StepResult } from "../types";
import { StorageManager } from "../storage/StorageManager";
import { RecordingQueueHandler } from "./handlers/RecordingQueueHandler";
import { DataHandler } from "./handlers/DataHandler";
import { logger } from "../utils/logger";

logger.info('ServiceWorker', 'Initialized.');

// Register periodic background alarm for keepalive and maintenance
chrome.alarms.create('fp-keepalive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'fp-keepalive') {
    logger.debug('ServiceWorker', 'Running periodic background maintenance...');
    
    // 1. Log cleanup
    try {
      await StorageManager.cleanupLogs();
    } catch (err) {
      logger.error('ServiceWorker', 'Failed to run periodic log cleanup:', err);
    }

    // 1b. Session cleanup
    try {
      await StorageManager.cleanupSessions();
    } catch (err) {
      logger.error('ServiceWorker', 'Failed to run periodic session cleanup:', err);
    }

    // 2. Reclaim stale mutex
    try {
      const state = await StorageManager.getExecutionState();
      if (state && state.mutexLock) {
        if (state.tabContext && state.tabContext !== -1) {
          const tabExists = await new Promise<boolean>((resolve) => {
            chrome.tabs.get(state.tabContext, (tab) => {
              if (chrome.runtime.lastError || !tab) {
                resolve(false);
              } else {
                resolve(true);
              }
            });
          });
          if (!tabExists) {
            logger.warn('ServiceWorker', `Tab ${state.tabContext} no longer exists. Reclaiming stale mutex.`);
            await StorageManager.setExecutionState({
              ...state,
              mutexLock: null,
              status: ExecutionStatus.IDLE
            });
          }
        }
      }
    } catch (err) {
      logger.error('ServiceWorker', 'Failed to reclaim stale mutex:', err);
    }
  }
});

RecordingQueueHandler.restoreQueue().catch((err) => {
  logger.error('ServiceWorker', 'Failed to restore recording queue on startup:', err);
});

if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    RecordingQueueHandler.flushQueue().catch((err) => {
      logger.warn('ServiceWorker', 'Failed to flush recording queue during suspend:', err);
    });
  });
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

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
      chrome.storage.local.set({ lastActiveWebTabId: tab.id });
    }
  });
});

chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
  if (tab && tab.id && tab.active && tab.url && !tab.url.startsWith('chrome-extension://')) {
    chrome.storage.local.set({ lastActiveWebTabId: tab.id });
  }
});

// Helper for sending messages with retry to loaded tabs using linear backoff and a timeout race
async function sendMessageWithRetry(tabId: number, message: any, retries = 5, delay = 1000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await Promise.race([
        chrome.tabs.sendMessage(tabId, message),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tab message timeout')), 2000))
      ]);
      return result;
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn('ServiceWorker', `Failed to send message to tab ${tabId}, retrying... (Attempt ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1))); // linear backoff
    }
  }
}

// ─── SELF-HEALING CONTENT SCRIPT CONNECTION ─────────────────────────────
// Root cause of "Could not establish connection. Receiving end does not exist":
// content_scripts declared in manifest.json only auto-inject on NEW navigations.
// If the extension is reloaded (e.g. during development) while the automation
// tab is already open, that tab keeps running with no content script at all,
// and every chrome.tabs.sendMessage to it fails permanently — retries don't help
// because there's nothing wrong with timing, there's just no listener present.
//
// Fix: on a "no receiver" failure, programmatically inject the content script
// directly into the live tab (no page reload, so in-progress form state and
// scroll position survive) and retry once it's had a moment to register its
// chrome.runtime.onMessage listener.

// Reads the content script's actual built file list from the manifest, so this
// keeps working whether the paths are unhashed (vite dev) or hashed (vite build)
// without us hardcoding a filename anywhere.
function getContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  return manifest.content_scripts?.[0]?.js ?? [];
}

// Safe to call even if the content script is already present and healthy:
// executor.ts and recorder.ts both guard their instantiation with a
// `globalThis.__FP_*_INIT__` flag, so a redundant injection is a harmless
// no-op rather than a duplicate Executor/RecordingEngine instance.
async function injectContentScript(tabId: number): Promise<boolean> {
  const files = getContentScriptFiles();
  if (files.length === 0) {
    logger.error('ServiceWorker', 'No content_scripts declared in manifest; cannot self-heal.');
    return false;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch (err) {
    // Expected to fail on restricted pages (chrome://, Chrome Web Store, PDF viewer, etc.)
    // where the extension is not permitted to inject scripts.
    logger.error('ServiceWorker', `Programmatic injection into tab ${tabId} failed:`, err);
    return false;
  }
}

function isMissingReceiverError(err: any): boolean {
  const msg = (err?.message || String(err) || '').toLowerCase();
  return msg.includes('could not establish connection') || msg.includes('receiving end does not exist');
}

// Sends a control message to a tab, self-healing a missing content script by
// injecting it live and retrying, instead of failing silently forever.
async function sendMessageWithSelfHeal(tabId: number, message: any): Promise<any> {
  try {
    return await sendMessageWithRetry(tabId, message, 2, 400);
  } catch (err) {
    if (!isMissingReceiverError(err)) throw err;

    logger.warn('ServiceWorker', `No content script listening in tab ${tabId}. Attempting self-heal via programmatic injection...`);
    const injected = await injectContentScript(tabId);
    if (!injected) throw err;

    // Give the freshly injected script a brief moment to run its constructor
    // and register its message listener before we retry.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return await sendMessageWithRetry(tabId, message, 3, 500);
  }
}

// Called only once self-healing has been exhausted. Surfaces the failure to the
// UI as a genuine FAILED state instead of leaving it stuck showing "RUNNING"
// forever with no execution actually happening (previously-diagnosed pattern:
// optimistic UI updates were masking silent delivery failures).
async function handleUnrecoverableRouting(tabId: number, message: FormPilotMessage): Promise<void> {
  logger.error('ServiceWorker', `Giving up routing ${message.type} to tab ${tabId}: content script unreachable even after self-heal.`);

  const isExecutionControl =
    message.type === MessageType.START_EXECUTION ||
    message.type === MessageType.PAUSE_EXECUTION ||
    message.type === MessageType.RESUME_EXECUTION ||
    message.type === MessageType.ABORT_EXECUTION;

  if (!isExecutionControl) return;

  try {
    const state = await StorageManager.getExecutionState();
    if (!state || state.status === ExecutionStatus.COMPLETE) return;

    const failedState = { ...state, status: ExecutionStatus.FAILED, mutexLock: null };
    await StorageManager.setExecutionState(failedState);

    await StorageManager.addLogEntry({
      id: crypto.randomUUID(),
      sessionId: state.sessionId,
      rowIndex: state.currentRowIndex,
      stepId: "SYSTEM",
      action: Action.WAIT,
      selector: "content-script",
      result: StepResult.FAILED,
      status: "FAILED",
      error: `Lost connection to the automation tab (id ${tabId}) and could not reconnect. The tab may have navigated to a restricted page (chrome://, Web Store) or been closed. Reopen the target page and try again.`,
      retryCount: 0,
      duration: 0,
      timestamp: Date.now()
    });

    chrome.runtime.sendMessage({
      type: MessageType.STATE_UPDATE,
      payload: { state: failedState },
      timestamp: Date.now()
    }).catch(() => {});
  } catch (err) {
    logger.error('ServiceWorker', 'Failed to persist failure state after routing gave up:', err);
  }
}

// Handle closed tabs gracefully
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Check active recording tab
  const activeRecTab = await RecordingQueueHandler.getActiveTab();
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
    await RecordingQueueHandler.setActiveTab(null);
    // Broadcast state update
    chrome.runtime.sendMessage({
      type: MessageType.STATE_UPDATE,
      payload: {},
      timestamp: Date.now()
    }).catch((err) => logger.warn('ServiceWorker', 'Failed to broadcast recording tab close update:', err));
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
    }).catch((err) => logger.warn('ServiceWorker', 'Failed to broadcast execution tab close update:', err));
  }
});

chrome.runtime.onMessage.addListener((message: FormPilotMessage, sender, sendResponse) => {
  // BUG-AUDIT-08 fix: Reject messages from other extensions (defense-in-depth).
  // Chrome scopes onMessage to this extension's own contexts by default, but if
  // externally_connectable is ever added, this guard prevents foreign messages.
  if (sender.id && sender.id !== chrome.runtime.id) return;

  const tabId = message.tabId || sender.tab?.id;
  if (tabId && !message.tabId) {
    message.tabId = tabId;
  }

  // 1. Start Recording: Save state and route to content script in current tab
  if (message.type === MessageType.START_RECORDING) {
    const payload = message.payload as { recordingId: string; url: string };
    
    const setupRecording = async () => {
      let targetTabId: number | null = tabId || null;
      if (!targetTabId) {
        const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });
        targetTabId = tabs[0]?.id || null;
      }

      if (targetTabId) {
        await RecordingQueueHandler.setActiveTab(targetTabId);
      }
      
      RecordingQueueHandler.resetQueue();

      await StorageManager.setRecordingState({
        isRecording: true,
        activeRecordingSteps: [],
        activeRecordingUrl: payload.url,
        recordingId: payload.recordingId
      });

      if (targetTabId) {
        await sendMessageWithSelfHeal(targetTabId, message);
      }
    };

    setupRecording()
      .then(() => sendResponse({ received: true }))
      .catch((err) => {
        logger.error('ServiceWorker', 'Failed to start recording:', err);
        sendResponse({ error: err.message });
      });

    return true; // Keep channel open for async response
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
    const handleStop = async () => {
      const targetTabId = tabId || await RecordingQueueHandler.getActiveTab();
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, message).catch((err) => {
          logger.warn('ServiceWorker', `Failed to route STOP_RECORDING to tab ${targetTabId}:`, err);
        });
      }
      await RecordingQueueHandler.setActiveTab(null);
    };
    handleStop()
      .then(() => sendResponse({ received: true }))
      .catch((err) => {
        logger.error('ServiceWorker', 'Failed to stop recording:', err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open
  }

  // 2b. Intercept Recording Events to persist steps even when Popup is closed
  if (message.type === MessageType.RECORDING_EVENT) {
    const step = (message.payload as any)?.step;
    if (step) {
      const handleEvent = async () => {
        // Mutually exclude recording events if an automation run is currently active
        const execState = await StorageManager.getExecutionState();
        if (execState) {
          const status = execState.status;
          if (
            status === ExecutionStatus.RUNNING ||
            status === ExecutionStatus.PAUSED ||
            status === ExecutionStatus.CAPTCHA_PAUSED
          ) {
            logger.warn('ServiceWorker', 'Ignored RECORDING_EVENT because execution is active.', { status });
            return;
          }
        }

        if (sender.tab?.id) {
          await RecordingQueueHandler.setActiveTab(sender.tab.id);
        }
        RecordingQueueHandler.enqueueStep(step);
      };
      handleEvent()
        .then(() => sendResponse({ received: true }))
        .catch((err) => {
          logger.warn('ServiceWorker', 'Failed to persist recording event:', err);
          sendResponse({ received: false, error: err.message });
        });
      return true;
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
    if (message.type === MessageType.START_EXECUTION) {
      RecordingQueueHandler.setActiveTab(null);
      StorageManager.clearRecordingState().catch(() => {});
    }

    const routeToTab = (targetTabId: number) => {
      sendMessageWithSelfHeal(targetTabId, message)
        .then(() => {
          chrome.runtime.sendMessage({
            type: MessageType.EXECUTION_CONFIRMED,
            sessionId: message.sessionId,
            tabId: targetTabId,
            timestamp: Date.now(),
            payload: { messageType: message.type }
          }).catch(() => {}); // ignore error if listener is not active (e.g. popup closed)
        })
        .catch((err) => {
          logger.warn('ServiceWorker', `Failed to route ${message.type} to tab ${targetTabId} even after self-heal:`, err);
          handleUnrecoverableRouting(targetTabId, message);
        });
    };

    if (tabId) {
      routeToTab(tabId);
      sendResponse({ received: true });
    } else {
      // Fallback: query lastActiveWebTabId or active web tab
      logger.warn('ServiceWorker', `No tabId for ${message.type}, falling back to lastActiveWebTabId.`);
      chrome.storage.local.get('lastActiveWebTabId', (localData) => {
        const lastActiveWebTabId = localData.lastActiveWebTabId as number | undefined;
        if (lastActiveWebTabId) {
          routeToTab(lastActiveWebTabId);
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const fallbackTabId = tabs[0]?.id;
            if (fallbackTabId) {
              routeToTab(fallbackTabId);
            } else {
              logger.error('ServiceWorker', `Could not resolve any tab for ${message.type}`);
            }
          });
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
    if (!payload || typeof payload.recordingId !== 'string') {
      sendResponse({ error: "Invalid recordingId parameter" });
      return;
    }
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

  // 6b. Get File Blob from IndexedDB
  if (message.type === MessageType.GET_FILE_BLOB) {
    const payload = message.payload as { alias: string };
    if (!payload || typeof payload.alias !== 'string') {
      sendResponse({ error: "Invalid alias parameter" });
      return;
    }
    StorageManager.getFileBlob(payload.alias)
      .then(fileBlob => {
        sendResponse({ fileBlob });
      })
      .catch(err => {
        sendResponse({ error: err.message });
      });
    return true;
  }

  // 6c. Add Session Meta
  if (message.type === MessageType.ADD_SESSION_META) {
    const payload = message.payload as { meta: any };
    StorageManager.addSessionMeta(payload.meta)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // 6d. Get Session Metas
  if (message.type === MessageType.GET_SESSION_METAS) {
    StorageManager.getSessionMetas()
      .then(sessions => sendResponse({ sessions }))
      .catch(err => sendResponse({ error: err.message }));
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
