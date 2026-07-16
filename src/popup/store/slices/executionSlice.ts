import { StateCreator } from 'zustand';
import { ExecutionState, LogEntry, ExcelRow, RowStatus, ExecutionStatus, FormPilotMessage, MessageType, Action, StepResult } from '../../../types';
import { StorageManager } from '../../../storage/StorageManager';
import { EXCEL_CHUNK_SIZE } from '../../../shared/constants';
import { logger } from '../../../utils/logger';

// BUG-AUDIT-05: Module-level variables to track execution confirmation transit timeouts
let confirmationTimeout: ReturnType<typeof setTimeout> | null = null;

export function clearConfirmationTimeout() {
  if (confirmationTimeout) {
    clearTimeout(confirmationTimeout);
    confirmationTimeout = null;
    logger.debug('ExecutionSlice', 'Execution confirmation timeout cleared.');
  }
}

export interface ExecutionSlice {
  executionState: ExecutionState | null;
  recentLogs: LogEntry[];

  loadExecutionState: () => Promise<ExecutionState | null>;
  loadLogs: (sessionId: string) => Promise<void>;
  startExecution: () => Promise<void>;
  pauseExecution: () => Promise<void>;
  resumeExecution: () => Promise<void>;
  abortExecution: () => Promise<void>;
}

// BUG-FIX HELPER: Resolves the correct tab to send execution control messages to.
// Prefers the tab the session was actually launched against (tabContext), and only
// falls back to querying the active tab if that's somehow missing/stale.
async function resolveExecutionTabId(executionState: ExecutionState): Promise<number | null> {
  if (typeof executionState.tabContext === 'number' && executionState.tabContext >= 0) {
    try {
      const tab = await chrome.tabs.get(executionState.tabContext);
      if (tab && tab.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
        return tab.id;
      }
    } catch {
      // tabContext tab no longer exists — fall through to active-tab fallback
    }
  }
  try {
    const currentTab = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
      chrome.tabs.getCurrent(resolve);
    }).catch(() => undefined);
    const currentTabId = currentTab?.id;

    const tabs = await chrome.tabs.query({});
    const fallbackTab = tabs.find(tab => 
      tab.id && 
      tab.id !== currentTabId && 
      tab.url && 
      (tab.url.startsWith('http://') || tab.url.startsWith('https://'))
    );
    if (fallbackTab && fallbackTab.id) {
      return fallbackTab.id;
    }

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    if (activeTab && activeTab.id && activeTab.url && !activeTab.url.startsWith('chrome-extension://')) {
      return activeTab.id;
    }
  } catch {
    // Ignore error and return null
  }
  return null;
}

