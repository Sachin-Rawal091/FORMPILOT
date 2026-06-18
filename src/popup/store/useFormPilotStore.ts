import { create } from 'zustand';
import { StorageManager } from '../../storage/StorageManager';
import { ExcelDataEngine } from '../../utils/ExcelDataEngine';
import { 
  Recording, 
  ExcelRow, 
  ExecutionState, 
  LogEntry, 
  ExecutionStatus, 
  MessageType, 
  FormPilotMessage, 
  Step
} from '../../types';

export type TabType = 'home' | 'recording' | 'data' | 'run' | 'logs';

interface FormPilotStoreState {
  // Navigation / Tabs
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Recordings
  recordings: Recording[];
  selectedRecording: Recording | null;
  setSelectedRecording: (recording: Recording | null) => void;
  loadRecordings: () => Promise<void>;
  startRecording: (url: string) => Promise<void>;
  stopRecording: (name: string) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;

  // Recording Live Capture
  activeRecordingSteps: Step[];
  activeRecordingUrl: string;
  isRecording: boolean;

  // Excel Upload & Mapping
  excelData: ExcelRow[];
  excelHeaders: string[];
  fuzzyMapping: Record<string, string>; // step.id -> excelColumnName
  isExcelLoading: boolean;
  parseExcel: (file: File) => Promise<void>;
  setMapping: (stepId: string, columnName: string) => void;
  saveMappings: () => Promise<void>;

  // Execution & Mutex
  executionState: ExecutionState | null;
  recentLogs: LogEntry[];
  loadExecutionState: () => Promise<ExecutionState | null>;
  loadLogs: (sessionId: string) => Promise<void>;
  startExecution: () => Promise<void>;
  pauseExecution: () => Promise<void>;
  resumeExecution: () => Promise<void>;
  abortExecution: () => Promise<void>;

  // Initialization & Message Bus Listener
  initStore: () => Promise<void>;
  cleanupStoreListener: (() => void) | null;
}

