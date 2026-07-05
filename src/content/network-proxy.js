/**
 * FormPilot Network Proxy — Main World Injection Script
 * 
 * This script runs in the MAIN world (page context) to intercept
 * fetch() and XMLHttpRequest calls. It tracks active in-flight requests
 * and posts a FORMPILOT_NETWORK_IDLE message to the content script
 * world (via window.postMessage) when all pending requests settle.
 * 
 * This enables SmartWaitEngine.waitForNetworkIdle() to detect real
 * network activity instead of relying solely on a ceiling timer.
 * 
 * Blocklist: Analytics/tracking URLs are excluded from tracking so
 * they don't prevent the "idle" state from being reached.
 */

(() => {
  // Guard: only inject once per page
  if (window.__FORMPILOT_NETWORK_PROXY_INSTALLED__) return;
  window.__FORMPILOT_NETWORK_PROXY_INSTALLED__ = true;

  let activeRequests = 0;
  let idleTimer = null;
  const IDLE_DEBOUNCE_MS = 300;

  // URLs matching these patterns are ignored (analytics, tracking pixels, etc.)
  const BLOCKLIST = [
    "google-analytics.com",
    "analytics.google.com",
    "mixpanel.com",
    "hotjar.com",
    "facebook.com/tr",
    "doubleclick.net",
    "googletagmanager.com",
    "sentry.io",
    "newrelic.com",
  ];

  function isBlocklisted(url) {
    try {
      return BLOCKLIST.some(pattern => url.includes(pattern));
    } catch {
      return false;
    }
  }

  function onRequestStart() {
    activeRequests++;
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function onRequestEnd() {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) {
      // Debounce: wait a bit to ensure no rapid follow-up requests
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (activeRequests === 0) {
          const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
          window.postMessage({ type: "FORMPILOT_NETWORK_IDLE", timestamp: Date.now() }, targetOrigin);
        }
        idleTimer = null;
      }, IDLE_DEBOUNCE_MS);
    }
  }

  // ─── Patch fetch() ───────────────────────────────────────────────
  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input && input.url) || "";
    
    if (isBlocklisted(url)) {
      return originalFetch(input, init);
    }

    onRequestStart();
    return originalFetch(input, init)
      .then(response => {
        onRequestEnd();
        return response;
      })
      .catch(error => {
        onRequestEnd();
        throw error;
      });
  };

  // ─── Patch XMLHttpRequest ────────────────────────────────────────
  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function(method, url, ...args) {
    // Store the URL on the instance for blocklist checking in send()
    this.__formpilot_url = typeof url === "string" ? url : url.toString();
    return originalOpen.apply(this, [method, url, ...args]);
  };

  OriginalXHR.prototype.send = function(body) {
    const url = this.__formpilot_url || "";
    
    if (isBlocklisted(url)) {
      return originalSend.call(this, body);
    }

    onRequestStart();

    const onDone = () => {
      onRequestEnd();
      this.removeEventListener("load", onDone);
      this.removeEventListener("error", onDone);
      this.removeEventListener("abort", onDone);
      this.removeEventListener("timeout", onDone);
    };

    this.addEventListener("load", onDone);
    this.addEventListener("error", onDone);
    this.addEventListener("abort", onDone);
    this.addEventListener("timeout", onDone);

    return originalSend.call(this, body);
  };
})();
