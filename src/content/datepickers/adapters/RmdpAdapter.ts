import { DatePickerAdapter } from "../DatePickerAdapter";
import { dispatchEvents } from "../../domUtils";
import { SmartWaitEngine } from "../../engines/SmartWaitEngine";
import { logger } from "../../../utils/logger";
import {
  DATEPICKER_CALENDAR_OPEN_TIMEOUT,
  DATEPICKER_VIEW_SWITCH_TIMEOUT,
  DATEPICKER_NAV_STEP_TIMEOUT,
  DATEPICKER_NAV_MAX_ITERATIONS,
  DATEPICKER_VALUE_SETTLE_TIMEOUT,
} from "../../../shared/constants";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface HeaderState {
  month: number;
  year: number;
}

/**
 * Adapter for react-multi-date-picker (rmdp) — identified by the `.rmdp-input`
 * trigger class.
 *
 * rmdp tracks the selected date purely in its own internal component state; it
 * never reads the underlying <input>'s DOM `.value`, so the generic
 * click+set-value fallback is a silent no-op here. This adapter performs the
 * real interaction sequence instead: open the calendar, get the visible
 * month/year to match the target date, then click the actual day cell.
 *
 * Stateless between calls (matches GenericDatePickerAdapter's convention) —
 * each method re-locates the open `.rmdp-wrapper` fresh via the DOM rather
 * than caching a reference, since DatePickerEngine only processes one field's
 * calendar at a time.
 */
export class RmdpAdapter implements DatePickerAdapter {
  readonly name = "RmdpAdapter";
  private activeElement: HTMLElement | null = null;

  matches(element: HTMLElement): boolean {
    return element.classList.contains("rmdp-input");
  }

  async open(element: HTMLElement): Promise<boolean> {
    this.activeElement = element;
    dispatchEvents(element, ["mousedown", "mouseup", "click"]);
    const wrapper = await SmartWaitEngine.waitForCondition(
      () => this.findWrapper(),
      DATEPICKER_CALENDAR_OPEN_TIMEOUT
    ).catch(() => null);

    if (!wrapper) {
      logger.warn("RmdpAdapter", "Calendar popup did not open after clicking the input.");
      return false;
    }
    return true;
  }

  async navigateToMonth(targetDate: Date): Promise<boolean> {
    const wrapper = this.findWrapper();
    if (!wrapper) {
      logger.error("RmdpAdapter", "Calendar wrapper not found for month navigation.");
      return false;
    }

    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();

    const isOnTarget = () => {
      const h = this.readHeader(wrapper);
      return !!h && h.month === targetMonth && h.year === targetYear;
    };
    if (isOnTarget()) return true;

    // Fast path: rmdp's built-in year-picker/month-picker views (jump directly).
    try {
      await this.navigateViaPickerViews(wrapper, targetMonth, targetYear);
      if (isOnTarget()) return true;
    } catch (err) {
      logger.debug("RmdpAdapter", `Picker-view navigation unavailable, falling back to arrow stepping: ${(err as Error).message}`);
    }

    // Slow-path fallback: click prev/next arrows one month at a time.
    try {
      await this.navigateViaArrowStepping(wrapper, targetMonth, targetYear);
      return true;
    } catch (err) {
      logger.error("RmdpAdapter", (err as Error).message);
      return false;
    }
  }

  async selectDay(targetDate: Date): Promise<boolean> {
    const wrapper = this.findWrapper();
    if (!wrapper) {
      logger.error("RmdpAdapter", "Calendar wrapper not found for day selection.");
      return false;
    }

    const dayCell = this.findCellByText(wrapper, String(targetDate.getDate()));
    if (!dayCell) {
      logger.error("RmdpAdapter", `Day ${targetDate.getDate()} not found in the currently displayed month.`);
      return false;
    }
    if (this.isCellDisabled(dayCell)) {
      logger.error("RmdpAdapter", `Day ${targetDate.getDate()} is disabled on this field (site does not allow this date).`);
      return false;
    }

    dispatchEvents(dayCell, ["mousedown", "mouseup", "click"]);
    return true;
  }

  async verify(element: HTMLElement, _targetDate: Date): Promise<boolean> {
    this.activeElement = element;
    const inputEl = element as HTMLInputElement;
    const result = await SmartWaitEngine.waitForCondition(() => {
      const closed = !this.findWrapper();
      return inputEl.value.trim() || closed ? true : null;
    }, DATEPICKER_VALUE_SETTLE_TIMEOUT).catch(() => null);

    if (!result) {
      logger.error("RmdpAdapter", `Date did not appear to be set (input still empty, calendar still open).`);
      return false;
    }
    return true;
  }

