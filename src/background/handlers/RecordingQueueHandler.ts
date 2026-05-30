import { StorageManager } from "../../storage/StorageManager";
import { Step } from "../../types";

export class RecordingQueueHandler {
  // Track the tab we're recording on so we can route STOP to it
  private static activeRecordingTabId: number | null = null;

  // Serialize step persistence to prevent race conditions
  // when multiple RECORDING_EVENTs arrive rapidly
  private static stepQueue: Step[] = [];
  private static isProcessingQueue = false;

  static setActiveTab(tabId: number | null) {
    this.activeRecordingTabId = tabId;
  }

  static getActiveTab(): number | null {
    return this.activeRecordingTabId;
  }

  static enqueueStep(step: Step) {
    this.stepQueue.push(step);
    this.processStepQueue();
  }

  static resetQueue() {
    this.stepQueue = [];
    this.isProcessingQueue = false;
  }

  static async flushQueue(): Promise<void> {
    if (this.stepQueue.length > 0) {
      await this.processStepQueue();
    }
  }

  private static async processStepQueue() {
    if (this.isProcessingQueue || this.stepQueue.length === 0) return;
    this.isProcessingQueue = true;

    try {
      const state = await StorageManager.getRecordingState();
      if (state && state.isRecording) {
        // Drain all queued steps at once
        const pendingSteps = this.stepQueue.splice(0);
        state.activeRecordingSteps.push(...pendingSteps);
        await StorageManager.setRecordingState(state);
        console.log(`SW: Persisted ${pendingSteps.length} step(s). Total: ${state.activeRecordingSteps.length}`);
      } else {
        console.warn("SW: Step queue had items but recording state is inactive. Clearing queue.");
        this.stepQueue = [];
      }
    } catch (err) {
      console.error("SW: Failed to persist steps from queue:", err);
    } finally {
      this.isProcessingQueue = false;
      // If more steps arrived while we were processing, process again
      if (this.stepQueue.length > 0) {
        this.processStepQueue();
      }
    }
  }
}