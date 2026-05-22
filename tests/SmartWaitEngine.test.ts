import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmartWaitEngine } from '../src/content/engines/SmartWaitEngine';

describe('SmartWaitEngine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should wait for element to be present in the DOM', async () => {
    const input = document.createElement('input');
    input.id = 'target-input';

    // Append after 100ms
    setTimeout(() => {
      document.body.appendChild(input);
    }, 50);

    const result = await SmartWaitEngine.waitForElement({ id: 'target-input' }, '', 500);
    expect(result).not.toBeNull();
    expect(result.element).toBe(input);
  });

  it('should throw an error on waitForElement timeout', async () => {
    await expect(
      SmartWaitEngine.waitForElement({ id: 'non-existent' }, '', 100)
    ).rejects.toThrow('Timeout of 100ms exceeded');
  });

  it('should wait for element to be visible', async () => {
    const input = document.createElement('input');
    input.id = 'visible-input';
    document.body.appendChild(input);

    // Mock layout since Happy DOM doesn't compute actual layouts
    input.getBoundingClientRect = () => ({ width: 100, height: 25 } as any);
    
    // Explicit style mock
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    } as any);

    const result = await SmartWaitEngine.waitForElementVisible({ id: 'visible-input' }, '', 500);
    expect(result).not.toBeNull();
    expect(result.element).toBe(input);
  });

  it('should wait for element to be clickable', async () => {
    const button = document.createElement('button');
    button.id = 'clickable-btn';
    document.body.appendChild(button);

    button.getBoundingClientRect = () => ({ width: 80, height: 30 } as any);
    
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      pointerEvents: 'auto',
    } as any);

    const result = await SmartWaitEngine.waitForElementClickable({ id: 'clickable-btn' }, '', 500);
    expect(result).not.toBeNull();
    expect(result.element).toBe(button);
  });

  it('should resolve waitForDOMStability after silence delay', async () => {
    const promise = SmartWaitEngine.waitForDOMStability(500);
    
    // Add mutations to trigger observer
    setTimeout(() => {
      const el = document.createElement('div');
      document.body.appendChild(el);
    }, 50);

    await expect(promise).resolves.toBeUndefined();
  });

  it('should resolve waitForURLChange when URL changes and direct children change met', async () => {
    const currentURL = window.location.href;
    const promise = SmartWaitEngine.waitForURLChange(currentURL, 1000);

    // Simulate URL change and children change
    setTimeout(() => {
      // Mock window location
      Object.defineProperty(window, 'location', {
        value: { href: currentURL + '#navigated' },
        writable: true,
      });

      // Add direct children to exceed navigation threshold (40%)
      const child1 = document.createElement('div');
      const child2 = document.createElement('div');
      document.body.appendChild(child1);
      document.body.appendChild(child2);

      // Dispatch popstate event to trigger check
      window.dispatchEvent(new Event('popstate'));
    }, 100);

    const navigated = await promise;
    expect(navigated).toBe(true);
  });

  it('should wait for options in dependent select fields', async () => {
    const select = document.createElement('select');
    select.id = 'dependent-select';
    document.body.appendChild(select);

    const promise = SmartWaitEngine.waitForSelectOptions({ id: 'dependent-select' }, '', 1000);

    setTimeout(() => {
      const option1 = document.createElement('option');
      option1.value = 'val1';
      option1.textContent = 'Val 1';
      const option2 = document.createElement('option');
      option2.value = 'val2';
      option2.textContent = 'Val 2';

      select.appendChild(option1);
      select.appendChild(option2);
    }, 100);

    const hasOptions = await promise;
    expect(hasOptions).toBe(true);
  });

  it('should resolve waitForNetworkIdle using ceiling fallback or window postMessage', async () => {
    const promise = SmartWaitEngine.waitForNetworkIdle(500);

    // Simulate message event from network proxy script
    setTimeout(() => {
      window.postMessage({ type: 'FORMPILOT_NETWORK_IDLE' }, '*');
    }, 50);

    await expect(promise).resolves.toBeUndefined();
  });
});
