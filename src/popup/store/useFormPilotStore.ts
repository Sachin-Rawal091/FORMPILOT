import { create } from 'zustand';
import { createNavSlice, NavSlice, TabType } from './slices/navSlice';
import { createRecordingSlice, RecordingSlice } from './slices/recordingSlice';
import { createDataSlice, DataSlice } from './slices/dataSlice';
import { createExecutionSlice, ExecutionSlice, clearConfirmationTimeout } from './slices/executionSlice';
import { createSettingsSlice, SettingsSlice } from './slices/settingsSlice';

import { StorageManager } from '../../storage/StorageManager';
import { 
  Action,
  ExecutionState, 
  ExecutionStatus, 
  MessageType, 
  FormPilotMessage, 
  Step
} from '../../types';
import { logger } from '../../utils/logger';
import { CAPTCHA_SOLVE_TIMEOUT } from '../../shared/constants';

interface FormPilotStoreState extends NavSlice, RecordingSlice, DataSlice, ExecutionSlice, SettingsSlice {
  // Initialization & Message Bus Listener
  initStore: () => Promise<void>;
  cleanupStoreListener: (() => void) | null;
}

export const useFormPilotStore = create<FormPilotStoreState>((set, get) => {
  let messageListener: ((message: any, sender: any, sendResponse: any) => void) | null = null;

  return {
    // Nav Slice
    ...createNavSlice(set, get, {} as any),

    // Recording Slice
    ...createRecordingSlice(set, get, {} as any),

    // Data Slice
    ...createDataSlice(set, get, {} as any),

    // Execution Slice
    ...createExecutionSlice(set, get, {} as any),

    // Settings Slice
    ...createSettingsSlice(set, get, {} as any),

    // Init & Listeners
    cleanupStoreListener: null,

    initStore: async () => {
      // Expose to window for testing/debugging
      if (typeof window !== 'undefined') {
        (window as any).store = {
          getState: () => get(),
          setState: (newState: any) => set(newState)
        };
      }

      // 1. Load basic recordings from DB
      await get().loadRecordings();

      // 2. Hydrate execution state
      await get().loadExecutionState();

      // 2b. Hydrate active recording state
      try {
        const activeRec = await StorageManager.getRecordingState();
        if (activeRec && activeRec.isRecording) {
          set({
            isRecording: true,
            activeRecordingSteps: activeRec.activeRecordingSteps,
            activeRecordingUrl: activeRec.activeRecordingUrl,
            activeTab: 'recording'
          });
        }
      } catch (err) {
        logger.error('FormPilotStore', 'Failed to hydrate recording state:', err);
      }

      // 2c. Hydrate user settings and theme
      try {
        const settings = await StorageManager.getUserSettings();
        const defaultSettings = {
          stepDelay: 100,
          maxStepRetries: 3,
          waitElementTimeout: 10000,
          logMaxEntries: 1000,
          logRetentionDays: 30,
          theme: 'dark' as const
        };
        const activeSettings = { ...defaultSettings, ...settings };
        set({ settings: activeSettings });

        // Apply theme to document element
        if (activeSettings.theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } catch (err) {
        logger.error('FormPilotStore', 'Failed to hydrate settings:', err);
      }

      // 3. Register Chrome message channel listener
      if (messageListener) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }

      messageListener = (message: FormPilotMessage<any>, _sender, sendResponse) => {
        const handledTypes = [
          MessageType.STATE_UPDATE,
          MessageType.RECORDING_EVENT,
          MessageType.EXECUTION_COMPLETE,
          MessageType.CAPTCHA_DETECTED,
          MessageType.EXECUTION_CONFIRMED
        ];
        
        if (!handledTypes.includes(message.type)) {
          return false;
        }

        logger.debug('FormPilotStore', `Caught message: ${MessageType[message.type]}`);
        
        switch (message.type) {
          case MessageType.EXECUTION_CONFIRMED:
            clearConfirmationTimeout();
            if (get().executionState && get().executionState?.status === ExecutionStatus.STARTING) {
              const newState = {
                ...get().executionState!,
                status: ExecutionStatus.RUNNING
              };
              set({ executionState: newState });
            }
            break;

          case MessageType.STATE_UPDATE:
            clearConfirmationTimeout();
            if (message.payload?.state) {
              const newState = message.payload.state as ExecutionState;
              set({ executionState: newState });
              
              if (
                newState.status === ExecutionStatus.RUNNING || 
                newState.status === ExecutionStatus.PAUSED || 
                newState.status === ExecutionStatus.CAPTCHA_PAUSED ||
                newState.status === ExecutionStatus.STARTING
              ) {
                set({ activeTab: 'run' });
              }

              get().loadLogs(newState.sessionId);
            }
            break;

          case MessageType.RECORDING_EVENT: {
            // Ignore recording events if execution is active
            const currentExecState = get().executionState;
            const isExecActive = currentExecState && (
              currentExecState.status === ExecutionStatus.RUNNING ||
              currentExecState.status === ExecutionStatus.PAUSED ||
              currentExecState.status === ExecutionStatus.CAPTCHA_PAUSED ||
              currentExecState.status === ExecutionStatus.STARTING
            );
            if (isExecActive) {
              logger.warn('FormPilotStore', 'Ignored RECORDING_EVENT because execution is active.');
              break;
            }
            if (message.payload?.step) {
              const step = message.payload.step as Step;
              const url = message.payload.url as string;
              
              const mergeableActions = [
                Action.SELECT,
                Action.FILL,
                Action.SELECT_RADIO,
                Action.TOGGLE_CHECKBOX,
                Action.DATEPICKER,
                Action.RICH_TEXT
              ];

              set((prev: any) => {
                const steps = [...prev.activeRecordingSteps];
                const lastStep = steps[steps.length - 1];
                if (
                  lastStep &&
                  lastStep.action === step.action &&
                  lastStep.selector === step.selector &&
                  mergeableActions.includes(step.action)
                ) {
                  const updatedSteps = [...steps];
                  updatedSteps[updatedSteps.length - 1] = {
                    ...lastStep,
                    value: step.value,
                    checked: step.checked
                  };
                  return {
                    activeRecordingSteps: updatedSteps,
                    activeRecordingUrl: url || prev.activeRecordingUrl,
                    isRecording: true
                  };
                } else {
                  return {
                    activeRecordingSteps: [...steps, step],
                    activeRecordingUrl: url || prev.activeRecordingUrl,
                    isRecording: true
                  };
                }
              });
            }
            break;
          }

          case MessageType.EXECUTION_COMPLETE:
            if (message.payload?.state) {
              const finalState = message.payload.state as ExecutionState;
              set({ executionState: finalState });
              get().loadLogs(finalState.sessionId);
              
              // Only refresh the row count — never pull the full table into the popup
              StorageManager.getExcelDataCount().then(count => {
                if (count > 0) {
                  set({ excelRowCount: count });
                }
              }).catch(err => {
                logger.error('FormPilotStore', 'Failed to re-sync excelRowCount on EXECUTION_COMPLETE:', err);
              });
            }
            break;

          case MessageType.CAPTCHA_DETECTED:
            const msgPayload = message.payload as { timeLeft?: number };
            set((prev) => {
              if (prev.executionState) {
                return {
                  executionState: {
                    ...prev.executionState,
                    captchaPending: true,
                    status: ExecutionStatus.CAPTCHA_PAUSED,
                    captchaTimeLeft: msgPayload?.timeLeft ?? (CAPTCHA_SOLVE_TIMEOUT / 1000)
                  },
                  activeTab: 'run'
                };
              }
              return prev;
            });
            break;
        }

        sendResponse({ received: true });
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
    }
  };
});

export type { TabType };