  /** Finds the currently-open rmdp calendar popup. Stateless — re-queried fresh on every call. */
  private findWrapper(): HTMLElement | null {
    if (this.activeElement) {
      const container = this.activeElement.closest(".rmdp-container");
      if (container) {
        const wrapper = container.querySelector(".rmdp-wrapper") as HTMLElement | null;
        if (wrapper) return wrapper;
      }
    }
    return document.querySelector(".rmdp-wrapper") as HTMLElement | null;
  }

  /** Reads the currently-displayed month/year from the header. Returns null if unavailable. */
  private readHeader(wrapper: HTMLElement): HeaderState | null {
    const headerEl = wrapper.querySelector(".rmdp-header-values");
    if (!headerEl) return null;

    const spans = headerEl.querySelectorAll("span");
    let monthText = "";
    let yearText = "";

    if (spans.length >= 2) {
      monthText = spans[0].textContent?.replace(",", "").trim() ?? "";
      yearText = spans[1].textContent?.trim() ?? "";
    } else {
      // Fallback: parse month name + year from raw text (e.g. "July, 2026")
      const raw = headerEl.textContent ?? "";
      const match = raw.match(/([A-Za-z]+)\D+(\d{4})/);
      if (!match) return null;
      monthText = match[1];
      yearText = match[2];
    }

    const month = MONTH_NAMES.indexOf(monthText);
    const year = Number(yearText);
    if (month === -1 || isNaN(year)) return null;
    return { month, year };
  }

  /** Fast path: use rmdp's built-in year-picker / month-picker views (opened by clicking the header text). */
  private async navigateViaPickerViews(wrapper: HTMLElement, targetMonth: number, targetYear: number): Promise<void> {
    const header = this.readHeader(wrapper);
    if (!header) throw new Error("rmdp: could not read header state.");

    if (header.year !== targetYear) {
      const headerSpans = wrapper.querySelectorAll(".rmdp-header-values span");
      const yearSpan = headerSpans[1] as HTMLElement | undefined;
      if (!yearSpan) throw new Error("rmdp: year header span not found.");
      dispatchEvents(yearSpan, ["mousedown", "mouseup", "click"]);

      const yearPicker = await SmartWaitEngine.waitForCondition(() => {
        const pickerEl = wrapper.querySelector(".rmdp-year-picker") as HTMLElement | null;
        return pickerEl && window.getComputedStyle(pickerEl).display !== "none" ? pickerEl : null;
      }, DATEPICKER_VIEW_SWITCH_TIMEOUT).catch(() => {
        throw new Error("rmdp: year-picker view did not open.");
      });

      let yearCell = this.findCellByText(yearPicker, String(targetYear));
      if (!yearCell) {
        let attempts = 0;
        const maxAttempts = 15;
        while (!yearCell && attempts < maxAttempts) {
          // Read currently rendered years in the year picker grid to determine direction
          const years = Array.from(yearPicker.querySelectorAll(".rmdp-day span"))
            .map(el => Number(el.textContent?.trim()))
            .filter(n => !isNaN(n));
          
          if (years.length === 0) break;
          const minYear = Math.min(...years);
          
          const isBefore = targetYear < minYear;
          const arrowSelector = isBefore ? ".rmdp-left" : ".rmdp-right";
          const arrow = wrapper.querySelector(arrowSelector) as HTMLElement | null;
          if (!arrow || arrow.classList.contains("disabled")) break;
          
          dispatchEvents(arrow, ["mousedown", "mouseup", "click"]);
          await new Promise(r => setTimeout(r, 200));
          
          const activeYearPicker = wrapper.querySelector(".rmdp-year-picker") as HTMLElement | null;
          if (!activeYearPicker) break;
          yearCell = this.findCellByText(activeYearPicker, String(targetYear));
          attempts++;
        }
      }

      if (!yearCell) throw new Error(`rmdp: year ${targetYear} not present or reachable in year-picker range.`);
      if (this.isCellDisabled(yearCell)) {
        throw new Error(`rmdp: year ${targetYear} is disabled (not selectable on this field).`);
      }
      dispatchEvents(yearCell, ["mousedown", "mouseup", "click"]);
    }

    const afterYear = this.readHeader(wrapper);
    if (!afterYear || afterYear.month !== targetMonth) {
      let monthPicker = await SmartWaitEngine.waitForCondition(() => {
        const pickerEl = wrapper.querySelector(".rmdp-month-picker") as HTMLElement | null;
        return pickerEl && window.getComputedStyle(pickerEl).display !== "none" ? pickerEl : null;
      }, DATEPICKER_VIEW_SWITCH_TIMEOUT).catch(() => null);

      if (!monthPicker) {
        const headerSpans = wrapper.querySelectorAll(".rmdp-header-values span");
        const monthSpan = headerSpans[0] as HTMLElement | undefined;
        if (!monthSpan) throw new Error("rmdp: month header span not found.");
        dispatchEvents(monthSpan, ["mousedown", "mouseup", "click"]);

        monthPicker = await SmartWaitEngine.waitForCondition(() => {
          const pickerEl = wrapper.querySelector(".rmdp-month-picker") as HTMLElement | null;
          return pickerEl && window.getComputedStyle(pickerEl).display !== "none" ? pickerEl : null;
        }, DATEPICKER_VIEW_SWITCH_TIMEOUT).catch(() => {
          throw new Error("rmdp: month-picker view did not open.");
        });
      }

      const monthCell = this.findCellByText(monthPicker, MONTH_NAMES[targetMonth]);
      if (!monthCell) throw new Error(`rmdp: month ${MONTH_NAMES[targetMonth]} not found in month-picker.`);
      if (this.isCellDisabled(monthCell)) {
        throw new Error(`rmdp: month ${MONTH_NAMES[targetMonth]} is disabled (not selectable on this field).`);
      }
      dispatchEvents(monthCell, ["mousedown", "mouseup", "click"]);
    }

    await SmartWaitEngine.waitForCondition(() => {
      const h = this.readHeader(wrapper);
      return h && h.month === targetMonth && h.year === targetYear ? true : null;
    }, DATEPICKER_VIEW_SWITCH_TIMEOUT).catch(() => {
      throw new Error("rmdp: header did not settle on target month/year after picker-view navigation.");
    });
  }

