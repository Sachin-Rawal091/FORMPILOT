import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResponseDetectionEngine } from '../src/content/engines/ResponseDetectionEngine';
import { StateManager } from '../src/content/engines/StateManager';
import { ExecutionStatus, MessageType } from '../src/types';

describe('ResponseDetectionEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    // Mock chrome APIs
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    };
    (globalThis as any).Element.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 25,
      top: 0,
      left: 0,
      bottom: 25,
      right: 100,
    } as any);
  });

  afterEach(() => {
    ResponseDetectionEngine.removeCaptchaOverlay();
  });

  describe('detectCaptcha', () => {
    it('should return false if no CAPTCHA elements exist in DOM', () => {
      expect(ResponseDetectionEngine.detectCaptcha()).toBe(false);
    });

    it('should return true if a standard CAPTCHA element is present', () => {
      const el = document.createElement('div');
      el.id = 'g-recaptcha';
      document.body.appendChild(el);

      expect(ResponseDetectionEngine.detectCaptcha()).toBe(true);
    });

    it('should return true if a CAPTCHA iframe is present', () => {
      const el = document.createElement('iframe');
      el.setAttribute('src', 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/v0/abc123');
      document.body.appendChild(el);

      expect(ResponseDetectionEngine.detectCaptcha()).toBe(true);
    });

    it('should return true if CAPTCHA is nested inside a Shadow DOM', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      
      const captchaEl = document.createElement('div');
      captchaEl.className = 'h-captcha';
      shadow.appendChild(captchaEl);

      expect(ResponseDetectionEngine.detectCaptcha()).toBe(true);
    });
  });

  describe('detectSuccess', () => {
    it('should return true if the URL matches success keywords', () => {
      expect(ResponseDetectionEngine.detectSuccess('https://example.com/checkout/order-confirm')).toBe(true);
    });

    it('should return false if the URL is neutral and no success DOM element exists', () => {
      expect(ResponseDetectionEngine.detectSuccess('https://example.com/form')).toBe(false);
    });

    it('should return true if a success DOM element matches success selectors', () => {
      const el = document.createElement('div');
      el.className = 'thank-you';
      document.body.appendChild(el);

      expect(ResponseDetectionEngine.detectSuccess('https://example.com/form')).toBe(true);
    });

    it('should return true if header tag matches success regex', () => {
      const heading = document.createElement('h2');
      heading.textContent = 'Form Submitted Successfully';
      document.body.appendChild(heading);

      expect(ResponseDetectionEngine.detectSuccess('https://example.com/form')).toBe(true);
    });
  });

  describe('detectFailure', () => {
    it('should return false if no error elements exist', () => {
      expect(ResponseDetectionEngine.detectFailure()).toBe(false);
    });

    it('should return true if an element matching error selectors is present', () => {
      const el = document.createElement('span');
      el.className = 'field-validation-error';
      el.textContent = 'This field is required.';
      // Mock getBoundingClientRect for happy-dom (elements have zero size by default)
      el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 20, top: 0, right: 200, bottom: 20, left: 0, toJSON: () => {} } as DOMRect);
      document.body.appendChild(el);

      expect(ResponseDetectionEngine.detectFailure()).toBe(true);
    });

    it('should return true if element has .invalid-feedback', () => {
      const el = document.createElement('div');
      el.className = 'invalid-feedback';
      el.textContent = 'This field is required';
      document.body.appendChild(el);

      expect(ResponseDetectionEngine.detectFailure()).toBe(true);
    });
  });

  describe('detectInlineError', () => {
    it('should return error string if the element itself has direct error class or attribute', () => {
      const el = document.createElement('input');
      el.className = 'error';
      
      const result = ResponseDetectionEngine.detectInlineError(el);
      expect(result).toBe('Direct field error detected.');
    });

    it('should search parent container or siblings for error details', () => {
      const container = document.createElement('div');
      const input = document.createElement('input');
      const errorMsg = document.createElement('span');
      errorMsg.className = 'error-message';
      errorMsg.textContent = 'This field is required.';

      container.appendChild(input);
      container.appendChild(errorMsg);
      document.body.appendChild(container);

      const result = ResponseDetectionEngine.detectInlineError(input);
      expect(result).toBe('This field is required.');
    });

    it('should return null if no adjacent error is found', () => {
      const container = document.createElement('div');
      const input = document.createElement('input');
      container.appendChild(input);
      document.body.appendChild(container);

      const result = ResponseDetectionEngine.detectInlineError(input);
      expect(result).toBeNull();
    });
  });

  describe('injectCaptchaOverlay', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should inject the floating overlay into the body', () => {
      ResponseDetectionEngine.injectCaptchaOverlay(() => {}, () => {});
      const overlay = document.getElementById('formpilot-captcha-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay?.textContent).toContain('CAPTCHA Paused');
    });

    it('should execute onResume callback when resume button is clicked', () => {
      const resumeSpy = vi.fn();
      ResponseDetectionEngine.injectCaptchaOverlay(resumeSpy, () => {});

      const overlay = document.getElementById('formpilot-captcha-overlay');
      const btn = overlay?.querySelector('button') as HTMLButtonElement;
      btn.click();

      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(document.getElementById('formpilot-captcha-overlay')).toBeNull(); // dismissed
    });

    it('should tick down countdown timer and trigger onTimeout after 180s', () => {
      const timeoutSpy = vi.fn();
      ResponseDetectionEngine.injectCaptchaOverlay(() => {}, timeoutSpy);

      const timerVal = document.getElementById('formpilot-captcha-timer');
      expect(timerVal?.textContent).toBe('03:00');

      // Fast-forward 60s
      vi.advanceTimersByTime(60000);
      expect(timerVal?.textContent).toBe('02:00');

      // Fast-forward remaining 120s
      vi.advanceTimersByTime(120000);
      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(document.getElementById('formpilot-captcha-overlay')).toBeNull(); // dismissed
    });

    it('should not create second overlay if one already exists', () => {
      const resume1 = vi.fn();
      const resume2 = vi.fn();

      ResponseDetectionEngine.injectCaptchaOverlay(resume1, () => {});
      ResponseDetectionEngine.injectCaptchaOverlay(resume2, () => {}); // second call

      expect(document.querySelectorAll('#formpilot-captcha-overlay').length).toBe(1);

      const btn = document.querySelector('#formpilot-captcha-overlay button') as HTMLButtonElement;
      btn.click();

      expect(resume1).toHaveBeenCalledTimes(1);
      expect(resume2).not.toHaveBeenCalled();
    });
  });

  describe('runSubmissionDetection', () => {
    it('should return SUCCESS if detectSuccess is true', async () => {
      const result = await ResponseDetectionEngine.runSubmissionDetection('https://example.com/success', 'session-123');
      expect(result).toBe('SUCCESS');
    });

    it('should return FAILED if detectFailure is true', async () => {
      const errorEl = document.createElement('div');
      errorEl.className = 'alert-danger';
      errorEl.textContent = 'Submission failed. Please try again.';
      errorEl.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 40, top: 0, right: 300, bottom: 40, left: 0, toJSON: () => {} } as DOMRect);
      document.body.appendChild(errorEl);

      const result = await ResponseDetectionEngine.runSubmissionDetection('https://example.com/form', 'session-123');
      expect(result).toBe('FAILED');
    });

    it('should return UNKNOWN if neither success nor failure is detected', async () => {
      const result = await ResponseDetectionEngine.runSubmissionDetection('https://example.com/form', 'session-123');
      expect(result).toBe('UNKNOWN');
    });

    it('should pause execution, trigger runtime message, inject overlay and resume if CAPTCHA is detected', async () => {
      // Setup captcha element
      const captchaEl = document.createElement('div');
      captchaEl.id = 'g-recaptcha';
      document.body.appendChild(captchaEl);

      // Mock StateManager
      vi.spyOn(StateManager, 'getState').mockResolvedValue({
        sessionId: 'session-123',
        currentRowIndex: 0,
        currentStepIndex: 0,
        currentPageId: '',
        status: ExecutionStatus.RUNNING,
        totalRows: 1,
        completedRows: 0,
        failedRows: 0,
        skippedRows: 0,
        pageRetryCount: 0,
        mutexLock: 'session-123',
        captchaPending: false,
        tabContext: 99,
        lastStepResult: ''
      });
      const updateSpy = vi.spyOn(StateManager, 'updateState').mockResolvedValue({} as any);

      // Trigger detection (which returns a promise)
      const detectionPromise = ResponseDetectionEngine.runSubmissionDetection('https://example.com/form', 'session-123');

      // Allow microtasks to execute so StateManager mock runs
      await vi.waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith({
          status: ExecutionStatus.CAPTCHA_PAUSED,
          captchaPending: true
        });
      });

      // Verify extension sendMessage was dispatched
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: MessageType.CAPTCHA_DETECTED,
        sessionId: 'session-123',
        payload: {}
      }));

      // Find resume button and click it to resolve the detection
      const overlay = document.getElementById('formpilot-captcha-overlay');
      const btn = overlay?.querySelector('button') as HTMLButtonElement;
      btn.click();

      const finalStatus = await detectionPromise;
      expect(finalStatus).toBe('UNKNOWN'); // Since page matches neither success nor failure post-resume
      expect(updateSpy).toHaveBeenCalledWith({
        status: ExecutionStatus.RUNNING,
        captchaPending: false
      });
    });
  });
});
