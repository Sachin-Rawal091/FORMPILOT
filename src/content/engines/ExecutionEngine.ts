import { Step, Action, LogStatus, SelectorResult } from "../../types";
import { setInputValue, setSelectValue, setTextareaValue, setCheckboxValue, dispatchEvents } from "../domUtils";
import { SmartWaitEngine } from "./SmartWaitEngine";
import { WAIT_DOM_STABLE_TIMEOUT, WAIT_URL_CHANGE_TIMEOUT } from "../../shared/constants";
import { StorageManager } from "../../storage/StorageManager";
import { logger } from "../../utils/logger";
import { sanitizeTextValue } from "../../utils/sanitize";

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
        value: step.value ? sanitizeTextValue(step.value) : null,
        status: "FILLED",
        shouldSkipRow: false,
        shouldSkipStep: !step.value && step.skipOnEmpty ? true : false,
      };
    }

    const targetCol = step.columnName.trim().toLowerCase();
    const actualKey = Object.keys(rowData).find(k => k.trim().toLowerCase() === targetCol);
    const hasColumn = actualKey !== undefined;
    const rawValue = hasColumn ? rowData[actualKey!] : undefined;
    const isMissing = rawValue === undefined || rawValue === null || String(rawValue).trim() === "";

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
        return { value: sanitizeTextValue(String(step.defaultValue)), status: "FILLED_DEFAULT", shouldSkipRow: false, shouldSkipStep: false };
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
        let parsedDate: Date | null = null;
        
        // 1. Check if the value is an Excel numeric date serial
        const numValue = Number(rawValue);
        if (typeof rawValue !== 'boolean' && !isNaN(numValue) && numValue > 10000 && numValue < 100000) {
          parsedDate = parseExcelSerialDate(numValue);
        }
        
        // 2. Parse from date string or Date object
        if (!parsedDate) {
          parsedDate = rawValue instanceof Date ? rawValue : parseDateString(stringValue);
        }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          // Use step.defaultValue as the format sample (reverting to step.value as fallback)
          const formatSample = step.defaultValue || step.value || '';
          stringValue = formatDate(parsedDate, formatSample);
          status = "FILLED_COERCED";
        } else {
          status = "WARN";
        }
      } else if (step.expectedType === "text" && typeOfValue !== "string") {
        status = "FILLED_COERCED"; // simple string cast happened above
      }
    }

    return { value: sanitizeTextValue(stringValue), status, shouldSkipRow: false, shouldSkipStep: false };
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
          let val = resolvedValue || "";
          const isDateInput = 
            el.type === 'date' || 
            el.classList.contains('datepicker') || 
            el.classList.contains('rmdp-input') || 
            el.classList.contains('flatpickr-input') ||
            /date|calendar/i.test(el.name || el.id || el.className || '');

          if (isDateInput && val) {
            const dateObj = parseDateString(val);
            if (dateObj && !isNaN(dateObj.getTime())) {
              const detectedFormat = detectElementDateFormat(el);
              if (detectedFormat) {
                val = formatDate(dateObj, detectedFormat);
              }
            }
          }
          setInputValue(el, val);
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
        await SmartWaitEngine.waitForURLChange(currentURL, WAIT_URL_CHANGE_TIMEOUT)
          .catch((err) => {
            logger.warn('ExecutionEngine', `NAVIGATE_NEXT URL change timed out or failed: ${err.message}. Proceeding anyway.`);
          });
        break;

      case Action.SELECT:
        if (el instanceof HTMLSelectElement) {
          setSelectValue(el, resolvedValue || "");
          await SmartWaitEngine.waitForDOMStability(WAIT_DOM_STABLE_TIMEOUT).catch((err) => {
            logger.debug('ExecutionEngine', `SELECT DOM stability wait timed out: ${err.message}`);
          });
        }
        break;

      case Action.SELECT_RADIO:
        // Match radio by value attribute — scope to closest form/fieldset to avoid wrong-form matches
        const nameAttr = el.getAttribute("name");
        if (nameAttr && resolvedValue) {
          const escapedName = CSS.escape(nameAttr);
          const scope = el.closest('form, fieldset') || document;
          const radios = Array.from(scope.querySelectorAll(`input[type="radio"][name="${escapedName}"]`)) as HTMLInputElement[];
          const targetRadio = radios.find(r => {
            const valMatch = r.value.trim().toLowerCase() === resolvedValue.trim().toLowerCase();
            if (valMatch) return true;
            
            // Try matching by label text
            let labelText = "";
            if (r.id) {
              const labelEl = document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
              if (labelEl) {
                labelText = labelEl.textContent || "";
              }
            }
            if (!labelText) {
              const parentLabel = r.closest('label');
              if (parentLabel) {
                labelText = parentLabel.textContent || "";
              }
            }
            return labelText.trim().toLowerCase() === resolvedValue.trim().toLowerCase();
          });
          if (targetRadio) {
            setCheckboxValue(targetRadio, true);
          }
        }
        break;

      case Action.TOGGLE_CHECKBOX:
        {
          let checkboxInput: HTMLInputElement | null = null;
          if (el instanceof HTMLInputElement && el.type === "checkbox") {
            checkboxInput = el;
          } else {
            // Find nested checkbox input
            checkboxInput = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (!checkboxInput) {
              if (el.id) {
                const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                if (labelEl && labelEl instanceof HTMLInputElement && labelEl.type === "checkbox") {
                  checkboxInput = labelEl;
                }
              }
              if (el instanceof HTMLLabelElement && el.htmlFor) {
                const target = document.getElementById(el.htmlFor);
                if (target instanceof HTMLInputElement && target.type === "checkbox") {
                  checkboxInput = target;
                }
              }
              if (!checkboxInput) {
                const parentLabel = el.closest('label');
                if (parentLabel) {
                  checkboxInput = parentLabel.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
                  if (!checkboxInput && parentLabel.htmlFor) {
                    const target = document.getElementById(parentLabel.htmlFor);
                    if (target instanceof HTMLInputElement && target.type === "checkbox") {
                      checkboxInput = target;
                    }
                  }
                }
              }
            }
          }

          if (checkboxInput) {
            let desiredState = true;
            
            if (resolvedValue !== null && resolvedValue !== undefined) {
              const lowerVal = resolvedValue.toLowerCase().trim();
              const standardTrue = ["true", "yes", "1", "on", "checked"];
              const standardFalse = ["false", "no", "0", "off", "unchecked"];
              
              if (standardTrue.includes(lowerVal)) {
                desiredState = true;
              } else if (standardFalse.includes(lowerVal)) {
                desiredState = false;
              } else {
                // Custom value matching: e.g. "Sports, Music"
                const elValue = checkboxInput.value ? checkboxInput.value.toLowerCase().trim() : "";
                let labelText = "";
                if (checkboxInput.id) {
                  const labelEl = document.querySelector(`label[for="${CSS.escape(checkboxInput.id)}"]`);
                  if (labelEl) {
                    labelText = labelEl.textContent || "";
                  }
                }
                if (!labelText) {
                  const parentLabel = checkboxInput.closest('label');
                  if (parentLabel) {
                    labelText = parentLabel.textContent || "";
                  }
                }
                const lowerLabel = labelText.toLowerCase().trim();
                const parts = lowerVal.split(',').map(p => p.trim());
                
                const hasValMatch = elValue && elValue !== "on" && (parts.includes(elValue) || lowerVal.includes(elValue));
                const hasLabelMatch = lowerLabel && (parts.includes(lowerLabel) || parts.some(p => lowerLabel.includes(p) || p.includes(lowerLabel)));
                
                desiredState = !!(hasValMatch || hasLabelMatch);
              }
            } else {
              desiredState = step.checked !== undefined ? step.checked : true;
            }

            if (checkboxInput.checked !== desiredState) {
              setCheckboxValue(checkboxInput, desiredState);
            }
          } else {
            // Fallback for custom checkboxes: click to toggle
            dispatchEvents(el, ["mousedown", "mouseup", "click"]);
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
        // Modern approach: Selection API plus text node replacement avoids deprecated execCommand.
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
          range.deleteContents();
          range.insertNode(document.createTextNode(resolvedValue || ''));
          selection.removeAllRanges();
        }
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: resolvedValue || '',
          bubbles: true,
          cancelable: true
        }));
        if (el.textContent !== (resolvedValue || '')) {
          el.textContent = resolvedValue || '';
        }
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
          let val = resolvedValue;
          const dateObj = parseDateString(val);
          if (dateObj && !isNaN(dateObj.getTime())) {
            const detectedFormat = detectElementDateFormat(el);
            if (detectedFormat) {
              val = formatDate(dateObj, detectedFormat);
            }
          }
          // Try setting on the input directly (works for native date inputs)
          if (el instanceof HTMLInputElement) {
            setInputValue(el, val);
          }
          // Also try setting on any hidden input within the same container
          // (common pattern in custom date picker libraries)
          const container = el.closest('.datepicker, .date-picker, .flatpickr-wrapper, [class*="date"]');
          if (container) {
            const hiddenInput = container.querySelector('input[type="hidden"], input.flatpickr-input') as HTMLInputElement | null;
            if (hiddenInput && hiddenInput !== el) {
              setInputValue(hiddenInput, val);
            }
          }
        }
        break;
    }
  }
}

