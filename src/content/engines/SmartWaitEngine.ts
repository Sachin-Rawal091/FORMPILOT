import { SelectorMeta, SelectorResult } from "../../types";
import { SelectorEngine } from "./SelectorEngine";
import {
  POLL_INTERVAL_BASE,
  WAIT_DOM_STABILITY_SILENCE,
  WAIT_NETWORK_IDLE_TIMEOUT,
  NETWORK_IDLE_CEILING,
  NAVIGATION_DOM_THRESHOLD,
} from "../../shared/constants";

export class SmartWaitEngine {
  /**
   * Polls until the element is present in the DOM.
   * Uses exponential backoff for the polling interval.
   */
  static async waitForElement(
    meta: SelectorMeta,
    selector: string,
    timeout: number
  ): Promise<SelectorResult> {
    return this.pollForCondition(
      () => SelectorEngine.findElement(meta, selector),
      timeout
    );
  }

  /**
   * Checks if an element is visible (not display: none, width/height > 0).
   */
  static async waitForElementVisible(
    meta: SelectorMeta,
    selector: string,
    timeout: number
  ): Promise<SelectorResult> {
    return this.pollForCondition(() => {
      const result = SelectorEngine.findElement(meta, selector);
      if (result) {
        const el = result.element as HTMLElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isBypass = el.tagName === "INPUT" && 
          ["checkbox", "radio", "file"].includes((el as HTMLInputElement).type?.toLowerCase());

        if (style.display !== "none" && style.visibility !== "hidden") {
          if (isBypass) {
            return result;
          }
          if (rect.width > 0 && rect.height > 0 && style.opacity !== "0") {
            return result;
          }
        }
      }
      return null;
    }, timeout);
  }

