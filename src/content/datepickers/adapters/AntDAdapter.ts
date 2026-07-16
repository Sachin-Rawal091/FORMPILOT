import { DatePickerAdapter } from "../DatePickerAdapter";
import { dispatchEvents } from "../../domUtils";
import { SmartWaitEngine } from "../../engines/SmartWaitEngine";
import { logger } from "../../../utils/logger";
import {
  DATEPICKER_CALENDAR_OPEN_TIMEOUT,
  DATEPICKER_NAV_STEP_TIMEOUT,
  DATEPICKER_NAV_MAX_ITERATIONS,
  DATEPICKER_VALUE_SETTLE_TIMEOUT,
} from "../../../shared/constants";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export class AntDAdapter implements DatePickerAdapter {
  readonly name = "AntDAdapter";

  matches(element: HTMLElement): boolean {
    return (
      element.classList.contains("ant-picker-input") ||
      element.closest(".ant-picker") !== null
    );
  }

  async open(element: HTMLElement): Promise<boolean> {
    logger.info("AntDAdapter", "Attempting to open AntD DatePicker...");
    element.focus();
    dispatchEvents(element, ["focus", "focusin", "mousedown", "mouseup", "click"]);

    // If there is an ant-picker container, click it as well
    const container = element.closest(".ant-picker") as HTMLElement;
    if (container) {
      dispatchEvents(container, ["click"]);
    }

    const popup = await SmartWaitEngine.waitForCondition(
      () => this.findPopup(),
      DATEPICKER_CALENDAR_OPEN_TIMEOUT
    ).catch(() => null);

    if (!popup) {
      logger.warn("AntDAdapter", "AntD calendar popup did not open.");
      return false;
    }

    logger.debug("AntDAdapter", "AntD popup opened successfully.");
    return true;
  }

  async navigateToMonth(targetDate: Date): Promise<boolean> {
    const popup = this.findPopup();
    if (!popup) {
      logger.error("AntDAdapter", "AntD calendar popup not found for month navigation.");
      return false;
    }

    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();

    let attempts = 0;
    while (attempts < DATEPICKER_NAV_MAX_ITERATIONS) {
      const headerView = popup.querySelector(".ant-picker-header-view") as HTMLElement;
      if (!headerView) {
        logger.warn("AntDAdapter", "Could not locate .ant-picker-header-view. Proceeding directly.");
        return true;
      }

      const text = headerView.textContent?.trim() || "";
      const parsed = this.parseHeader(text);
      if (!parsed) {
        logger.warn("AntDAdapter", `Could not parse header text: "${text}". Proceeding directly.`);
        return true;
      }

      if (parsed.month === targetMonth && parsed.year === targetYear) {
        logger.info("AntDAdapter", `Successfully navigated to target: ${text}`);
        return true;
      }

      // Check if we need to click prev or next month button
      const prevBtn = popup.querySelector(".ant-picker-header-prev-btn") as HTMLElement;
      const nextBtn = popup.querySelector(".ant-picker-header-next-btn") as HTMLElement;
      
      let isNext = false;
      if (parsed.year < targetYear) {
        isNext = true;
      } else if (parsed.year > targetYear) {
        isNext = false;
      } else {
        isNext = parsed.month < targetMonth;
      }

      const clickTarget = isNext ? nextBtn : prevBtn;
      if (!clickTarget) {
        logger.warn("AntDAdapter", "Prev/Next month buttons not found in AntD header.");
        return true;
      }

      const oldText = text;
      dispatchEvents(clickTarget, ["click"]);
      
      await SmartWaitEngine.waitForCondition(() => {
        const currentText = headerView.textContent?.trim() || "";
        return currentText !== oldText ? true : null;
      }, DATEPICKER_NAV_STEP_TIMEOUT).catch(() => null);
      attempts++;
    }

    logger.error("AntDAdapter", `Failed to navigate to month within ${DATEPICKER_NAV_MAX_ITERATIONS} steps.`);
    return false;
  }

  async selectDay(targetDate: Date): Promise<boolean> {
    const popup = this.findPopup();
    if (!popup) {
      logger.error("AntDAdapter", "AntD calendar popup not found for day selection.");
      return false;
    }

    const targetDayStr = String(targetDate.getDate());
    
    // AntD uses .ant-picker-cell for rows/cells, and .ant-picker-cell-inner contains day number
    const cellInners = Array.from(popup.querySelectorAll(".ant-picker-cell-inner")) as HTMLElement[];

    const matchingInner = cellInners.find((inner) => {
      const cell = inner.closest(".ant-picker-cell") as HTMLElement;
      if (cell) {
        // Ignore disabled cells and cells from previous/next month (ant-picker-cell-in-view is usually true for current month)
        if (
          cell.classList.contains("ant-picker-cell-disabled") ||
          !cell.classList.contains("ant-picker-cell-in-view")
        ) {
          return false;
        }
      }
      return inner.textContent?.trim() === targetDayStr;
    });

    if (!matchingInner) {
      logger.error("AntDAdapter", `Day cell for day ${targetDayStr} not found or disabled.`);
      return false;
    }

    logger.info("AntDAdapter", `Clicking day cell: ${targetDayStr}`);
    dispatchEvents(matchingInner, ["mousedown", "mouseup", "click"]);
    return true;
  }

  async verify(element: HTMLElement, _targetDate: Date): Promise<boolean> {
    const inputEl = element as HTMLInputElement;

    // Wait for the input value to settle
    const valueSet = await SmartWaitEngine.waitForCondition(() => {
      return inputEl.value.trim() ? true : null;
    }, DATEPICKER_VALUE_SETTLE_TIMEOUT).catch(() => null);

    if (!valueSet) {
      logger.error("AntDAdapter", `Input value did not settle. Value: "${inputEl.value}"`);
      return false;
    }

    logger.info("AntDAdapter", `AntD date successfully verified: "${inputEl.value}"`);
    return true;
  }

  private findPopup(): HTMLElement | null {
    const popupSelectors = [
      ".ant-picker-dropdown",
      "[class*='ant-picker-dropdown']"
    ];
    for (const sel of popupSelectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) return el;
    }
    return null;
  }

  private parseHeader(text: string): { month: number; year: number } | null {
    // AntD text might be "July 2026", or "2026-07", or "2026年7月"
    // Let's parse year first:
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (!yearMatch) return null;
    const year = parseInt(yearMatch[0], 10);

    // Let's find month index:
    const cleaned = text.toLowerCase();
    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (cleaned.includes(MONTH_NAMES[i].toLowerCase())) {
        return { month: i % 12, year };
      }
    }

    // Try finding month numbers (e.g. "2026-07" or "2026年7月")
    const numbers = cleaned.replace(String(year), "").match(/\b\d{1,2}\b/);
    if (numbers) {
      const monthNum = parseInt(numbers[0], 10);
      if (monthNum >= 1 && monthNum <= 12) {
        return { month: monthNum - 1, year };
      }
    }

    // Try finding month chinese characters like "7月"
    const zhMatch = cleaned.match(/(\d{1,2})月/);
    if (zhMatch) {
      const monthNum = parseInt(zhMatch[1], 10);
      if (monthNum >= 1 && monthNum <= 12) {
        return { month: monthNum - 1, year };
      }
    }

    return null;
  }
}