  /** Slow-path fallback: repeatedly click the prev/next arrow until the header matches. */
  private async navigateViaArrowStepping(wrapper: HTMLElement, targetMonth: number, targetYear: number): Promise<void> {
    for (let i = 0; i < DATEPICKER_NAV_MAX_ITERATIONS; i++) {
      const header = this.readHeader(wrapper);
      if (!header) throw new Error("rmdp: could not read header state during arrow stepping.");
      if (header.month === targetMonth && header.year === targetYear) return;

      const targetIsAfter =
        targetYear > header.year || (targetYear === header.year && targetMonth > header.month);
      // Matches both the real site's `.rmdp-arrow-container.rmdp-right/left` spans
      // and simplified `.rmdp-right`/`.rmdp-left` markup, since both carry this class.
      const arrowSelector = targetIsAfter ? ".rmdp-right" : ".rmdp-left";
      const arrow = wrapper.querySelector(arrowSelector) as HTMLElement | null;

      if (!arrow) throw new Error(`rmdp: navigation arrow (${targetIsAfter ? "next" : "prev"}) not found.`);
      if (arrow.classList.contains("disabled")) {
        throw new Error(
          `rmdp: reached the edge of the selectable range before reaching ${MONTH_NAMES[targetMonth]} ${targetYear} — this date may not be allowed on this field.`
        );
      }

      const prevHeaderText = wrapper.querySelector(".rmdp-header-values")?.textContent ?? "";
      dispatchEvents(arrow, ["mousedown", "mouseup", "click"]);

      await SmartWaitEngine.waitForCondition(() => {
        const currentText = wrapper.querySelector(".rmdp-header-values")?.textContent ?? "";
        return currentText !== prevHeaderText ? true : null;
      }, DATEPICKER_NAV_STEP_TIMEOUT).catch(() => {
        throw new Error("rmdp: header did not update after clicking the navigation arrow.");
      });
    }

    throw new Error(
      `rmdp: could not reach ${MONTH_NAMES[targetMonth]} ${targetYear} within ${DATEPICKER_NAV_MAX_ITERATIONS} navigation steps.`
    );
  }

  /** Finds a `.rmdp-day` cell (used for day/month/year grids alike in rmdp's DOM) whose inner <span> text exactly matches. */
  private findCellByText(scope: HTMLElement, text: string): HTMLElement | null {
    const cells = Array.from(scope.querySelectorAll(".rmdp-day")) as HTMLElement[];
    return cells.find((cell) => cell.querySelector("span")?.textContent?.trim() === text) ?? null;
  }

  /** A cell is unusable if it's a hidden filler cell (padding for the week grid) or explicitly disabled by the site. */
  private isCellDisabled(cell: HTMLElement): boolean {
    return cell.classList.contains("rmdp-day-hidden") || cell.classList.contains("rmdp-disabled");
  }
}
