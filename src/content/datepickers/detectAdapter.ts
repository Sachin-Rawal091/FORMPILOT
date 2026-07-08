import { DatePickerAdapter } from "./DatePickerAdapter";
import { DatePickerRegistry } from "./DatePickerRegistry";

/**
 * Detects which date picker adapter to use for a given element.
 * Delegates to the DatePickerRegistry.
 */
export function detectAdapter(element: HTMLElement): DatePickerAdapter | null {
  return DatePickerRegistry.detect(element);
}