  /**
   * Checks if an element is interactable (not disabled).
   */
  static async waitForElementClickable(
    meta: SelectorMeta,
    selector: string,
    timeout: number
  ): Promise<SelectorResult> {
    return this.pollForCondition(() => {
      const result = SelectorEngine.findElement(meta, selector);
      if (result) {
        const el = result.element as HTMLElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isDisabled = (el as HTMLButtonElement | HTMLInputElement).disabled;
        const isBypass = el.tagName === "INPUT" && 
          ["checkbox", "radio", "file"].includes((el as HTMLInputElement).type?.toLowerCase());

        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.pointerEvents !== "none" &&
          !isDisabled
        ) {
          if (isBypass) {
            return result;
          }
          if (rect.width > 0 && rect.height > 0) {
            return result;
          }
        }
      }
      return null;
    }, timeout);
  }

  /**
   * Resolves when there have been no DOM mutations for WAIT_DOM_STABILITY_SILENCE ms.
   * If timeout is reached, it resolves anyway to prevent hanging.
   */
  static async waitForDOMStability(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let timeoutTimer: ReturnType<typeof setTimeout>;

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, WAIT_DOM_STABILITY_SILENCE);
      });

      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(timeoutTimer);
      };

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      // Initial timer if no mutations happen at all
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, WAIT_DOM_STABILITY_SILENCE);

      // Hard timeout
      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeout);
    });
  }

  /**
   * Detects navigation by monitoring for URL change OR significant DOM mutations.
   * Resolves on EITHER condition to handle:
   * - Full page navigations (URL changes)
   * - SPA router transitions (URL + minor DOM changes)
   * - In-page wizard transitions (DOM-only, no URL change)
   */
  static async waitForURLChange(currentURL: string, timeout: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let timeoutTimer: ReturnType<typeof setTimeout>;
      let observer: MutationObserver;
      let resolved = false;
      const initialChildrenCount = document.body.children.length;
      let mutationCount = 0;

      const done = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        if (result) {
          resolve(true);
        } else {
          reject(new Error(`URL change timeout after ${timeout}ms`));
        }
      };

      // Fallback polling for pushState/replaceState which don't fire events natively
      const pollInterval = setInterval(() => {
        if (window.location.href !== currentURL) {
          done(true);
        }
      }, 300);

      const checkURLChange = () => {
        if (window.location.href !== currentURL) {
          done(true);
        }
      };

      const checkDOMMutation = () => {
        mutationCount++;
        
        // If URL changed, resolve immediately
        if (window.location.href !== currentURL) {
          done(true);
          return;
        }

        // Check for significant DOM body changes (section toggling, content replacement)
        const currentChildrenCount = document.body.children.length;
        const diff = Math.abs(currentChildrenCount - initialChildrenCount);
        const thresholdMet = initialChildrenCount === 0 || (diff / initialChildrenCount) > NAVIGATION_DOM_THRESHOLD;

        if (thresholdMet) {
          done(true);
          return;
        }

        // For SPA wizard-style transitions with many subtree mutations but same body children count
        // (e.g., display:none toggling of sections), resolve after significant mutation activity
        if (mutationCount >= 5) {
          done(true);
        }
      };

      const cleanup = () => {
        if (observer) observer.disconnect();
        clearTimeout(timeoutTimer);
        clearInterval(pollInterval);
        window.removeEventListener("popstate", checkURLChange);
        window.removeEventListener("hashchange", checkURLChange);
      };

      // Listen for URL changes
      window.addEventListener("popstate", checkURLChange);
      window.addEventListener("hashchange", checkURLChange);

      // Watch for DOM changes including subtree mutations (catches section toggling)
      observer = new MutationObserver(checkDOMMutation);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      timeoutTimer = setTimeout(() => {
        done(false); // Timeout reached — will reject
      }, timeout);
    });
  }

  /**
   * Waits for new <option> elements in a dependent select.
   */
  static async waitForSelectOptions(
    meta: SelectorMeta,
    selector: string,
    timeout: number
  ): Promise<boolean> {
    const result = await this.waitForElement(meta, selector, timeout);
    if (!result) return false;

    const selectEl = result.element as HTMLSelectElement;
    if (selectEl.options.length > 1) {
      return true; // Already loaded — no need for observer
    }

    const initialOptionsCount = selectEl.options.length;

    return new Promise((resolve) => {
      let timeoutTimer: ReturnType<typeof setTimeout>;
      const observer = new MutationObserver(() => {
        if (selectEl.options.length > initialOptionsCount || selectEl.options.length > 1) {
          cleanup();
          resolve(true);
        }
      });

      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timeoutTimer);
      };

      observer.observe(selectEl, { childList: true, subtree: true });

      // If already has options (maybe loaded before we checked)
      if (selectEl.options.length > initialOptionsCount || selectEl.options.length > 1) {
        cleanup();
        resolve(true);
      }

      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout);
    });
  }

  /**
   * Tracks network idle state. 
   * Note: A complete implementation in MV3 requires a main-world injected script
   * to proxy fetch/XHR. We provide the polling interface here.
   */
  static async waitForNetworkIdle(timeout: number = WAIT_NETWORK_IDLE_TIMEOUT): Promise<void> {
    // Wait for the ceiling unconditionally as a fallback or implement 
    // postMessage communication with an injected script.
    // For now, resolving after a short delay since we can't block indefinitely
    // without the proxy script active.
    return new Promise((resolve) => {
      // Listen for network idle messages from the injected script
      const listener = (event: MessageEvent) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === "FORMPILOT_NETWORK_IDLE") {
          clearTimeout(ceilingTimer);
          window.removeEventListener("message", listener);
          resolve();
        }
      };
      window.addEventListener("message", listener);

      const ceilingTimer = setTimeout(() => {
        window.removeEventListener("message", listener);
        resolve();
      }, Math.min(timeout, NETWORK_IDLE_CEILING));
    });
  }

  /**
   * Helper method to poll with exponential backoff.
   */
  private static async pollForCondition<T>(
    conditionFn: () => T | null,
    timeout: number
  ): Promise<T> {
    const startTime = Date.now();
    let pollInterval = POLL_INTERVAL_BASE;

    return new Promise((resolve, reject) => {
      const check = () => {
        const result = conditionFn();
        if (result !== null && result !== undefined) {
          resolve(result);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error(`Timeout of ${timeout}ms exceeded`));
          return;
        }

        setTimeout(check, pollInterval);
        // Exponential backoff, capped at 1000ms
        pollInterval = Math.min(pollInterval * 1.5, 1000);
      };

      check();
    });
  }
}
