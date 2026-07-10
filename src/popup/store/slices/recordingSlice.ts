import { StateCreator } from 'zustand';
import { Recording, Step, FormPilotMessage, MessageType } from '../../../types';
import { StorageManager } from '../../../storage/StorageManager';
import { logger } from '../../../utils/logger';

export interface RecordingSlice {
  recordings: Recording[];
  selectedRecording: Recording | null;
  setSelectedRecording: (recording: Recording | null) => void;
  loadRecordings: () => Promise<void>;
  
  activeRecordingSteps: Step[];
  activeRecordingUrl: string;
  isRecording: boolean;

  startRecording: (url: string) => Promise<void>;
  stopRecording: (name: string) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
}

export const createRecordingSlice: StateCreator<any, [], [], RecordingSlice> = (set, get) => ({
  recordings: [],
  selectedRecording: null,
  setSelectedRecording: (recording) => set({ selectedRecording: recording }),

  activeRecordingSteps: [],
  activeRecordingUrl: '',
  isRecording: false,

  loadRecordings: async () => {
    const recs = await StorageManager.getRecordings();
    set({ recordings: recs.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  startRecording: async (url: string) => {
    const recordingId = crypto.randomUUID();
    
    // Save recording state in storage BEFORE navigating or creating tabs
    try {
      await StorageManager.setRecordingState({
        isRecording: true,
        activeRecordingSteps: [],
        activeRecordingUrl: url,
        recordingId: recordingId
      });
    } catch (err) {
      logger.error('RecordingSlice', 'Failed to pre-set recording state in storage:', err);
    }

    set({
      activeRecordingSteps: [],
      activeRecordingUrl: url,
      isRecording: true,
      activeTab: 'recording'
    });

    // Resolve the target tab: prefer the last active web tab, then any open web tab,
    // and only create a new tab as a last resort.
    const sendStart = (tabId: number) => {
      const message: FormPilotMessage = {
        type: MessageType.START_RECORDING,
        sessionId: recordingId,
        payload: { recordingId, url },
        tabId,
        timestamp: Date.now()
      };
      chrome.runtime.sendMessage(message).catch(err => {
        logger.error('RecordingSlice', 'Could not broadcast START_RECORDING:', err);
      });
    };

    try {
      // 1. Get the current dashboard tab ID so we never navigate it away
      const currentTab = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
        chrome.tabs.getCurrent((t) => resolve(t));
      });
      const currentTabId = currentTab?.id;

      let targetTabId: number | null = null;

      // 2. Check lastActiveWebTabId saved by the service worker
      const localData = await chrome.storage.local.get('lastActiveWebTabId');
      const lastActiveWebTabId = localData.lastActiveWebTabId as number | undefined;
      if (typeof lastActiveWebTabId === 'number' && lastActiveWebTabId !== currentTabId) {
        try {
          const tab = await chrome.tabs.get(lastActiveWebTabId);
          if (tab && tab.id && tab.url && !tab.url.startsWith('chrome-extension://')) {
            targetTabId = tab.id;
          }
        } catch {
          // Tab was closed or inaccessible
        }
      }

      // 3. Fallback: find any open http/https tab that is not the dashboard
      if (!targetTabId) {
        const tabs = await chrome.tabs.query({});
        const fallbackTab = tabs.find(t =>
          t.id &&
          t.id !== currentTabId &&
          t.url &&
          (t.url.startsWith('http://') || t.url.startsWith('https://'))
        );
        if (fallbackTab?.id) {
          targetTabId = fallbackTab.id;
        }
      }

      // 4. Use the existing tab — only navigate if it's on a different page
      if (targetTabId) {
        const existingTab = await chrome.tabs.get(targetTabId);
        const alreadyOnPage = existingTab.url && (() => {
          try {
            const current = new URL(existingTab.url!);
            const target = new URL(url);
            return current.origin === target.origin && current.pathname === target.pathname;
          } catch { return false; }
        })();

        if (alreadyOnPage) {
          // Already on the target page — just bring it to focus, no reload
          await chrome.tabs.update(targetTabId, { active: true });
        } else {
          // Different page — navigate to the recording URL
          await chrome.tabs.update(targetTabId, { url, active: true });
        }
        sendStart(targetTabId);
      } else {
        // 5. Last resort: no web tab open at all — create one
        chrome.tabs.create({ url, active: true }, (tab) => {
          if (tab?.id) {
            sendStart(tab.id);
          }
        });
      }
    } catch (err) {
      logger.error('RecordingSlice', 'Failed to resolve recording tab:', err);
      // Fallback to creating a new tab on any unexpected error
      chrome.tabs.create({ url, active: true }, (tab) => {
        if (tab?.id) {
          sendStart(tab.id);
        }
      });
    }
  },

  stopRecording: async (name: string) => {
    const { recordings } = get();

    let steps: Step[] = [];
    let url = get().activeRecordingUrl;
    
    try {
      const recordingState = await StorageManager.getRecordingState();
      logger.debug('RecordingSlice', 'Read recording state from session storage:', {
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
      logger.error('RecordingSlice', 'Failed to read recording state from session storage:', err);
    }

    const inMemorySteps = get().activeRecordingSteps;
    if (steps.length === 0 && inMemorySteps.length > 0) {
      logger.debug('RecordingSlice', `Using in-memory steps as fallback. Count: ${inMemorySteps.length}`);
      steps = inMemorySteps;
      url = get().activeRecordingUrl || url;
    } else if (inMemorySteps.length > steps.length) {
      logger.debug('RecordingSlice', `In-memory has more steps. Using ${inMemorySteps.length} vs session ${steps.length}.`);
      steps = inMemorySteps;
    }

    try {
      const stopMsg: FormPilotMessage = {
        type: MessageType.STOP_RECORDING,
        sessionId: crypto.randomUUID(),
        payload: {},
        timestamp: Date.now()
      };
      await chrome.runtime.sendMessage(stopMsg).catch((err) => {
        logger.warn('RecordingSlice', 'STOP_RECORDING message failed:', err);
      });
    } catch (err) {
      logger.warn('RecordingSlice', 'STOP_RECORDING dispatch threw:', err);
    }

    logger.debug('RecordingSlice', `Final step count to save: ${steps.length}. URL: ${url}`);

    if (steps.length === 0) {
      logger.warn('RecordingSlice', 'No steps captured. Clearing state without saving.');
      try { await StorageManager.clearRecordingState(); } catch (err) { logger.warn('RecordingSlice', 'Failed to clear empty recording state:', err); }
      set({ isRecording: false, activeTab: 'home', activeRecordingSteps: [], activeRecordingUrl: '' });
      return;
    }

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
    try {
      siteId = new URL(url).hostname;
    } catch {}

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

    try {
      const updatedRecordings = [...recordings, newRecording];
      await StorageManager.setRecordings(updatedRecordings);
      logger.info('RecordingSlice', `Saved recording "${newRecording.name}" with ${steps.length} steps.`);
      
      try { await StorageManager.clearRecordingState(); } catch (err) { logger.warn('RecordingSlice', 'Failed to clear recording state after save:', err); }

      set({
        recordings: updatedRecordings,
        selectedRecording: newRecording,
        isRecording: false,
        activeRecordingSteps: [],
        activeRecordingUrl: '',
        activeTab: 'home'
      });
    } catch (err) {
      logger.error('RecordingSlice', 'Failed to save recording to IndexedDB:', err);
      set({ isRecording: false, activeTab: 'home', activeRecordingSteps: [], activeRecordingUrl: '' });
    }
  },

  deleteRecording: async (id: string) => {
    const list = get().recordings.filter((rec: Recording) => rec.id !== id);
    await StorageManager.setRecordings(list);
    set((prev: RecordingSlice) => ({
      recordings: list,
      selectedRecording: prev.selectedRecording?.id === id ? null : prev.selectedRecording
    }));
  }
});
