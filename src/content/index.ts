import './executor'; // initialize executor
import './recorder'; // initialize recorder
import { logger } from '../utils/logger';

logger.info('ContentScript', 'Injected.');

// Inject the network proxy script into the MAIN world so it can
// intercept fetch/XHR and post FORMPILOT_NETWORK_IDLE messages.
// This must run in the page's JS context (not the content script sandbox).
try {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/content/network-proxy.js');
  script.type = 'module';
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove(); // Clean up after execution
} catch (err) {
  logger.warn('ContentScript', 'Failed to inject network proxy script:', err);
}

// Note: Message handlers are registered in executor.ts and recorder.ts
// We do NOT add a generic onMessage handler here to avoid
// competing sendResponse calls that would interfere with
// the recorder's and service worker's async message channels.