export const useFormPilotStore = create<FormPilotStoreState>((set, get) => {
  let messageListener: ((message: any, sender: any, sendResponse: any) => void) | null = null;

  return {
    // Nav
    activeTab: 'home',
    setActiveTab: (tab) => set({ activeTab: tab }),

    // Recordings
    recordings: [],
    selectedRecording: null,
    setSelectedRecording: (recording) => set({ selectedRecording: recording }),

    // Recording State
    activeRecordingSteps: [],
    activeRecordingUrl: '',
    isRecording: false,

    // Excel & Mapping State
    excelData: [],
    excelHeaders: [],
    fuzzyMapping: {},
    isExcelLoading: false,

    // Execution & Logs
    executionState: null,
    recentLogs: [],

    // Init & Listeners
    cleanupStoreListener: null,

    initStore: async () => {
      // 1. Load basic recordings from DB
      await get().loadRecordings();

      // 2. Hydrate execution state
      await get().loadExecutionState();

      // 2b. Hydrate active recording state
      try {
        const activeRec = await StorageManager.getRecordingState();
        console.log("initStore: Hydrating recording state:", {
          hasState: !!activeRec,
          isRecording: activeRec?.isRecording,
          stepCount: activeRec?.activeRecordingSteps?.length,
          url: activeRec?.activeRecordingUrl
        });
        if (activeRec && activeRec.isRecording) {
          set({
            isRecording: true,
            activeRecordingSteps: activeRec.activeRecordingSteps,
            activeRecordingUrl: activeRec.activeRecordingUrl,
            activeTab: 'recording'
          });
        }
      } catch (err) {
        console.error("Zustand: Failed to hydrate recording state:", err);
      }

      // 3. Register Chrome message channel listener
      if (messageListener) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }

      messageListener = (message: FormPilotMessage<any>, _sender, sendResponse) => {
        // IMPORTANT: Only handle messages that the popup cares about.
        // Do NOT call sendResponse for messages meant for the service worker 
        // (e.g., GET_STATUS, START_RECORDING, STOP_RECORDING) as that would
        // intercept the SW's async response before it reaches the content script.
        const handledTypes = [
          MessageType.STATE_UPDATE,
          MessageType.RECORDING_EVENT,
          MessageType.EXECUTION_COMPLETE,
          MessageType.CAPTCHA_DETECTED
        ];
        
        if (!handledTypes.includes(message.type)) {
          // Not a message for the popup — don't respond, let the SW handle it
          return false;
        }

        console.log("Zustand store caught message:", message.type);
        
        switch (message.type) {
          case MessageType.STATE_UPDATE:
            if (message.payload?.state) {
              const newState = message.payload.state as ExecutionState;
              set({ executionState: newState });
              
              // Auto route to run screen if execution starts running
              if (
                newState.status === ExecutionStatus.RUNNING || 
                newState.status === ExecutionStatus.PAUSED || 
                newState.status === ExecutionStatus.CAPTCHA_PAUSED
              ) {
                set({ activeTab: 'run' });
              }

              // Load logs for the current active session
              get().loadLogs(newState.sessionId);
            }
            break;

          case MessageType.RECORDING_EVENT:
            if (message.payload?.step) {
              const step = message.payload.step as Step;
              const url = message.payload.url as string;
              set((prev) => ({
                activeRecordingSteps: [...prev.activeRecordingSteps, step],
                activeRecordingUrl: url || prev.activeRecordingUrl,
                isRecording: true
              }));
            }
            break;

          case MessageType.EXECUTION_COMPLETE:
            if (message.payload?.state) {
              const finalState = message.payload.state as ExecutionState;
              set({ executionState: finalState });
              get().loadLogs(finalState.sessionId);
              
              // Re-sync excelData from IndexedDB so the popup reflects
              // per-row status updates (success/fail/skipped) that the
              // executor wrote directly to IDB during execution.
              StorageManager.getExcelData().then(freshRows => {
                if (freshRows && freshRows.length > 0) {
                  set({ excelData: freshRows });
                }
              }).catch(err => {
                console.error("Zustand: Failed to re-sync excelData on EXECUTION_COMPLETE:", err);
              });
            }
            break;

          case MessageType.CAPTCHA_DETECTED:
            set((prev) => {
              if (prev.executionState) {
                return {
                  executionState: {
                    ...prev.executionState,
                    status: ExecutionStatus.CAPTCHA_PAUSED,
                    captchaPending: true
                  }
                };
              }
              return {};
            });
            break;
        }

        sendResponse({ ack: true });
        return true;
      };

      chrome.runtime.onMessage.addListener(messageListener);

      set({
        cleanupStoreListener: () => {
          if (messageListener) {
            chrome.runtime.onMessage.removeListener(messageListener);
            messageListener = null;
          }
        }
      });
    },

    loadRecordings: async () => {
      try {
        const list = await StorageManager.getRecordings();
        set({ recordings: list });
      } catch (err) {
        console.error("Failed to load recordings from IDB:", err);
      }
    },

    loadExecutionState: async () => {
      try {
        const state = await StorageManager.getExecutionState();
        set({ executionState: state });

        // If there's an active running session, sync and redirect UI to Run Screen
        if (state && (
          state.status === ExecutionStatus.RUNNING ||
          state.status === ExecutionStatus.PAUSED ||
          state.status === ExecutionStatus.CAPTCHA_PAUSED
        )) {
          set({ activeTab: 'run' });
          await get().loadLogs(state.sessionId);
        }
        return state;
      } catch (err) {
        console.error("Failed to load ExecutionState:", err);
        return null;
      }
    },

    loadLogs: async (sessionId: string) => {
      try {
        const logs = await StorageManager.getLogs(sessionId);
        // Sort logs descending by timestamp
        set({ recentLogs: logs.sort((a, b) => b.timestamp - a.timestamp) });
      } catch (err) {
        console.error("Failed to load logs:", err);
      }
    },

    // Recording Controls
    startRecording: async (url: string) => {
      const recordingId = crypto.randomUUID();
      
      set({
        activeRecordingSteps: [],
        activeRecordingUrl: url,
        isRecording: true,
        activeTab: 'recording'
      });

      // Navigate current active tab to the target URL
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.update(tabs[0].id, { url });
        }
      });

      // Broadcast START_RECORDING to service worker
      const message: FormPilotMessage = {
        type: MessageType.START_RECORDING,
        sessionId: recordingId,
        payload: { recordingId, url },
        timestamp: Date.now()
      };
      
      chrome.runtime.sendMessage(message).catch(err => {
        console.error("Could not broadcast START_RECORDING:", err);
      });
    },

    stopRecording: async (name: string) => {
      const { recordings } = get();

      // 1. Read steps from persistent session storage FIRST (before any STOP signal)
      // This is the source of truth because the service worker persists every step here,
      // even when the popup was closed during recording.
      let steps: Step[] = [];
      let url = get().activeRecordingUrl;
      
      try {
        const recordingState = await StorageManager.getRecordingState();
        console.log("stopRecording: Read recording state from session storage:", {
          hasState: !!recordingState,
          isRecording: recordingState?.isRecording,
          stepCount: recordingState?.activeRecordingSteps?.length,
          url: recordingState?.activeRecordingUrl
        });
        
        if (recordingState && recordingState.activeRecordingSteps.length > 0) {
          steps = recordingState.activeRecordingSteps;
          url = recordingState.activeRecordingUrl || url;
        }
      } catch (err) {
        console.error("Zustand: Failed to read recording state from session storage:", err);
      }

      // 2. Merge with in-memory steps (popup may have received some RECORDING_EVENTs directly)
      const inMemorySteps = get().activeRecordingSteps;
      if (steps.length === 0 && inMemorySteps.length > 0) {
        console.log("stopRecording: Using in-memory steps as fallback. Count:", inMemorySteps.length);
        steps = inMemorySteps;
        url = get().activeRecordingUrl || url;
      } else if (inMemorySteps.length > steps.length) {
        // In-memory has MORE steps (popup was open the whole time and received all events)
        console.log("stopRecording: In-memory has more steps. Using in-memory:", inMemorySteps.length, "vs session:", steps.length);
        steps = inMemorySteps;
      }

      // 3. NOW send the STOP signal to the content script (after we've safely read the data)
      try {
        const stopMsg: FormPilotMessage = {
          type: MessageType.STOP_RECORDING,
          sessionId: crypto.randomUUID(),
          payload: {},
          timestamp: Date.now()
        };
        await chrome.runtime.sendMessage(stopMsg).catch(() => {});
      } catch {
        // Non-critical — recording will stop when page reloads anyway
      }

      console.log("stopRecording: Final step count to save:", steps.length, "URL:", url);

      // 4. If no steps were captured, just reset state and go home
      if (steps.length === 0) {
        console.warn("stopRecording: No steps captured. Clearing state without saving.");
        try { await StorageManager.clearRecordingState(); } catch {}
        set({ isRecording: false, activeTab: 'home', activeRecordingSteps: [], activeRecordingUrl: '' });
        return;
      }

      // 5. Group steps into distinct pages
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

      // 6. Derive siteId from host URL
      let siteId = "generic";
      try {
        siteId = new URL(url).hostname;
      } catch {}

      // 7. Build the Recording object
      const newRecording: Recording = {
        id: crypto.randomUUID(),
        name: name || `Recording on ${new Date().toLocaleDateString()}`,
        siteUrl: url,
        siteId,
        steps: steps,
        pages,
        pageCount: pages.length || 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1
      };

      // 8. Persist to IndexedDB
      try {
        const updatedRecordings = [...recordings, newRecording];
        await StorageManager.setRecordings(updatedRecordings);
        console.log("stopRecording: Successfully saved recording to IndexedDB:", newRecording.name, "with", steps.length, "steps");
        
        // 9. Only clear session storage AFTER successful IndexedDB write
        try { await StorageManager.clearRecordingState(); } catch {}

        set({
          recordings: updatedRecordings,
          selectedRecording: newRecording,
          isRecording: false,
          activeRecordingSteps: [],
          activeRecordingUrl: '',
          activeTab: 'home'
        });
      } catch (err) {
        console.error("stopRecording: CRITICAL — Failed to save recording to IndexedDB:", err);
        // Don't clear session storage so user can retry
        set({ isRecording: false, activeTab: 'home', activeRecordingSteps: [], activeRecordingUrl: '' });
      }
    },

    deleteRecording: async (id: string) => {
      const list = get().recordings.filter(rec => rec.id !== id);
      await StorageManager.setRecordings(list);
      set((prev) => ({
        recordings: list,
        selectedRecording: prev.selectedRecording?.id === id ? null : prev.selectedRecording
      }));
    },

    // Excel Parsers & Mappings
    parseExcel: async (file: File) => {
      set({ isExcelLoading: true });
      try {
        const buffer = await file.arrayBuffer();
        const rows = await ExcelDataEngine.parseExcelFile(buffer);
        
        await StorageManager.setExcelData(rows);

        // Get headers from first row data
        let headers: string[] = [];
        if (rows.length > 0) {
          headers = Object.keys(rows[0].data);
        }

        // Initialize fuzzy mapping for steps of currently selected recording
        const selected = get().selectedRecording;
        const mapping: Record<string, string> = {};

        if (selected && headers.length > 0) {
          selected.steps.forEach(step => {
            // Fuzzy match using label text first (matches Excel headers), then fallback to value
            const targetName = step.columnName || step.selectorMeta?.labelText || step.selectorMeta?.placeholder || step.selectorMeta?.name || step.value || "";
            if (targetName) {
              // Strip placeholder brackets {{ }} if they exist
              const cleanTarget = targetName.replace(/[{}]/g, '').trim();
              const match = ExcelDataEngine.fuzzyMatchColumn(cleanTarget, headers);
              if (match) {
                mapping[step.id] = match;
              }
            }
          });
        }

        set({
          excelData: rows,
          excelHeaders: headers,
          fuzzyMapping: mapping,
          isExcelLoading: false,
          activeTab: 'data'
        });
      } catch (err) {
        set({ isExcelLoading: false });
        console.error("Excel parse failed:", err);
        throw err;
      }
    },

    setMapping: (stepId: string, columnName: string) => {
      set((prev) => ({
        fuzzyMapping: {
          ...prev.fuzzyMapping,
          [stepId]: columnName
        }
      }));
    },

    saveMappings: async () => {
      const { selectedRecording, fuzzyMapping, recordings } = get();
      if (!selectedRecording) return;

      // Map column headers directly into Step objects
      const updatedSteps = selectedRecording.steps.map(step => {
        const mappedCol = fuzzyMapping[step.id];
        return {
          ...step,
          columnName: mappedCol || undefined,
          value: mappedCol ? `{{${mappedCol}}}` : step.value
        };
      });

      const updatedRecording = {
        ...selectedRecording,
        steps: updatedSteps,
        updatedAt: Date.now()
      };

      const updatedRecordings = recordings.map(rec => 
        rec.id === updatedRecording.id ? updatedRecording : rec
      );

      await StorageManager.setRecordings(updatedRecordings);
      set({
        recordings: updatedRecordings,
        selectedRecording: updatedRecording
      });
    },

    // Execution Queue Controls
    startExecution: async () => {
      const { selectedRecording, excelData } = get();
      if (!selectedRecording) {
        throw new Error("No recording selected for automation.");
      }
      if (excelData.length === 0) {
        throw new Error("No spreadsheet loaded. Please upload Excel data first.");
      }

      // 1. Double check mutex state from current sessions
      const currentSessionState = await StorageManager.getExecutionState();
      if (currentSessionState && currentSessionState.mutexLock !== null) {
        throw new Error("Another automation session is active. You must abort it first.");
      }

      // Save mapping changes before starting
      await get().saveMappings();

      const sessionId = crypto.randomUUID();

      // Find active tab ID to pass context
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = tabs[0]?.id || -1;

      // 2. Initialize initial Execution State
      const initState: ExecutionState = {
        sessionId,
        currentRowIndex: 0,
        currentStepIndex: 0,
        currentPageId: "",
        status: ExecutionStatus.RUNNING,
        totalRows: excelData.length,
        completedRows: 0,
        failedRows: 0,
        skippedRows: 0,
        pageRetryCount: 0,
        mutexLock: sessionId, // Set Mutex lock
        captchaPending: false,
        tabContext: activeTabId,
        lastStepResult: "",
        recordingId: selectedRecording.id,
        siteUrl: selectedRecording.siteUrl
      };

      await StorageManager.setExecutionState(initState);
      set({
        executionState: initState,
        recentLogs: [],
        activeTab: 'run'
      });

      // 3. Dispatch execution command to active tab content script
      const runMsg: FormPilotMessage = {
        type: MessageType.START_EXECUTION,
        sessionId,
        payload: {
          recordingId: selectedRecording.id,
          sessionId
        },
        tabId: activeTabId,
        timestamp: Date.now()
      };

      chrome.runtime.sendMessage(runMsg).catch(err => {
        console.error("Failed to transmit execution start command:", err);
      });
    },

    pauseExecution: async () => {
      const { executionState } = get();
      if (!executionState) return;

      const pauseMsg: FormPilotMessage = {
        type: MessageType.PAUSE_EXECUTION,
        sessionId: executionState.sessionId,
        payload: {},
        timestamp: Date.now()
      };

      await chrome.runtime.sendMessage(pauseMsg).catch(() => {});
      
      const updatedState = {
        ...executionState,
        status: ExecutionStatus.PAUSED
      };
      await StorageManager.setExecutionState(updatedState);
      set({ executionState: updatedState });
    },

    resumeExecution: async () => {
      const { executionState } = get();
      if (!executionState) return;

      const resumeMsg: FormPilotMessage = {
        type: MessageType.RESUME_EXECUTION,
        sessionId: executionState.sessionId,
        payload: {},
        timestamp: Date.now()
      };

      await chrome.runtime.sendMessage(resumeMsg).catch(() => {});
      
      const updatedState = {
        ...executionState,
        status: ExecutionStatus.RUNNING,
        captchaPending: false
      };
      await StorageManager.setExecutionState(updatedState);
      set({ executionState: updatedState });
    },

    abortExecution: async () => {
      const { executionState } = get();
      if (!executionState) return;

      const abortMsg: FormPilotMessage = {
        type: MessageType.ABORT_EXECUTION,
        sessionId: executionState.sessionId,
        payload: {},
        timestamp: Date.now()
      };

      await chrome.runtime.sendMessage(abortMsg).catch(() => {});

      const updatedState = {
        ...executionState,
        status: ExecutionStatus.IDLE,
        mutexLock: null // Release Mutex
      };
      await StorageManager.setExecutionState(updatedState);
      set({ executionState: updatedState });
    },
  };
});
