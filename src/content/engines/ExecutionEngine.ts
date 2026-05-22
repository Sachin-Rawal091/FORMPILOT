import { Step, Action, LogStatus, SelectorResult } from "../../types";
import { setInputValue, setSelectValue, setTextareaValue, dispatchEvents } from "../domUtils";
import { SmartWaitEngine } from "./SmartWaitEngine";
import { WAIT_ELEMENT_TIMEOUT, WAIT_DOM_STABLE_TIMEOUT } from "../../shared/constants";

export interface ResolvedValueResult {
  value: string | null;
  status: LogStatus;
  shouldSkipRow: boolean;
  shouldSkipStep: boolean;
}

export class ExecutionEngine {
  /**
   * Resolves the variable from Excel row data and handles the 8 missing-value scenarios.
   */
  static resolveAndValidateValue(step: Step, rowData: Record<string, any>): ResolvedValueResult {
    if (!step.columnName) {
      // If no column mapping, just use step.value directly if present
      return {
        value: step.value || null,
        status: "FILLED",
        shouldSkipRow: false,
        shouldSkipStep: !step.value && step.skipOnEmpty ? true : false,
      };
    }

    const hasColumn = Object.prototype.hasOwnProperty.call(rowData, step.columnName);
    const rawValue = hasColumn ? rowData[step.columnName] : undefined;
    const isMissing = rawValue === undefined || rawValue === null || rawValue === "";

    // Scenarios 2 & 3: Column not found
    if (!hasColumn) {
      if (step.required) {
        return { value: null, status: "ROW_SKIPPED", shouldSkipRow: true, shouldSkipStep: true };
      }
      return { value: null, status: "STEP_SKIPPED", shouldSkipRow: false, shouldSkipStep: true };
    }

    // Scenarios 4, 5 & 6: Value empty/null
    if (isMissing) {
      if (step.defaultValue !== undefined && step.defaultValue !== null && step.defaultValue !== "") {
        return { value: String(step.defaultValue), status: "FILLED_DEFAULT", shouldSkipRow: false, shouldSkipStep: false };
      }
      if (step.required) {
        return { value: null, status: "ROW_SKIPPED", shouldSkipRow: true, shouldSkipStep: true };
      }
      return { value: null, status: "STEP_SKIPPED", shouldSkipRow: false, shouldSkipStep: true };
    }

    // Scenarios 1, 7 & 8: Type coercion
    let stringValue = String(rawValue);
    let status: LogStatus = "FILLED";

    if (step.expectedType) {
      const typeOfValue = typeof rawValue;
      if (step.expectedType === "number" && typeOfValue !== "number") {
        const coerced = Number(rawValue);
        if (!isNaN(coerced)) {
          stringValue = String(coerced);
          status = "FILLED_COERCED";
        } else {
          status = "WARN";
        }
      } else if (step.expectedType === "boolean" && typeOfValue !== "boolean") {
        const lower = stringValue.toLowerCase().trim();
        if (lower === "true" || lower === "yes" || lower === "1") {
          stringValue = "true";
          status = "FILLED_COERCED";
        } else if (lower === "false" || lower === "no" || lower === "0") {
          stringValue = "false";
          status = "FILLED_COERCED";
        } else {
          status = "WARN";
        }
      } else if (step.expectedType === "date") {
        const parsed = rawValue instanceof Date ? rawValue : new Date(stringValue);
        if (!isNaN(parsed.getTime())) {
          // Format as YYYY-MM-DD for standard date inputs
          stringValue = parsed.toISOString().split("T")[0];
          status = "FILLED_COERCED";
        } else {
          status = "WARN";
        }
      } else if (step.expectedType === "text" && typeOfValue !== "string") {
        status = "FILLED_COERCED"; // simple string cast happened above
      }
    }

    return { value: stringValue, status, shouldSkipRow: false, shouldSkipStep: false };
  }

  /**
   * Executes the DOM action for a specific step.
   * Assumes the element has already been found via SelectorEngine/SmartWaitEngine.
   */
  static async executeAction(
    step: Step,
    selectorResult: SelectorResult,
    resolvedValue: string | null
  ): Promise<void> {
    const el = selectorResult.element as HTMLElement;

    switch (step.action) {
      case Action.FILL:
        if (el instanceof HTMLInputElement) {
          setInputValue(el, resolvedValue || "");
        } else if (el instanceof HTMLTextAreaElement) {
          setTextareaValue(el, resolvedValue || "");
        }
        break;

      case Action.CLICK:
      case Action.NAVIGATE_NEXT: // Same underlying DOM action, just different intent
        dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        break;

      case Action.SELECT:
        if (el instanceof HTMLSelectElement) {
          setSelectValue(el, resolvedValue || "");
          // Wait for dependent select options to populate
          await SmartWaitEngine.waitForSelectOptions(step.selectorMeta, step.selector, WAIT_ELEMENT_TIMEOUT).catch(() => {});
        }
        break;

      case Action.SELECT_RADIO:
        // Match radio by value attribute
        const nameAttr = el.getAttribute("name");
        if (nameAttr && resolvedValue) {
          const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${nameAttr}"]`)) as HTMLInputElement[];
          const targetRadio = radios.find(r => r.value === resolvedValue);
          if (targetRadio) {
            targetRadio.checked = true;
            dispatchEvents(targetRadio, ["change", "click"]);
          }
        }
        break;

      case Action.TOGGLE_CHECKBOX:
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          const desiredState = step.checked !== undefined ? step.checked : true;
          if (el.checked !== desiredState) {
            el.checked = desiredState;
            dispatchEvents(el, ["change"]);
          }
        }
        break;

      case Action.WAIT:
        await SmartWaitEngine.waitForDOMStability(WAIT_DOM_STABLE_TIMEOUT);
        break;

      case Action.SCROLL:
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        await new Promise(r => setTimeout(r, 500)); // wait for scroll
        break;

      case Action.SUBMIT:
        if (el instanceof HTMLFormElement) {
          el.submit();
        } else {
          // If it's a button triggering submit
          dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        }
        break;

      case Action.FILE_UPLOAD:
        // In a real execution, the blob would be fetched from StorageManager via an injected DataTransfer.
        // For Phase 1 we stub the file upload logic since it relies on IndexedDB blobs.
        if (el instanceof HTMLInputElement && el.type === "file") {
          console.warn(`File upload for ${step.id} requires blob injection from executor.`);
        }
        break;

      case Action.RICH_TEXT:
        el.focus();
        document.execCommand("selectAll");
        document.execCommand("insertText", false, resolvedValue || "");
        dispatchEvents(el, ["input", "change", "blur"]);
        break;

      case Action.MANUAL_IFRAME:
        console.log(`Pausing for manual iframe interaction on step ${step.id}`);
        // executor.ts will handle the pause + popup logic
        break;

      case Action.DATEPICKER:
        // Complex custom date picker logic
        dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        if (resolvedValue) {
          setInputValue(el as HTMLInputElement, resolvedValue);
        }
        break;
    }
  }
}
