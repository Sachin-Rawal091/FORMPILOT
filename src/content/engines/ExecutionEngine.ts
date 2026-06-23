import { Step, Action, LogStatus, SelectorResult } from "../../types";
import { setInputValue, setSelectValue, setTextareaValue, setCheckboxValue, dispatchEvents } from "../domUtils";
import { SmartWaitEngine } from "./SmartWaitEngine";
import { WAIT_DOM_STABLE_TIMEOUT } from "../../shared/constants";
import { StorageManager } from "../../storage/StorageManager";
import { logger } from "../../utils/logger";

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
        dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        // For buttons/links that might trigger wizard transitions,
        // brief DOM stability wait to let section toggling/animations complete
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
          await new Promise(r => setTimeout(r, 300));
        }
        break;

      case Action.NAVIGATE_NEXT:
        const currentURL = window.location.href;
        dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        // Assuming WAIT_URL_CHANGE_TIMEOUT is imported or use hardcoded/SmartWaitEngine default
        // We need to import WAIT_URL_CHANGE_TIMEOUT from constants at the top
        await SmartWaitEngine.waitForURLChange(currentURL, 15000);
        break;

      case Action.SELECT:
        if (el instanceof HTMLSelectElement) {
          setSelectValue(el, resolvedValue || "");
          // Wait for dependent select options to populate (use DOM stability timeout, not element timeout)
          await SmartWaitEngine.waitForSelectOptions(step.selectorMeta, step.selector, WAIT_DOM_STABLE_TIMEOUT).catch(() => {});
        }
        break;

      case Action.SELECT_RADIO:
        // Match radio by value attribute — scope to closest form/fieldset to avoid wrong-form matches
        const nameAttr = el.getAttribute("name");
        if (nameAttr && resolvedValue) {
          const escapedName = CSS.escape(nameAttr);
          const scope = el.closest('form, fieldset') || document;
          const radios = Array.from(scope.querySelectorAll(`input[type="radio"][name="${escapedName}"]`)) as HTMLInputElement[];
          const targetRadio = radios.find(r => r.value === resolvedValue);
          if (targetRadio) {
            setCheckboxValue(targetRadio, true);
          }
        }
        break;

      case Action.TOGGLE_CHECKBOX:
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          const desiredState = step.checked !== undefined ? step.checked : true;
          if (el.checked !== desiredState) {
            setCheckboxValue(el, desiredState);
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
          // Find primary submit button to trigger native/framework handlers
          const submitBtn = el.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            dispatchEvents(submitBtn, ["mousedown", "mouseup", "click"]);
          } else {
            // Fallback to native form.submit() if no button exists
            el.submit();
          }
        } else {
          // If it's a button triggering submit
          dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        }
        break;

      case Action.FILE_UPLOAD:
        if (el instanceof HTMLInputElement && el.type === "file" && resolvedValue) {
          try {
            // Send message to SW to fetch the file blob from IndexedDB since content script might not have direct IDB access or it might be asynchronous
            // For now, if we have a direct dependency on StorageManager, we'll use it
            const fileBlob = await StorageManager.getFileBlob(resolvedValue);
            if (fileBlob && fileBlob.data) {
              const file = new File([fileBlob.data], fileBlob.name, { type: fileBlob.type });
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              el.files = dataTransfer.files;
              dispatchEvents(el, ["change", "input"]);
            } else {
              logger.warn('ExecutionEngine', `File blob not found for alias: ${resolvedValue}`);
            }
          } catch (e) {
            logger.error('ExecutionEngine', `Failed to inject file blob for ${resolvedValue}`, e);
          }
        }
        break;

      case Action.RICH_TEXT:
        el.focus();
        document.execCommand("selectAll");
        document.execCommand("insertText", false, resolvedValue || "");
        dispatchEvents(el, ["input", "change", "blur"]);
        break;

      case Action.MANUAL_IFRAME:
        logger.info('ExecutionEngine', `Pausing for manual iframe interaction on step ${step.id}`);
        // executor.ts will handle the pause + popup logic
        break;

      case Action.DATEPICKER:
        // Custom date picker interaction — click to open, then try to set value
        logger.warn('ExecutionEngine', `DATEPICKER action: Custom date pickers may not accept programmatic value setting. Step: ${step.id}`);
        dispatchEvents(el, ["mousedown", "mouseup", "click"]);
        if (resolvedValue) {
          // Try setting on the input directly (works for native date inputs)
          if (el instanceof HTMLInputElement) {
            setInputValue(el, resolvedValue);
          }
          // Also try setting on any hidden input within the same container
          // (common pattern in custom date picker libraries)
          const container = el.closest('.datepicker, .date-picker, .flatpickr-wrapper, [class*="date"]');
          if (container) {
            const hiddenInput = container.querySelector('input[type="hidden"], input.flatpickr-input') as HTMLInputElement | null;
            if (hiddenInput && hiddenInput !== el) {
              setInputValue(hiddenInput, resolvedValue);
            }
          }
        }
        break;
    }
  }
}
