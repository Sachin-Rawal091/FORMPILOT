import { StorageManager } from "../../storage/StorageManager";
import { Step } from "../../types";
import { logger } from "../../utils/logger";

export class RecordingQueueHandler {
  // Track the tab we're recording on so we can route STOP to it
  private static activeRecordingTabId: number | null = null;

  // Serialize step persistence to prevent race conditions
  // when multiple RECORDING_EVENTs arrive rapidly
  private static stepQueue: Step[] = [];
  private static isProcessingQueue = false;
  private static readonly PENDING_QUEUE_KEY = 'pendingRecordingStepQueue';

  static async setActiveTab(tabId: number | null) {
    this.activeRecordingTabId = tabId;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        if (tabId === null) {
          await chrome.storage.session.remove('activeRecordingTabId');
        } else {
          await chrome.storage.session.set({ activeRecordingTabId: tabId });
        }
      }
    } catch (err) {
      logger.error('RecordingQueueHandler', 'Failed to save activeRecordingTabId to session storage:', err);
    }
  }

  static async getActiveTab(): Promise<number | null> {
    if (this.activeRecordingTabId !== null) {
      return this.activeRecordingTabId;
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        const data = await chrome.storage.session.get('activeRecordingTabId');
        this.activeRecordingTabId = (data.activeRecordingTabId as number) || null;
      }
    } catch (err) {
      logger.error('RecordingQueueHandler', 'Failed to read activeRecordingTabId from session storage:', err);
    }
    return this.activeRecordingTabId;
  }

  static enqueueStep(step: Step) {
    this.stepQueue.push(step);
    this.persistQueue().catch(err => {
      logger.warn('RecordingQueueHandler', 'Failed to persist pending recording queue:', err);
    });
    this.processStepQueue();
  }

  static resetQueue() {
    this.stepQueue = [];
    this.isProcessingQueue = false;
    this.persistQueue().catch(err => {
      logger.warn('RecordingQueueHandler', 'Failed to clear pending recording queue:', err);
    });
  }

  static async flushQueue(): Promise<void> {
    await this.restoreQueue();
    if (this.stepQueue.length > 0) {
      await this.processStepQueue();
    }
  }

  static async restoreQueue(): Promise<void> {
    if (this.stepQueue.length > 0) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        const data = await chrome.storage.session.get(this.PENDING_QUEUE_KEY);
        const pendingSteps = data[this.PENDING_QUEUE_KEY] as Step[] | undefined;
        if (Array.isArray(pendingSteps) && pendingSteps.length > 0) {
          this.stepQueue = pendingSteps;
          logger.info('RecordingQueueHandler', `Restored ${pendingSteps.length} pending step(s) from session storage.`);
        }
      }
    } catch (err) {
      logger.error('RecordingQueueHandler', 'Failed to restore pending recording queue:', err);
    }
  }

  private static async processStepQueue() {
    if (this.isProcessingQueue || this.stepQueue.length === 0) return;
    this.isProcessingQueue = true;

    try {
      const state = await StorageManager.getRecordingState();
      if (state && state.isRecording) {
        const pendingSteps = [...this.stepQueue];
        state.activeRecordingSteps.push(...pendingSteps);
        await StorageManager.setRecordingState(state);
        this.stepQueue.splice(0, pendingSteps.length);
        await this.persistQueue();
        logger.debug('RecordingQueueHandler', `Persisted ${pendingSteps.length} step(s). Total: ${state.activeRecordingSteps.length}`);
      } else {
        logger.warn('RecordingQueueHandler', 'Step queue had items but recording state is inactive. Clearing queue.');
        this.stepQueue = [];
        await this.persistQueue();
      }
    } catch (err) {
      logger.error('RecordingQueueHandler', 'Failed to persist steps from queue:', err);
    } finally {
      this.isProcessingQueue = false;
      // If more steps arrived while we were processing, process again
      if (this.stepQueue.length > 0) {
        this.processStepQueue();
      }
    }
  }

  private static async persistQueue(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return;
    if (this.stepQueue.length === 0) {
      await chrome.storage.session.remove(this.PENDING_QUEUE_KEY);
    } else {
      await chrome.storage.session.set({ [this.PENDING_QUEUE_KEY]: this.stepQueue });
    }
  }
}
