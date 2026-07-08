import { DatePickerAdapter } from "./DatePickerAdapter";
import { GenericDatePickerAdapter } from "./adapters/GenericDatePickerAdapter";
import { RmdpAdapter } from "./adapters/RmdpAdapter";

/**
 * Registry to manage and detect DatePicker adapters.
 */
export class DatePickerRegistry {
  private static adapters: DatePickerAdapter[] = [];

  /**
   * Registers a new DatePicker adapter.
   */
  static register(adapter: DatePickerAdapter): void {
    if (this.adapters.some((a) => a.name === adapter.name)) {
      return;
    }
    this.adapters.push(adapter);
  }

  /**
   * Retrieves all registered adapters.
   */
  static getAdapters(): DatePickerAdapter[] {
    return [...this.adapters];
  }

  /**
   * Finds the first adapter that matches the given element.
   */
  static detect(element: HTMLElement): DatePickerAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.matches(element)) {
        return adapter;
      }
    }
    return null;
  }
}

// Register standard adapters on module load (order matters: custom adapters first, generic fallback last)
DatePickerRegistry.register(new RmdpAdapter());
DatePickerRegistry.register(new GenericDatePickerAdapter());
