import { FormPilotMessage } from "../../types";
import { StorageManager } from "../../storage/StorageManager";

export class DataHandler {
  static async handleGetExcelData(message: FormPilotMessage, sendResponse: (response: any) => void) {
    const payload = (message.payload || {}) as { afterRowIndex?: number; limit?: number; countOnly?: boolean };
    
    if (payload.countOnly) {
      StorageManager.getExcelDataCount()
        .then(count => sendResponse({ count }))
        .catch(err => sendResponse({ error: err.message }));
    } else {
      StorageManager.getExcelData(payload.afterRowIndex, payload.limit)
        .then(rows => sendResponse({ excelRows: rows || [] }))
        .catch(err => sendResponse({ error: err.message }));
    }
  }

  static async handleSetExcelData(message: FormPilotMessage, sendResponse: (response: any) => void) {
    const payload = message.payload as { excelRows: any[]; updateOnly?: boolean };
    StorageManager.setExcelData(payload.excelRows, !payload.updateOnly)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
  }

  static async handleAddLogEntry(message: FormPilotMessage, sendResponse: (response: any) => void) {
    const payload = message.payload as { entry: any };
    StorageManager.addLogEntry(payload.entry)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
  }

  static async handleSetExecutionState(message: FormPilotMessage, sendResponse: (response: any) => void) {
    const payload = message.payload as { state: any };
    if (payload && payload.state && typeof message.tabId === 'number' && message.tabId >= 0) {
      if (payload.state.tabContext === undefined || payload.state.tabContext === -1) {
        payload.state.tabContext = message.tabId;
      }
    }
    StorageManager.setExecutionState(payload.state)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
  }

  static async handleGetExecutionState(sendResponse: (response: any) => void) {
    StorageManager.getExecutionState()
      .then(state => sendResponse({ state: state || null }))
      .catch(err => sendResponse({ error: err.message }));
  }
}