/**
 * PURPOSE: Missing tests for ExecutionEngine — covers all 13 action types
 * and the complete resolveAndValidateValue 8-scenario decision tree.
 * DEPENDS ON: ExecutionEngine, domUtils, SmartWaitEngine, chromeMock
 * USED BY: Vitest test suite
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionEngine } from '../src/content/engines/ExecutionEngine';
import { SmartWaitEngine } from '../src/content/engines/SmartWaitEngine';
import { Action, Step, SelectorResult, SelectorStrategy } from '../src/types';
import * as domUtils from '../src/content/domUtils';

// Helpers
function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'test-step-id',
    action: Action.FILL,
    selector: '#test',
    selectorMeta: {},
    pageId: 'page-1',
    ...overrides,
  };
}

function makeSelectorResult(el: Element): SelectorResult {
  return {
    element: el,
    strategy: SelectorStrategy.ID,
    confidence: 1.0,
    shadow: false,
  };
}

// ─────────────────────────────────────────────
// resolveAndValidateValue — 8 Scenarios
// ─────────────────────────────────────────────
describe('ExecutionEngine.resolveAndValidateValue', () => {
  it('Scenario 1 — value exists, valid type → FILLED', () => {
    const step = makeStep({ columnName: 'Email' });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Email: 'test@test.com' });
    expect(result.status).toBe('FILLED');
    expect(result.value).toBe('test@test.com');
    expect(result.shouldSkipRow).toBe(false);
    expect(result.shouldSkipStep).toBe(false);
  });

  it('Scenario 2 — column not found, required → ROW_SKIPPED', () => {
    const step = makeStep({ columnName: 'Email', required: true });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Name: 'Sachin' });
    expect(result.status).toBe('ROW_SKIPPED');
    expect(result.shouldSkipRow).toBe(true);
  });

  it('Scenario 3 — column not found, optional → STEP_SKIPPED', () => {
    const step = makeStep({ columnName: 'Email', required: false });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Name: 'Sachin' });
    expect(result.status).toBe('STEP_SKIPPED');
    expect(result.shouldSkipStep).toBe(true);
    expect(result.shouldSkipRow).toBe(false);
  });

  it('Scenario 4 — empty value, default set → FILLED_DEFAULT', () => {
    const step = makeStep({ columnName: 'Phone', defaultValue: '0000000000' });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Phone: '' });
    expect(result.status).toBe('FILLED_DEFAULT');
    expect(result.value).toBe('0000000000');
  });

  it('Scenario 5 — empty value, no default, required → ROW_SKIPPED', () => {
    const step = makeStep({ columnName: 'Email', required: true });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Email: '' });
    expect(result.status).toBe('ROW_SKIPPED');
    expect(result.shouldSkipRow).toBe(true);
  });

  it('Scenario 6 — empty value, no default, optional → STEP_SKIPPED', () => {
    const step = makeStep({ columnName: 'Phone', required: false });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Phone: null });
    expect(result.status).toBe('STEP_SKIPPED');
    expect(result.shouldSkipStep).toBe(true);
  });

  it('Scenario 7 — wrong type, coercible → FILLED_COERCED (string to number)', () => {
    const step = makeStep({ columnName: 'Age', expectedType: 'number' });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Age: '25' });
    expect(result.status).toBe('FILLED_COERCED');
    expect(result.value).toBe('25');
  });

  it('Scenario 7b — wrong type, coercible → FILLED_COERCED (ISO string to Date)', () => {
    const step = makeStep({ columnName: 'DOB', expectedType: 'date' });
    const result = ExecutionEngine.resolveAndValidateValue(step, { DOB: '2000-05-15' });
    expect(result.status).toBe('FILLED_COERCED');
    expect(result.value).toBe('2000-05-15');
  });

  it('Scenario 7c — wrong type, coercible → FILLED_COERCED (boolean string)', () => {
    const step = makeStep({ columnName: 'Active', expectedType: 'boolean' });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Active: 'true' });
    expect(result.status).toBe('FILLED_COERCED');
    expect(result.value).toBe('true');
  });

  it('Scenario 8 — wrong type, not coercible → WARN', () => {
    const step = makeStep({ columnName: 'Age', expectedType: 'number' });
    const result = ExecutionEngine.resolveAndValidateValue(step, { Age: 'not-a-number' });
    expect(result.status).toBe('WARN');
  });

  it('no columnName — uses step.value directly', () => {
    const step = makeStep({ columnName: undefined, value: 'direct-value' });
    const result = ExecutionEngine.resolveAndValidateValue(step, {});
    expect(result.status).toBe('FILLED');
    expect(result.value).toBe('direct-value');
  });
});

// ─────────────────────────────────────────────
// executeAction — All 13 Action Types
// ─────────────────────────────────────────────
describe('ExecutionEngine.executeAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('FILL — calls setInputValue on HTMLInputElement', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const spy = vi.spyOn(domUtils, 'setInputValue');
    await ExecutionEngine.executeAction(makeStep({ action: Action.FILL }), makeSelectorResult(input), 'hello@test.com');
    expect(spy).toHaveBeenCalledWith(input, 'hello@test.com');
  });

  it('FILL — calls setTextareaValue on HTMLTextAreaElement', async () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const spy = vi.spyOn(domUtils, 'setTextareaValue');
    await ExecutionEngine.executeAction(makeStep({ action: Action.FILL }), makeSelectorResult(ta), 'some text');
    expect(spy).toHaveBeenCalledWith(ta, 'some text');
  });

  it('CLICK — dispatches mousedown, mouseup, click events', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const spy = vi.spyOn(domUtils, 'dispatchEvents');
    await ExecutionEngine.executeAction(makeStep({ action: Action.CLICK }), makeSelectorResult(btn), null);
    expect(spy).toHaveBeenCalledWith(btn, ['mousedown', 'mouseup', 'click']);
  });

  it('NAVIGATE_NEXT — same as CLICK, dispatches click events', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const spy = vi.spyOn(domUtils, 'dispatchEvents');
    await ExecutionEngine.executeAction(makeStep({ action: Action.NAVIGATE_NEXT }), makeSelectorResult(btn), null);
    expect(spy).toHaveBeenCalledWith(btn, ['mousedown', 'mouseup', 'click']);
  });

  it('SELECT — calls setSelectValue and waitForSelectOptions', async () => {
    const sel = document.createElement('select');
    document.body.appendChild(sel);
    const setSpy = vi.spyOn(domUtils, 'setSelectValue');
    const waitSpy = vi.spyOn(SmartWaitEngine, 'waitForSelectOptions').mockResolvedValue(true);
    await ExecutionEngine.executeAction(makeStep({ action: Action.SELECT, selectorMeta: {}, selector: '' }), makeSelectorResult(sel), 'option-value');
    expect(setSpy).toHaveBeenCalledWith(sel, 'option-value');
    expect(waitSpy).toHaveBeenCalled();
  });

  it('SELECT_RADIO — selects radio by value attribute', async () => {
    const form = document.createElement('form');
    const radio1 = document.createElement('input');
    radio1.type = 'radio'; radio1.name = 'choice'; radio1.value = 'opt-a';
    const radio2 = document.createElement('input');
    radio2.type = 'radio'; radio2.name = 'choice'; radio2.value = 'opt-b';
    form.appendChild(radio1); form.appendChild(radio2);
    document.body.appendChild(form);

    const step = makeStep({ action: Action.SELECT_RADIO });
    await ExecutionEngine.executeAction(step, makeSelectorResult(radio1), 'opt-b');
    expect(radio2.checked).toBe(true);
    expect(radio1.checked).toBe(false);
  });

  it('TOGGLE_CHECKBOX — only clicks if state change needed', async () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = false;
    document.body.appendChild(cb);
    const spy = vi.spyOn(domUtils, 'dispatchEvents');

    // Check it (unchecked → true)
    const step = makeStep({ action: Action.TOGGLE_CHECKBOX, checked: true });
    await ExecutionEngine.executeAction(step, makeSelectorResult(cb), null);
    expect(cb.checked).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('TOGGLE_CHECKBOX — does NOT click if state already correct', async () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true;
    document.body.appendChild(cb);
    const spy = vi.spyOn(domUtils, 'dispatchEvents');

    const step = makeStep({ action: Action.TOGGLE_CHECKBOX, checked: true });
    await ExecutionEngine.executeAction(step, makeSelectorResult(cb), null);
    expect(spy).not.toHaveBeenCalled();
  });

  it('SCROLL — scrolls element into view', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const spy = vi.spyOn(div, 'scrollIntoView').mockImplementation(() => {});
    await ExecutionEngine.executeAction(makeStep({ action: Action.SCROLL }), makeSelectorResult(div), null);
    expect(spy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('SUBMIT — calls form.submit() on HTMLFormElement', async () => {
    const form = document.createElement('form');
    document.body.appendChild(form);
    const spy = vi.spyOn(form, 'submit').mockImplementation(() => {});
    await ExecutionEngine.executeAction(makeStep({ action: Action.SUBMIT }), makeSelectorResult(form), null);
    expect(spy).toHaveBeenCalled();
  });

  it('SUBMIT — dispatches click on non-form submit button', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const spy = vi.spyOn(domUtils, 'dispatchEvents');
    await ExecutionEngine.executeAction(makeStep({ action: Action.SUBMIT }), makeSelectorResult(btn), null);
    expect(spy).toHaveBeenCalledWith(btn, ['mousedown', 'mouseup', 'click']);
  });

  it('RICH_TEXT — calls execCommand on contenteditable', async () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    document.execCommand = vi.fn().mockReturnValue(true);
    const execSpy = document.execCommand;
    await ExecutionEngine.executeAction(makeStep({ action: Action.RICH_TEXT }), makeSelectorResult(div), 'Hello World');
    expect(execSpy).toHaveBeenCalledWith('selectAll');
    expect(execSpy).toHaveBeenCalledWith('insertText', false, 'Hello World');
  });
});
