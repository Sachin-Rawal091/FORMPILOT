import { FormPilotMessage } from "../types";

/**
 * Sends a message to the background service worker.
 */
export async function sendToBackground<T>(msg: FormPilotMessage<T>): Promise<FormPilotMessage> {
  return chrome.runtime.sendMessage(msg);
}

/**
 * Sends a message to a specific content script tab.
 */
export async function sendToContentScript<T>(tabId: number, msg: FormPilotMessage<T>): Promise<FormPilotMessage> {
  return chrome.tabs.sendMessage(tabId, msg);
}