export const createExecutionSlice: StateCreator<any, [], [], ExecutionSlice> = (set, get) => ({
  executionState: null,
  recentLogs: [],
  loadExecutionState: async () => {
    try {
      const state = await StorageManager.getExecutionState();
      set({ executionState: state });
      if (state && state.sessionId) {
        await get().loadLogs(state.sessionId);
      }
      return state;
    } catch (err) {
      logger.error('ExecutionSlice', 'Failed to load execution state:', err);
      return null;
    }
  },

  loadLogs: async (sessionId: string) => {
    try {
      const logs = await StorageManager.getLogs(sessionId, 0, 500);
      set({ recentLogs: logs.sort((a, b) => b.timestamp - a.timestamp) });
    } catch (err) {
      logger.error('ExecutionSlice', `Failed to load logs for session ${sessionId}:`, err);
    }
  },

  startExecution: async () => {
    logger.info('ExecutionSlice', 'startExecution() invoked.');
    try {
      // Save current column mapping configuration to IndexedDB before executing
      if (get().saveMappings) {
        await get().saveMappings();
      }

      const selectedRecording = get().selectedRecording;
      const excelRowCount = get().excelRowCount;

      if (!selectedRecording) {
        throw new Error("No recording selected for automation.");
      }
      if (excelRowCount === 0) {
        throw new Error("No spreadsheet loaded. Please upload Excel data first.");
      }

      // 1. Double check mutex state from current sessions
      const currentSessionState = await StorageManager.getExecutionState();
      if (currentSessionState && currentSessionState.mutexLock !== null) {
        throw new Error("Another automation session is active. You must abort it first.");
      }

      // 2. Determine target tab: last active web tab, fallback to open web tabs, or fail
      // BUG-FIX: chrome.tabs.getCurrent's callback can fail to fire in some contexts,
      // which would hang this await forever with no visible error. Race it against a timeout.
      const currentTab = await Promise.race([
        new Promise<chrome.tabs.Tab | undefined>((resolve) => {
          chrome.tabs.getCurrent(resolve);
        }),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500))
      ]);
      const currentTabId = currentTab?.id;

    let targetTabId: number | null = null;

    // Check lastActiveWebTabId
    const localData = await chrome.storage.local.get('lastActiveWebTabId');
    const lastActiveWebTabId = localData.lastActiveWebTabId as number | undefined;

    if (typeof lastActiveWebTabId === 'number' && lastActiveWebTabId !== currentTabId) {
      try {
        const tab = await chrome.tabs.get(lastActiveWebTabId);
        if (tab && tab.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
          targetTabId = tab.id;
        }
      } catch {
        // Tab closed or inaccessible
      }
    }

    // Fallback: Find another web tab in any window
    if (!targetTabId) {
      const tabs = await chrome.tabs.query({});
      const fallbackTab = tabs.find(tab => 
        tab.id && 
        tab.id !== currentTabId && 
        tab.url && 
        (tab.url.startsWith('http://') || tab.url.startsWith('https://'))
      );
      if (fallbackTab && fallbackTab.id) {
        targetTabId = fallbackTab.id;
      }
    }

    // Safeguard: If no valid web page tab is open, stop and show alert
    if (!targetTabId) {
      throw new Error("Please open a web page tab before running automation.");
    }

    const sessionId = crypto.randomUUID();

    // Pre-scan row statuses from IndexedDB (paginated) so the UI immediately shows correct stats
    let initialCompleted = 0;
    let initialSkipped = 0;
    let initialFailed = 0;
    let totalExcelRows = 0;
    try {
      totalExcelRows = await StorageManager.getExcelDataCount();
      let lastRowIndex: number | undefined = undefined;
      for (let offset = 0; offset < totalExcelRows; offset += EXCEL_CHUNK_SIZE) {
        // Use actual IDB rowIndex from previous chunk's last row as cursor boundary
        const afterRowIndex = offset > 0 ? lastRowIndex : undefined;
        const chunk = await StorageManager.getExcelData(afterRowIndex, EXCEL_CHUNK_SIZE);
        if (chunk.length > 0) {
          lastRowIndex = chunk[chunk.length - 1].rowIndex;
        }
        chunk.forEach((row: ExcelRow) => {
          if (row.status === RowStatus.SUCCESS) initialCompleted++;
          else if (row.status === RowStatus.SKIPPED) initialSkipped++;
          else if (row.status === RowStatus.FAILED) initialFailed++;
        });
      }
    } catch (err) {
      // Key is gone/corrupted - wipe unrecoverable data and reset popup state
      await StorageManager.setExcelData([], true);
      const store = (await import('../useFormPilotStore')).useFormPilotStore;
      store.setState({ excelData: [], excelRowCount: 0, excelHeaders: [], fuzzyMapping: {} });
      throw new Error("Your previous spreadsheet data could not be decrypted and has been cleared. Please re-upload your Excel file.");
    }

    // 3. Create the initial execution state
    const initialState: ExecutionState = {
      sessionId,
      currentRowIndex: 0,
      currentStepIndex: 0,
      currentPageId: "",
      status: ExecutionStatus.STARTING,
      totalRows: totalExcelRows,
      completedRows: initialCompleted,
      failedRows: initialFailed,
      skippedRows: initialSkipped,
      pageRetryCount: 0,
      mutexLock: sessionId,
      captchaPending: false,
      tabContext: targetTabId,
      recordingId: selectedRecording.id,
      siteUrl: selectedRecording.siteUrl,
      currentUrl: selectedRecording.siteUrl,
      lastStepResult: ""
    };

    // Save state to storage proxy BEFORE sending execute message
    await StorageManager.setExecutionState(initialState);
    await StorageManager.addSessionMeta({
      sessionId,
      timestamp: Date.now(),
      recordingId: selectedRecording.id
    }).catch(err => logger.warn('ExecutionSlice', 'Failed to add session meta:', err));

    // Clear active recording state so popup doesn't redirect/hydrate to recording
    try {
      await StorageManager.clearRecordingState();
    } catch (err) {
      logger.warn('ExecutionSlice', 'Failed to clear recording state on execution start:', err);
    }

    set({ 
      executionState: initialState, 
      recentLogs: [], 
      activeTab: 'run',
      isRecording: false,
      activeRecordingSteps: [],
      activeRecordingUrl: ''
    });

    // 4. Send START_EXECUTION message to background
    const startMsg: FormPilotMessage = {
      type: MessageType.START_EXECUTION,
      sessionId,
      payload: { recordingId: selectedRecording.id, sessionId },
      tabId: targetTabId,
      timestamp: Date.now()
    };

      await chrome.runtime.sendMessage(startMsg).catch(err => {
        logger.error('ExecutionSlice', 'Failed to send START_EXECUTION message:', err);
        throw new Error("Failed to communicate with service worker. Make sure extension is reloaded.");
      });

      // BUG-AUDIT-05: Start 5s timeout to treat as failed if no confirmation is received
      clearConfirmationTimeout();
      confirmationTimeout = setTimeout(async () => {
        const currentExecState = get().executionState;
        if (currentExecState && currentExecState.status === ExecutionStatus.STARTING) {
          logger.error('ExecutionSlice', 'No EXECUTION_CONFIRMED or STATE_UPDATE received within 5s — treating as failed.');
          const failedState = {
            ...currentExecState,
            status: ExecutionStatus.FAILED,
            mutexLock: null
          };
          await StorageManager.setExecutionState(failedState).catch(() => {});
          set({ executionState: failedState });
          
          try {
            await StorageManager.addLogEntry({
              id: crypto.randomUUID(),
              sessionId: currentExecState.sessionId,
              rowIndex: currentExecState.currentRowIndex,
              stepId: "SYSTEM",
              action: Action.WAIT,
              selector: "content-script",
              result: StepResult.FAILED,
              status: "FAILED",
              error: "No response from the automation tab. It may have closed, crashed, or been on a restricted page (chrome://, Web Store) — please try again.",
              retryCount: 0,
              duration: 0,
              timestamp: Date.now()
            });
            await get().loadLogs(currentExecState.sessionId);
          } catch (e) {
            logger.error('ExecutionSlice', 'Failed to save fallback failure log:', e);
          }
        }
      }, 5000);

      logger.info('ExecutionSlice', 'startExecution() completed successfully.', { sessionId, targetTabId });
    } catch (err: any) {
      // BUG-FIX: this top-level catch guarantees every failure path (including hangs,
      // unexpected exceptions, and chrome.* API errors) is both logged to the console
      // AND re-thrown so DataScreen.tsx's error banner always has something to show.
      logger.error('ExecutionSlice', 'startExecution() failed:', err);
      throw err;
    }
  },

  pauseExecution: async () => {
    const { executionState } = get();
    if (!executionState) return;

    const updatedState = {
      ...executionState,
      status: ExecutionStatus.PAUSED
    };
    set({ executionState: updatedState });
    await StorageManager.setExecutionState(updatedState).catch(() => {});

    // BUG-FIX (regression of 2026-06-23 fix, lost in slice refactor):
    // Control messages MUST carry an explicit tabId. Without it, service-worker.ts
    // falls back to the currently ACTIVE tab (usually the Dashboard tab itself,
    // since that's what's focused when you click this button) instead of the
    // tab actually running the automation. Resolve from tabContext first.
    const tabId = await resolveExecutionTabId(executionState);

    const msg: FormPilotMessage = {
      type: MessageType.PAUSE_EXECUTION,
      sessionId: executionState.sessionId,
      payload: {},
      tabId: tabId ?? undefined,
      timestamp: Date.now()
    };
    logger.info('ExecutionSlice', 'Sending PAUSE_EXECUTION', { tabId });
    await chrome.runtime.sendMessage(msg).catch((err) => {
      logger.warn('ExecutionSlice', 'PAUSE_EXECUTION message failed:', err);
    });
  },

  resumeExecution: async () => {
    const { executionState } = get();
    if (!executionState) return;

    const updatedState = {
      ...executionState,
      status: ExecutionStatus.RUNNING
    };
    set({ executionState: updatedState });
    await StorageManager.setExecutionState(updatedState).catch(() => {});

    const tabId = await resolveExecutionTabId(executionState);

    const msg: FormPilotMessage = {
      type: MessageType.RESUME_EXECUTION,
      sessionId: executionState.sessionId,
      payload: {},
      tabId: tabId ?? undefined,
      timestamp: Date.now()
    };
    logger.info('ExecutionSlice', 'Sending RESUME_EXECUTION', { tabId });
    await chrome.runtime.sendMessage(msg).catch((err) => {
      logger.warn('ExecutionSlice', 'RESUME_EXECUTION message failed:', err);
    });
  },

  abortExecution: async () => {
    const { executionState } = get();
    if (!executionState) return;

    const tabId = await resolveExecutionTabId(executionState);

    const msg: FormPilotMessage = {
      type: MessageType.ABORT_EXECUTION,
      sessionId: executionState.sessionId,
      payload: {},
      tabId: tabId ?? undefined,
      timestamp: Date.now()
    };
    logger.info('ExecutionSlice', 'Sending ABORT_EXECUTION', { tabId });
    await chrome.runtime.sendMessage(msg).catch((err) => {
      logger.warn('ExecutionSlice', 'ABORT_EXECUTION message failed:', err);
    });

    // BUG-FIX: Also proactively clear local + storage state so the UI never gets
    // stuck showing a stale RUNNING session if the tab-side abort silently fails
    // (e.g. the tab was already closed or unreachable).
    await StorageManager.clearExecutionState().catch(() => {});
    set({ executionState: null, activeTab: 'home' });
  }
});
