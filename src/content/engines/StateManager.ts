import { ExecutionState, ExecutionStatus } from "../../types";
import { StorageManager } from "../../storage/StorageManager";

export class StateManager {
  /**
   * Initializes a new execution session.
   * Blocks and throws an error if another session holds the mutex lock.
   */
  static async initializeSession(
    sessionId: string, 
    totalRows: number,
    recordingId?: string,
    siteUrl?: string,
    tabContext: number = -1
  ): Promise<ExecutionState> {
    const currentState = await StorageManager.getExecutionState();
    
    // Mutex check: prevent concurrent runs
    if (currentState?.mutexLock && currentState.mutexLock !== sessionId) {
      throw new Error(`Active session exists (ID: ${currentState.mutexLock}). Please abort or resume it first.`);
    }

    const newState: ExecutionState = {
      sessionId,
      currentRowIndex: 0,
      currentStepIndex: 0,
      currentPageId: "",
      status: ExecutionStatus.RUNNING, // Start as RUNNING, not IDLE
      totalRows,
      completedRows: 0,
      failedRows: 0,
      skippedRows: 0,
      pageRetryCount: 0,
      mutexLock: sessionId, // Set mutex lock
      captchaPending: false,
      tabContext,
      lastStepResult: "",
      recordingId: recordingId || undefined,
      siteUrl: siteUrl || undefined,
      currentUrl: window.location.href
    };

    await StorageManager.setExecutionState(newState);
    return newState;
  }

  /**
   * Retrieves the current execution state snapshot.
   */
  static async getState(): Promise<ExecutionState | null> {
    return StorageManager.getExecutionState();
  }

  static async updateState(updates: Partial<ExecutionState>): Promise<ExecutionState> {
    const currentState = await StorageManager.getExecutionState();
    if (!currentState) {
      throw new Error("Cannot update state: No active session found in storage.");
    }

    const updatedState = { 
      ...currentState, 
      ...updates,
      currentUrl: window.location.href // Keep currentUrl updated dynamically
    };
    await StorageManager.setExecutionState(updatedState);
    return updatedState;
  }

  /**
   * Increments the page retry count. Escalate to fatal if over limit.
   */
  static async incrementPageRetry(maxPageRetries: number): Promise<boolean> {
    const state = await this.getState();
    if (!state) return false;

    const newCount = state.pageRetryCount + 1;
    await this.updateState({ pageRetryCount: newCount });

    // Returns true if we've exceeded the max
    return newCount > maxPageRetries;
  }

  /**
   * Clears the execution state completely (used on COMPLETE, FATAL error, or user ABORT).
   * This releases the mutex lock.
   */
  static async clearSession(): Promise<void> {
    await StorageManager.clearExecutionState();
  }

  /**
   * Aborts the current session and releases the mutex.
   */
  static async abortSession(): Promise<void> {
    await this.clearSession();
  }
}
