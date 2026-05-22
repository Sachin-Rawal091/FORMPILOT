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
}

export class RetryEngine {
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
        retriesUsed: 0
      };
    }

    const maxRetries = step.maxRetries ?? MAX_STEP_RETRIES;
    let attempt = 0;
    let currentBackoff = RETRY_BACKOFF_BASE;

    while (attempt <= maxRetries) {
      try {
        // 2. Find Element using SmartWait (which internally uses SelectorEngine 8-layer fallback)
        const selectorResult = await SmartWaitEngine.waitForElementVisible(
          step.selectorMeta,
          step.selector,
          WAIT_ELEMENT_TIMEOUT
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
          selectorStrategy: selectorResult.strategy
        };

      } catch (error: any) {
        attempt++;
        
        const classification = this.classifyError(error, step);
        
        if (classification === ErrorClassification.FATAL) {
          return {
            success: false,
            error,
            classification,
            resolvedStatus: "FAILED",
            retriesUsed: attempt - 1
          };
        }

        if (classification === ErrorClassification.SKIPPABLE) {
          return {
            success: true, // Skipping is a successful outcome for an optional step
            resolvedStatus: "STEP_SKIPPED",
            retriesUsed: attempt - 1
          };
        }

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
        await new Promise((resolve) => setTimeout(resolve, currentBackoff));
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
