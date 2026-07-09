import { FormPilotMessage } from "../types";
import { logger } from "../utils/logger";

/**
 * Sends a message to the background service worker.
 */
export function sendToBackground<T>(msg: FormPilotMessage<T>): Promise<FormPilotMessage | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        const rawMessage = chrome.runtime.lastError.message || 'Unknown runtime messaging error';
        const errorMessage = rawMessage.toLowerCase();
        if (!errorMessage.includes('receiving end does not exist') && !errorMessage.includes('no listener')) {
          logger.warn('Messages', `sendToBackground failed for type ${msg.type}: ${rawMessage}`);
        }
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

/**
 * Sends a message to a specific content script tab.
 */
export async function sendToContentScript<T>(tabId: number, msg: FormPilotMessage<T>): Promise<FormPilotMessage | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (err) {
    const rawMessage = (err as Error).message || 'Unknown content script messaging error';
    const errorMessage = rawMessage.toLowerCase();
    if (!errorMessage.includes('receiving end does not exist') && !errorMessage.includes('no listener')) {
      logger.warn('Messages', `sendToContentScript failed for type ${msg.type} on tab ${tabId}: ${rawMessage}`);
    }
    return null;
  }
}
