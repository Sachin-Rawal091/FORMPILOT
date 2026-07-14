import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Chrome API Mocks ───
// vi.hoisted() runs BEFORE ES module imports are evaluated.
// This is critical because recorder.ts instantiates a singleton on import,
// which calls chrome.runtime.onMessage.addListener in the constructor.
const mocks = vi.hoisted(() => {
  const mockSendMessage = vi.fn().mockResolvedValue({});
  const mockStorageLocalGet = vi.fn().mockImplementation(
    (_key: string, cb: (result: Record<string, unknown>) => void) => cb({})
  );
  const mockStorageSessionGet = vi.fn().mockImplementation(
    (_key: string, cb: (result: Record<string, unknown>) => void) => cb({})
  );

  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: mockSendMessage,
      lastError: null,
    },
    storage: {
      local: { get: mockStorageLocalGet },
      session: { get: mockStorageSessionGet },
    },
  };

  // Prevent singleton instantiation during module load
  (globalThis as any).__FP_RECORDER_INIT__ = true;

  // Mock CSS.escape for happy-dom
  if (typeof CSS === 'undefined') {
    (globalThis as any).CSS = {
      escape: (s: string) => s.replace(/([#.,:*+?~|[\](){}^$=!>])/g, '\\$1'),
    };
  }

  return { mockSendMessage, mockStorageLocalGet, mockStorageSessionGet };
});

const nativePushState = history.pushState;
const nativeReplaceState = history.replaceState;

import { RecordingEngine } from '../src/content/recorder';
import { Action } from '../src/types';

// ─── Test Suite ───

describe('RecordingEngine', () => {
  let recorder: any; // 'any' to access private methods for unit testing

  beforeEach(() => {
    // Reset history wrapping so each test starts clean
    history.pushState = nativePushState;
    history.replaceState = nativeReplaceState;
    delete (history.pushState as any).__fpWrapped;
    delete (history.replaceState as any).__fpWrapped;

    // Reset singleton guard
    (globalThis as any).__FP_RECORDER_INIT__ = false;
    (globalThis as any).__FP_RECORDER_INSTANCE__ = undefined;

    recorder = new RecordingEngine();
    recorder.isRecording = true;
    recorder.recordingId = 'test-recording';

    mocks.mockSendMessage.mockClear();
    mocks.mockStorageSessionGet.mockClear();
  });

  afterEach(() => {
    // Clean up any active timers
    if (recorder.activeTimers) {
      recorder.activeTimers.forEach((t: ReturnType<typeof setTimeout>) => clearTimeout(t));
      recorder.activeTimers.clear();
    }
    if (recorder.submitLatchSafetyTimer) {
      clearTimeout(recorder.submitLatchSafetyTimer);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 1: BUG-NEW-1 — Submit click latch
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-1: Submit click synchronous recording', () => {
    it('sets recentClickWasSubmit latch when a submit button is clicked', () => {
      const form = document.createElement('form');
      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      submitBtn.textContent = 'Submit';
      form.appendChild(submitBtn);
      document.body.appendChild(form);

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: submitBtn, writable: false });
      recorder.handleClickEvent(clickEvent);

      expect(recorder.recentClickWasSubmit).toBe(true);

      document.body.removeChild(form);
    });

    it('does not double-record when native submit follows a recorded submit-click', () => {
      const form = document.createElement('form');
      document.body.appendChild(form);

      // Simulate the state after a submit-click was recorded
      recorder.recentClickWasSubmit = true;

      const addStepSpy = vi.spyOn(recorder, 'addRecordedStep');
      const submitEvent = new Event('submit', { bubbles: true });
      Object.defineProperty(submitEvent, 'target', { value: form, writable: false });
      recorder.handleSubmitEvent(submitEvent);

      // Should NOT record again
      expect(addStepSpy).not.toHaveBeenCalled();
      // Latch should be cleared
      expect(recorder.recentClickWasSubmit).toBe(false);

      document.body.removeChild(form);
      addStepSpy.mockRestore();
    });

    it('records Enter-key SUBMIT independently when no click preceded it', () => {
      const form = document.createElement('form');
      document.body.appendChild(form);

      recorder.recentClickWasSubmit = false;

      const addStepSpy = vi.spyOn(recorder, 'addRecordedStep');
      const submitEvent = new Event('submit', { bubbles: true });
      Object.defineProperty(submitEvent, 'target', { value: form, writable: false });
      recorder.handleSubmitEvent(submitEvent);

      expect(addStepSpy).toHaveBeenCalledWith(Action.SUBMIT, form);

      document.body.removeChild(form);
      addStepSpy.mockRestore();
    });

    it('clears latch via safety-timeout if no submit event follows', async () => {
      recorder.recentClickWasSubmit = true;
      recorder.submitLatchSafetyTimer = setTimeout(() => {
        recorder.recentClickWasSubmit = false;
        recorder.submitLatchSafetyTimer = null;
      }, 800);

      await new Promise(r => setTimeout(r, 900));
      expect(recorder.recentClickWasSubmit).toBe(false);
      expect(recorder.submitLatchSafetyTimer).toBeNull();
    });

    it('records the enclosing form element for submit-clicks inside a <form>', () => {
      const form = document.createElement('form');
      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      form.appendChild(submitBtn);
      document.body.appendChild(form);

      const addStepSpy = vi.spyOn(recorder, 'addRecordedStep');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: submitBtn, writable: false });
      recorder.handleClickEvent(clickEvent);

      // Should record with the form element, not the button
      expect(addStepSpy).toHaveBeenCalledWith(Action.SUBMIT, form);

      document.body.removeChild(form);
      addStepSpy.mockRestore();
    });

    it('falls back to button element when no enclosing <form> exists', () => {
      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      document.body.appendChild(submitBtn);

      const addStepSpy = vi.spyOn(recorder, 'addRecordedStep');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: submitBtn, writable: false });
      recorder.handleClickEvent(clickEvent);

      // Should fall back to the button itself
      expect(addStepSpy).toHaveBeenCalledWith(Action.SUBMIT, submitBtn);

      document.body.removeChild(submitBtn);
      addStepSpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 1: BUG-NEW-9 — isButtonOrLink regex precision
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-9: isButtonOrLink precision', () => {
    it('does not false-positive on classes containing "button" as substring', () => {
      const div = document.createElement('div');
      div.className = 'disabled-button-label';
      document.body.appendChild(div);
      expect(recorder.isButtonOrLink(div)).toBe(false);
      document.body.removeChild(div);
    });

    it('does not false-positive on classes containing "btn" as substring', () => {
      const div = document.createElement('div');
      div.className = 'nobtn-wrapper';
      document.body.appendChild(div);
      expect(recorder.isButtonOrLink(div)).toBe(false);
      document.body.removeChild(div);
    });

    it('correctly identifies element with exact "btn" class', () => {
      const div = document.createElement('div');
      div.className = 'btn';
      document.body.appendChild(div);
      expect(recorder.isButtonOrLink(div)).toBe(true);
      document.body.removeChild(div);
    });

    it('correctly identifies element with exact "button" class', () => {
      const div = document.createElement('div');
      div.className = 'button';
      document.body.appendChild(div);
      expect(recorder.isButtonOrLink(div)).toBe(true);
      document.body.removeChild(div);
    });

    it('correctly identifies element with "btn" in multi-class list', () => {
      const div = document.createElement('div');
      div.className = 'primary btn large';
      document.body.appendChild(div);
      expect(recorder.isButtonOrLink(div)).toBe(true);
      document.body.removeChild(div);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 2: BUG-NEW-2 — Select click exclusion
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-2: Select deduplication', () => {
    it('does not record a step when a <select> element is clicked', () => {
      const select = document.createElement('select');
      const option = document.createElement('option');
      option.value = 'test';
      select.appendChild(option);
      document.body.appendChild(select);

      const addStepSpy = vi.spyOn(recorder, 'addRecordedStep');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: select, writable: false });
      recorder.handleClickEvent(clickEvent);

      expect(addStepSpy).not.toHaveBeenCalled();

      document.body.removeChild(select);
      addStepSpy.mockRestore();
    });

    it('records exactly one SELECT step via change event', () => {
      const select = document.createElement('select');
      const option1 = document.createElement('option');
      option1.value = 'a';
      option1.textContent = 'Option A';
      const option2 = document.createElement('option');
      option2.value = 'b';
      option2.textContent = 'Option B';
      select.appendChild(option1);
      select.appendChild(option2);
      document.body.appendChild(select);

      select.value = 'b';
      const addStepSpy = vi.spyOn(recorder, 'addRecordedStep');
      const changeEvent = new Event('change', { bubbles: true });
      Object.defineProperty(changeEvent, 'target', { value: select, writable: false });
      recorder.handleChangeEvent(changeEvent);

      expect(addStepSpy).toHaveBeenCalledTimes(1);
      expect(addStepSpy).toHaveBeenCalledWith(Action.SELECT, select, 'b');

      document.body.removeChild(select);
      addStepSpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 3: BUG-NEW-3 — pushState/replaceState tracking
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-3: SPA navigation tracking', () => {
    it('marks history.pushState as wrapped', () => {
      expect((history.pushState as any).__fpWrapped).toBe(true);
    });

    it('marks history.replaceState as wrapped', () => {
      expect((history.replaceState as any).__fpWrapped).toBe(true);
    });

    it('dispatches fp:locationchange on pushState call', () => {
      const listener = vi.fn();
      window.addEventListener('fp:locationchange', listener);
      history.pushState({}, '', '/test-push');
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener('fp:locationchange', listener);
    });

    it('dispatches fp:locationchange on replaceState call', () => {
      const listener = vi.fn();
      window.addEventListener('fp:locationchange', listener);
      history.replaceState({}, '', '/test-replace');
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener('fp:locationchange', listener);
    });

    it('wrapping is idempotent across multiple Recorder initializations', () => {
      const listener = vi.fn();
      window.addEventListener('fp:locationchange', listener);

      // Create a second recorder (simulates re-injection)
      (globalThis as any).__FP_RECORDER_INIT__ = false;
      new RecordingEngine();

      history.pushState({}, '', '/test-idempotent');
      // Should fire only once, not twice
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener('fp:locationchange', listener);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 4: BUG-NEW-4 — Radio selector disambiguation
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-4: Selector disambiguation', () => {
    it('generates distinct CSS selectors for radio inputs sharing a name', () => {
      const form = document.createElement('form');
      const radio1 = document.createElement('input');
      radio1.type = 'radio';
      radio1.name = 'gender';
      radio1.value = 'male';
      const radio2 = document.createElement('input');
      radio2.type = 'radio';
      radio2.name = 'gender';
      radio2.value = 'female';
      const radio3 = document.createElement('input');
      radio3.type = 'radio';
      radio3.name = 'gender';
      radio3.value = 'other';
      form.appendChild(radio1);
      form.appendChild(radio2);
      form.appendChild(radio3);
      document.body.appendChild(form);

      const css1 = recorder.generateCssPath(radio1);
      const css2 = recorder.generateCssPath(radio2);
      const css3 = recorder.generateCssPath(radio3);

      // All three should produce different selectors
      expect(css1).not.toBe(css2);
      expect(css2).not.toBe(css3);
      expect(css1).not.toBe(css3);

      document.body.removeChild(form);
    });

    it('still uses short-path for elements with a globally unique name', () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'unique_email_field';
      form.appendChild(input);
      document.body.appendChild(form);

      const css = recorder.generateCssPath(input);
      expect(css).toContain('[name="unique_email_field"]');
      // Should NOT contain nth-of-type since name is unique
      expect(css).not.toContain('nth-of-type');

      document.body.removeChild(form);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 4: BUG-NEW-6 — Metadata completeness
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-6: Selector metadata completeness', () => {
    it('captures data-testid when present', () => {
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'email-input');
      document.body.appendChild(input);
      const meta = recorder.generateSelectorMeta(input);
      expect(meta.testId).toBe('email-input');
      document.body.removeChild(input);
    });

    it('captures data-test-id (hyphenated variant) when present', () => {
      const input = document.createElement('input');
      input.setAttribute('data-test-id', 'phone-input');
      document.body.appendChild(input);
      const meta = recorder.generateSelectorMeta(input);
      expect(meta.testId).toBe('phone-input');
      document.body.removeChild(input);
    });

    it('prefers data-testid over data-test-id when both present', () => {
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'primary');
      input.setAttribute('data-test-id', 'secondary');
      document.body.appendChild(input);
      const meta = recorder.generateSelectorMeta(input);
      expect(meta.testId).toBe('primary');
      document.body.removeChild(input);
    });

    it('captures role when present', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'textbox');
      document.body.appendChild(div);
      const meta = recorder.generateSelectorMeta(div);
      expect(meta.role).toBe('textbox');
      document.body.removeChild(div);
    });

    it('omits testId and role when attributes are absent (no empty-string pollution)', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const meta = recorder.generateSelectorMeta(input);
      expect(meta.testId).toBeUndefined();
      expect(meta.role).toBeUndefined();
      document.body.removeChild(input);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 5: BUG-NEW-7 — DatePicker boundary precision
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-7: isInsideDatePicker specificity', () => {
    it('does NOT classify a MUI modal backdrop as inside a date picker', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'MuiBackdrop-root';
      const inner = document.createElement('div');
      backdrop.appendChild(inner);
      document.body.appendChild(backdrop);
      expect(recorder.isInsideDatePicker(inner)).toBe(false);
      document.body.removeChild(backdrop);
    });

    it('does NOT classify a Bootstrap modal overlay as inside a date picker', () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const inner = document.createElement('div');
      overlay.appendChild(inner);
      document.body.appendChild(overlay);
      expect(recorder.isInsideDatePicker(inner)).toBe(false);
      document.body.removeChild(overlay);
    });

    it('does NOT classify an AntD dropdown overlay as inside a date picker', () => {
      const overlay = document.createElement('div');
      overlay.className = 'ant-dropdown-overlay';
      const inner = document.createElement('div');
      overlay.appendChild(inner);
      document.body.appendChild(overlay);
      expect(recorder.isInsideDatePicker(inner)).toBe(false);
      document.body.removeChild(overlay);
    });

    it('still classifies RMDP calendar popup as inside a date picker', () => {
      const rmdpContainer = document.createElement('div');
      rmdpContainer.className = 'rmdp-wrapper';
      const dayCell = document.createElement('div');
      dayCell.className = 'rmdp-day';
      rmdpContainer.appendChild(dayCell);
      document.body.appendChild(rmdpContainer);
      expect(recorder.isInsideDatePicker(dayCell)).toBe(true);
      document.body.removeChild(rmdpContainer);
    });

    it('still classifies flatpickr popup as inside a date picker', () => {
      const flatpickr = document.createElement('div');
      flatpickr.className = 'flatpickr-calendar';
      const inner = document.createElement('span');
      flatpickr.appendChild(inner);
      document.body.appendChild(flatpickr);
      expect(recorder.isInsideDatePicker(inner)).toBe(true);
      document.body.removeChild(flatpickr);
    });

    it('still classifies generic datepicker class as inside a date picker', () => {
      const dp = document.createElement('div');
      dp.className = 'datepicker-container';
      const inner = document.createElement('div');
      dp.appendChild(inner);
      document.body.appendChild(dp);
      expect(recorder.isInsideDatePicker(inner)).toBe(true);
      document.body.removeChild(dp);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Loop 6: BUG-NEW-8 — Dynamic ID pattern coverage
  // ═══════════════════════════════════════════════════════════════════

  describe('BUG-NEW-8: isDynamicId Chakra/Mantine coverage', () => {
    it('classifies Mantine-style hash ID as dynamic', () => {
      expect(recorder.isDynamicId('mantine-4c98f80e')).toBe(true);
    });

    it('classifies Chakra-style ID as dynamic', () => {
      expect(recorder.isDynamicId('chakra-modal-body')).toBe(true);
    });

    it('does not classify a stable human-authored ID as dynamic', () => {
      expect(recorder.isDynamicId('email-input')).toBe(false);
      expect(recorder.isDynamicId('firstName')).toBe(false);
      expect(recorder.isDynamicId('submit-btn')).toBe(false);
      expect(recorder.isDynamicId('main-form')).toBe(false);
    });

    it('still classifies existing Radix dynamic IDs correctly', () => {
      expect(recorder.isDynamicId('radix-12345')).toBe(true);
    });

    it('still classifies existing MUI dynamic IDs correctly', () => {
      expect(recorder.isDynamicId('mui-abcdef')).toBe(true);
    });

    it('still classifies react-select dynamic IDs correctly', () => {
      expect(recorder.isDynamicId('react-select-instance-1')).toBe(true);
    });

    it('still classifies headlessui dynamic IDs correctly', () => {
      expect(recorder.isDynamicId('headlessui-menu-button-1')).toBe(true);
    });
  });
});
