/**
 * Interface that all date picker adapters must implement.
 */
export interface DatePickerAdapter {
  /**
   * The friendly name of the adapter (for logging).
   */
  readonly name: string;

  /**
   * Determines if this adapter matches the given input element.
   */
  matches(element: HTMLElement): boolean;

  /**
   * Opens the calendar popup associated with the input element.
   * Resolves to true if the calendar opened successfully.
   */
  open(element: HTMLElement): Promise<boolean>;

  /**
   * Navigates the open calendar to the target month and year.
   * Resolves to true if navigation was successful.
   */
  navigateToMonth(targetDate: Date): Promise<boolean>;

  /**
   * Clicks the day cell corresponding to the target date.
   * Resolves to true if a cell was found and clicked.
   */
  selectDay(targetDate: Date): Promise<boolean>;

  /**
   * Verifies that the date was successfully applied to the input element.
   * Resolves to true if the value is correct.
   */
  verify(element: HTMLElement, targetDate: Date): Promise<boolean>;
}
