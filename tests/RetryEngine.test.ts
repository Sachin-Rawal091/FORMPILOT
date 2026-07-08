import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryEngine, ErrorClassification } from '../src/content/engines/RetryEngine';
import { SmartWaitEngine } from '../src/content/engines/SmartWaitEngine';
import { ExecutionEngine } from '../src/content/engines/ExecutionEngine';
import { Action, Step, SelectorResult, SelectorStrategy } from '../src/types';

describe('RetryEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should immediately return FATAL when resolveAndValidateValue requires a row skip', async () => {
    const step: Step = {
      id: 's1',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      columnName: 'Email',
      required: true,
      pageId: 'p1',
    };

    const result = await RetryEngine.executeStepWithRetry(step, { Name: 'Sachin' });
    expect(result.success).toBe(false);
    expect(result.classification).toBe(ErrorClassification.FATAL);
    expect(result.resolvedStatus).toBe('ROW_SKIPPED');
  });

  it('should immediately return success when resolveAndValidateValue requires a step skip', async () => {
    const step: Step = {
      id: 's2',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      columnName: 'Email',
      required: false,
      pageId: 'p1',
    };

    const result = await RetryEngine.executeStepWithRetry(step, { Name: 'Sachin' });
    expect(result.success).toBe(true);
    expect(result.resolvedStatus).toBe('STEP_SKIPPED');
  });

  it('should execute successfully on first attempt without retries', async () => {
    const step: Step = {
      id: 's3',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      pageId: 'p1',
    };

    const mockElement = document.createElement('input');
    const mockResult: SelectorResult = { element: mockElement, strategy: SelectorStrategy.ID, confidence: 1.0, shadow: false };

    vi.spyOn(SmartWaitEngine, 'waitForElementVisible').mockResolvedValue(mockResult);
    const executeSpy = vi.spyOn(ExecutionEngine, 'executeAction').mockResolvedValue(undefined);

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(0);
    expect(executeSpy).toHaveBeenCalledWith(step, mockResult, null);
  });

  it('should retry on failure and resolve successfully when element appears', async () => {
    const step: Step = {
      id: 's4',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      pageId: 'p1',
      maxRetries: 2,
    };

    const mockElement = document.createElement('input');
    const mockResult: SelectorResult = { element: mockElement, strategy: SelectorStrategy.ID, confidence: 1.0, shadow: false };

    // Fails on 1st attempt, succeeds on 2nd attempt
    vi.spyOn(SmartWaitEngine, 'waitForElementVisible')
      .mockRejectedValueOnce(new Error('Element not found'))
      .mockResolvedValueOnce(mockResult);

    vi.spyOn(ExecutionEngine, 'executeAction').mockResolvedValue(undefined);

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(1);
  });

  it('should escalate to RETRYABLE when max retries exceeded', async () => {
    const step: Step = {
      id: 's5',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      pageId: 'p1',
      maxRetries: 2,
      required: true,
    };

    vi.spyOn(SmartWaitEngine, 'waitForElementVisible').mockRejectedValue(new Error('Element not found'));

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(false);
    expect(result.classification).toBe(ErrorClassification.RETRYABLE);
    expect(result.retriesUsed).toBe(2); // attempt 0 + 2 retries = 3 attempts total, 2 retries
  });

  it('should return SKIPPABLE when optional step fails to find element', async () => {
    const step: Step = {
      id: 's6',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      pageId: 'p1',
      required: false,
    };

    vi.spyOn(SmartWaitEngine, 'waitForElementVisible').mockRejectedValue(new Error('Element not found'));

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(true);
    expect(result.resolvedStatus).toBe('STEP_SKIPPED');
    expect(result.retriesUsed).toBe(0); // Optional step skipped on first attempt, 0 retries used
  });

  it('should skip optional non-control fields when they are disabled', async () => {
    const step: Step = {
      id: 's6-disabled-field',
      action: Action.FILL,
      selector: '#optional-field',
      selectorMeta: {},
      pageId: 'p1',
      required: false,
    };

    const input = document.createElement('input');
    input.disabled = true;
    const mockResult: SelectorResult = { element: input, strategy: SelectorStrategy.ID, confidence: 1.0, shadow: false };

    vi.spyOn(SmartWaitEngine, 'waitForElementVisible').mockResolvedValue(mockResult);
    const executeSpy = vi.spyOn(ExecutionEngine, 'executeAction').mockResolvedValue(undefined);

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(true);
    expect(result.resolvedStatus).toBe('STEP_SKIPPED');
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('should retry recorded button controls even when marked not required by form metadata', async () => {
    // CLICK actions bypass the isElementInteractable check (only value-filling
    // actions like FILL/SELECT/DATEPICKER check for disabled state). So a
    // disabled button is clicked directly on the first attempt.
    const step: Step = {
      id: 's6-final-button',
      action: Action.CLICK,
      selector: '#final-submit',
      selectorMeta: {},
      pageId: 'p1',
      required: false,
      maxRetries: 1,
    };

    const button = document.createElement('button');
    button.disabled = true;
    const mockResult: SelectorResult = { element: button, strategy: SelectorStrategy.ID, confidence: 1.0, shadow: false };

    vi.spyOn(SmartWaitEngine, 'waitForElementVisible').mockResolvedValue(mockResult);
    const executeSpy = vi.spyOn(ExecutionEngine, 'executeAction').mockResolvedValue(undefined);

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(0);
    expect(executeSpy).toHaveBeenCalledWith(step, mockResult, null);
  });

  it('should return FATAL on fatal network errors or destroyed contexts', async () => {
    const step: Step = {
      id: 's7',
      action: Action.FILL,
      selector: '#inp',
      selectorMeta: {},
      pageId: 'p1',
    };

    vi.spyOn(SmartWaitEngine, 'waitForElementVisible').mockRejectedValue(new Error('Fatal Network Error occurred'));

    const result = await RetryEngine.executeStepWithRetry(step, {});
    expect(result.success).toBe(false);
    expect(result.classification).toBe(ErrorClassification.FATAL);
  });
});
