import { Step } from "../../types";
import { ExecutionEngine } from "./ExecutionEngine";
import { SmartWaitEngine } from "./SmartWaitEngine";
import { WAIT_ELEMENT_TIMEOUT, MAX_STEP_RETRIES, RETRY_BACKOFF_BASE, RETRY_BACKOFF_MAX } from "../../shared/constants";

export enum ErrorClassification {
  SKIPPABLE,
  RETRYABLE,
  FATAL,
}

export interface StepExecutionResult {
  success: boolean;
  error?: Error;
  classification?: ErrorClassification;
  resolvedStatus?: string;
  retriesUsed: number;
  selectorStrategy?: number;
  resolvedValue?: string;
}

export class RetryEngine {
  static customSettings: {
    waitElementTimeout?: number;
    maxStepRetries?: number;
  } = {};

  /**
   * Orchestrates the execution of a single step with retry logic, backoff, and error classification.
   */
  static async executeStepWithRetry(
    step: Step,
    rowData: Record<string, any>
  ): Promise<StepExecutionResult> {
    
    // 1. Resolve variable
    const resolution = ExecutionEngine.resolveAndValidateValue(step, rowData);
    
    if (resolution.shouldSkipRow) {
      return {
        success: false,
        error: new Error(`Required column/value missing. Scenario resolved as ${resolution.status}.`),
        classification: ErrorClassification.FATAL, // Escalates to skip row in orchestrator
        resolvedStatus: resolution.status,
        retriesUsed: 0
      };
    }
    
    if (resolution.shouldSkipStep) {
      return {
        success: true, // skipped intentionally
        resolvedStatus: resolution.status,
        retriesUsed: 0,
        resolvedValue: resolution.value ?? undefined
      };
    }

    const maxRetries = step.maxRetries ?? RetryEngine.customSettings.maxStepRetries ?? MAX_STEP_RETRIES;
    let attempt = 0;
    let currentBackoff = RETRY_BACKOFF_BASE;

    while (attempt <= maxRetries) {
      const executorStart = (globalThis as any).__FP_EXECUTOR_INSTANCE__;
      if (executorStart && !executorStart.isRunning) {
        return {
          success: false,
          error: new Error("Execution aborted."),
          classification: ErrorClassification.FATAL,
          resolvedStatus: "FAILED",
          retriesUsed: attempt
        };
      }
      try {
        // 2. Find Element using SmartWait (which internally uses SelectorEngine 8-layer fallback)
        const selectorResult = await SmartWaitEngine.waitForElementVisible(
          step.selectorMeta,
          step.selector,
          RetryEngine.customSettings.waitElementTimeout ?? WAIT_ELEMENT_TIMEOUT
        );

        if (!selectorResult) {
          throw new Error("Element not found or not visible after timeout.");
        }

        // 3. Execute Action
        await ExecutionEngine.executeAction(step, selectorResult, resolution.value);

        return {
          success: true,
          resolvedStatus: resolution.status,
          retriesUsed: attempt,
          selectorStrategy: selectorResult.strategy,
          resolvedValue: resolution.value ?? undefined
        };

      } catch (error: any) {
        if (error.message === "Execution aborted.") {
          return {
            success: false,
            error,
            classification: ErrorClassification.FATAL,
            resolvedStatus: "FAILED",
            retriesUsed: attempt
          };
        }
        const classification = this.classifyError(error, step);
        
        if (classification === ErrorClassification.FATAL) {
          return {
            success: false,
            error,
            classification,
            resolvedStatus: "FAILED",
            retriesUsed: attempt
          };
        }

        if (classification === ErrorClassification.SKIPPABLE) {
          return {
            success: true, // Skipping is a successful outcome for an optional step
            resolvedStatus: "STEP_SKIPPED",
            retriesUsed: attempt
          };
        }

        // Increment attempt AFTER classification — only for RETRYABLE errors
        attempt++;

        // If we reached max retries and it's still RETRYABLE, escalate
        if (attempt > maxRetries) {
          return {
            success: false,
            error: new Error(`Max retries (${maxRetries}) exceeded. Last error: ${error.message}`),
            classification: ErrorClassification.RETRYABLE, // Orchestrator handles pageRetryCount
            resolvedStatus: "FAILED",
            retriesUsed: attempt - 1
          };
        }

        // Apply backoff before next attempt
        const executorBefore = (globalThis as any).__FP_EXECUTOR_INSTANCE__;
        if (executorBefore && !executorBefore.isRunning) {
          throw new Error("Execution aborted.");
        }

        // Sleep in chunks of 200ms to remain responsive to pause/abort
        let slept = 0;
        while (slept < currentBackoff) {
          const executor = (globalThis as any).__FP_EXECUTOR_INSTANCE__;
          if (executor && !executor.isRunning) {
            throw new Error("Execution aborted.");
          }
          if (executor && executor.isPaused) {
            // While paused, do not increment slept, just wait
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          await new Promise((r) => setTimeout(r, 200));
          slept += 200;
        }

        const executorAfter = (globalThis as any).__FP_EXECUTOR_INSTANCE__;
        if (executorAfter && !executorAfter.isRunning) {
          throw new Error("Execution aborted.");
        }

        currentBackoff = Math.min(currentBackoff * 2, RETRY_BACKOFF_MAX);
      }
    }

    return {
      success: false,
      error: new Error("Unexpected retry loop exit."),
      classification: ErrorClassification.FATAL,
      retriesUsed: attempt
    };
  }

  private static classifyError(error: Error, step: Step): ErrorClassification {
    const msg = error.message.toLowerCase();
    
    // Page crashed, network disconnected, execution context destroyed
    if (
      msg.includes("context was destroyed") || 
      msg.includes("network error") ||
      msg.includes("fatal")
    ) {
      return ErrorClassification.FATAL;
    }

    // Element not found/visible
    if (msg.includes("element not found") || msg.includes("timeout")) {
      if (step.required === false) {
        return ErrorClassification.SKIPPABLE;
      }
      return ErrorClassification.RETRYABLE;
    }

    // Default to retryable for unknown temporary errors (e.g., node detached from DOM)
    return ErrorClassification.RETRYABLE;
  }
}