/**
 * Converts an Excel numeric serial date (e.g. 45789) to a JavaScript Date object.
 */
function parseExcelSerialDate(serial: number): Date | null {
  // Excel base date is Dec 30, 1899 due to 1900 leap year bug
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const msInDay = 24 * 60 * 60 * 1000;
  const parsed = new Date(excelEpoch.getTime() + serial * msInDay);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parses date strings in various common formats (e.g. DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD).
 */
function parseDateString(str: string): Date | null {
  if (!str) return null;
  
  // Try standard native parsing for ISO strings (containing 'T') or YYYY-MM-DD strings
  const nativeParsed = new Date(str);
  if (!isNaN(nativeParsed.getTime())) {
    if (str.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
      return nativeParsed;
    }
  }
  
  const cleanStr = str.replace(/[^0-9\-/\.]/g, '').trim();
  
  let separator = '';
  if (cleanStr.includes('/')) separator = '/';
  else if (cleanStr.includes('-')) separator = '-';
  else if (cleanStr.includes('.')) separator = '.';
  
  if (!separator) {
    const parsed = new Date(cleanStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  
  const parts = cleanStr.split(separator);
  if (parts.length !== 3) {
    const parsed = new Date(cleanStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  
  const val1 = Number(parts[0]);
  const val2 = Number(parts[1]);
  const val3 = Number(parts[2]);
  if (isNaN(val1) || isNaN(val2) || isNaN(val3)) {
    const parsed = new Date(cleanStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  
  // Year is first: YYYY/MM/DD
  if (parts[0].length === 4) {
    return new Date(Date.UTC(val1, val2 - 1, val3));
  }
  
  // Year is last
  if (parts[2].length === 4) {
    // DD/MM/YYYY vs MM/DD/YYYY
    if (val1 > 12) {
      return new Date(Date.UTC(val3, val2 - 1, val1));
    }
    if (val2 > 12) {
      return new Date(Date.UTC(val3, val1 - 1, val2));
    }
    // Default fallback to MM/DD/YYYY (standard JS behavior) or DD/MM/YYYY
    return new Date(Date.UTC(val3, val1 - 1, val2));
  }
  
  const parsed = new Date(cleanStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats a Date object to match the exact string format of a sample value.
 */
function formatDate(date: Date, formatSample?: string): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const d = String(date.getUTCDate());

  if (!formatSample || typeof formatSample !== 'string') {
    return `${yyyy}-${mm}-${dd}`;
  }

  const sampleClean = formatSample.replace(/[{}]/g, '').trim();
  
  // If the sample contains letters, it is a column placeholder (e.g. {{DMR-OPEN-DATE}}), not a date formatting template
  if (/[a-zA-Z]/.test(sampleClean)) {
    return `${yyyy}-${mm}-${dd}`;
  }

  let separator = '';
  if (formatSample.includes('/')) separator = '/';
  else if (formatSample.includes('-')) separator = '-';
  else if (formatSample.includes('.')) separator = '.';

  if (!separator) {
    return `${yyyy}-${mm}-${dd}`;
  }

  const parts = sampleClean.split(separator);
  if (parts.length !== 3) {
    return `${yyyy}-${mm}-${dd}`;
  }

  // Year is first: YYYY/MM/DD
  if (parts[0].length === 4) {
    const padMonth = parts[1].length === 2;
    const padDay = parts[2].length === 2;
    return `${yyyy}${separator}${padMonth ? mm : m}${separator}${padDay ? dd : d}`;
  }

  // Year is last: DD/MM/YYYY or MM/DD/YYYY
  if (parts[2].length === 4) {
    const pad1 = parts[0].length === 2;
    const pad2 = parts[1].length === 2;
    const val1 = Number(parts[0]);
    const val2 = Number(parts[1]);

    if (!isNaN(val1) && val1 > 12) {
      return `${pad1 ? dd : d}${separator}${pad2 ? mm : m}${separator}${yyyy}`;
    } else if (!isNaN(val2) && val2 > 12) {
      return `${pad1 ? mm : m}${separator}${pad2 ? dd : d}${separator}${yyyy}`;
    }
    return `${pad1 ? dd : d}${separator}${pad2 ? mm : m}${separator}${yyyy}`;
  }

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Detects the date format template of a DOM input element by checking its value, placeholder, other inputs on the page, or library fallbacks.
 */
function detectElementDateFormat(el: HTMLElement): string | null {
  if (!(el instanceof HTMLInputElement)) return null;

  const getFormatFromInput = (input: HTMLInputElement): string | null => {
    // 1. Check existing attribute value (e.g. value="13/05/2025")
    const attrValue = input.getAttribute('value') || input.value;
    if (attrValue && attrValue.trim() && !/[a-zA-Z]/.test(attrValue)) {
      const cleanVal = attrValue.trim();
      if (cleanVal.split(/[-/\.]/).length === 3) {
        return cleanVal;
      }
    }
    // 2. Check placeholder attribute
    const placeholder = input.getAttribute('placeholder') || input.placeholder;
    if (placeholder && placeholder.trim()) {
      const cleanPlac = placeholder.replace(/[{}]/g, '').trim();
      if (cleanPlac.split(/[-/\.]/).length === 3) {
        return cleanPlac;
      }
    }
    return null;
  };

  // 1. Try the current element first
  const selfFormat = getFormatFromInput(el);
  if (selfFormat) return selfFormat;

  // 2. Try other date inputs on the same page
  const otherInputs = document.querySelectorAll('input.rmdp-input, input.datepicker, input.flatpickr-input, input[type="date"]') as NodeListOf<HTMLInputElement>;
  for (const input of otherInputs) {
    const format = getFormatFromInput(input);
    if (format) return format;
  }

  // 3. Fallback based on library class names
  if (el.classList.contains('rmdp-input')) {
    return "DD/MM/YYYY"; // React Multi Date Picker default format
  }

  return null;
}

