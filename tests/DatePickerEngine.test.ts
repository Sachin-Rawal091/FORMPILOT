import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DatePickerEngine } from "../src/content/datepickers/DatePickerEngine";
import { DatePickerRegistry } from "../src/content/datepickers/DatePickerRegistry";
import { RmdpAdapter } from "../src/content/datepickers/adapters/RmdpAdapter";
import { GenericDatePickerAdapter } from "../src/content/datepickers/adapters/GenericDatePickerAdapter";

function makeVisible(el: HTMLElement, width = 120, height = 40) {
  Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
  el.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => {},
  } as DOMRect);
}

describe("DatePickerEngine and Adapters", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("DatePickerRegistry & Matching", () => {
    it("should detect RmdpAdapter for RMDP elements", () => {
      const input = document.createElement("input");
      input.className = "rmdp-input";

      const adapter = DatePickerRegistry.detect(input);
      expect(adapter).toBeInstanceOf(RmdpAdapter);
      expect(adapter?.name).toBe("RmdpAdapter");
    });

    it("should detect GenericDatePickerAdapter for generic date elements", () => {
      const input = document.createElement("input");
      input.className = "datepicker";

      const adapter = DatePickerRegistry.detect(input);
      expect(adapter).toBeInstanceOf(GenericDatePickerAdapter);
      expect(adapter?.name).toBe("GenericDatePickerAdapter");
    });

    it("should return null for non-date elements", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "username";

      const adapter = DatePickerRegistry.detect(input);
      expect(adapter).toBeNull();
    });
  });

  describe("RmdpAdapter E2E Calendar Fill Flow", () => {
    it("should successfully open, navigate, select, and verify RMDP", async () => {
      const input = document.createElement("input");
      input.className = "rmdp-input";
      input.id = "my-dob";
      document.body.appendChild(input);

      // Start fill flow asynchronously
      const fillPromise = DatePickerEngine.fill(input, "15/10/2026");

      // Advance timers to trigger click and MutationObserver setup
      await vi.advanceTimersByTimeAsync(50);

      // Mock RMDP calendar DOM structure
      const calendarWrapper = document.createElement("div");
      calendarWrapper.className = "rmdp-wrapper";
      calendarWrapper.style.display = "block";
      calendarWrapper.style.visibility = "visible";
      calendarWrapper.style.opacity = "1";
      makeVisible(calendarWrapper, 320, 280);

      const headerValues = document.createElement("div");
      headerValues.className = "rmdp-header-values";
      headerValues.textContent = "July, 2026";
      calendarWrapper.appendChild(headerValues);

      const leftArrow = document.createElement("span");
      leftArrow.className = "rmdp-left";
      calendarWrapper.appendChild(leftArrow);

      const rightArrow = document.createElement("span");
      rightArrow.className = "rmdp-right";
      calendarWrapper.appendChild(rightArrow);

      // Create day cells
      let dayClicked = false;
      for (let i = 1; i <= 31; i++) {
        const day = document.createElement("div");
        day.className = "rmdp-day";
        makeVisible(day, 32, 32);
        const span = document.createElement("span");
        span.textContent = String(i);
        day.appendChild(span);
        if (i === 15) {
          day.addEventListener("click", () => {
            dayClicked = true;
            input.value = "15/10/2026";
          });
        }
        calendarWrapper.appendChild(day);
      }

      // Mock navigation arrow click reactions: June -> July -> Aug -> Sept -> Oct (3 clicks from July)
      let clickCount = 0;
      rightArrow.addEventListener("click", () => {
        clickCount++;
        if (clickCount === 1) headerValues.textContent = "August, 2026";
        else if (clickCount === 2) headerValues.textContent = "September, 2026";
        else if (clickCount === 3) headerValues.textContent = "October, 2026";
      });

      document.body.appendChild(calendarWrapper);

      // Let observer, navigation, day selection, verification, and close timers run.
      await vi.advanceTimersByTimeAsync(5000);

      // Check results
      const success = await fillPromise;
      expect(success).toBe(true);
      expect(dayClicked).toBe(true);
      expect(input.value).toBe("15/10/2026");
    });
  });

  describe("GenericDatePickerAdapter Heuristic Calendar Fill Flow", () => {
    it("should successfully match day cells and fill unknown calendar", async () => {
      const input = document.createElement("input");
      input.className = "datepicker";
      document.body.appendChild(input);

      const fillPromise = DatePickerEngine.fill(input, "2026-10-15");

      await vi.advanceTimersByTimeAsync(50);

      // Create generic popup calendar
      const calendar = document.createElement("div");
      calendar.className = "my-custom-calendar datepicker";
      calendar.style.display = "block";
      calendar.style.visibility = "visible";
      calendar.style.opacity = "1";
      makeVisible(calendar, 320, 280);

      const header = document.createElement("div");
      header.className = "datepicker-header";
      header.textContent = "October 2026";
      calendar.appendChild(header);

      // Append 1 to 31 cells to satisfy number heuristcs
      let dayClicked = false;
      for (let i = 1; i <= 31; i++) {
        const cell = document.createElement("div");
        cell.className = "datepicker-cell";
        cell.textContent = String(i);
        makeVisible(cell, 20, 20);
        if (i === 15) {
          cell.addEventListener("click", () => {
            dayClicked = true;
            input.value = "2026-10-15";
          });
        }
        calendar.appendChild(cell);
      }

      document.body.appendChild(calendar);

      // Let observer, selection, verification, and close timers run.
      await vi.advanceTimersByTimeAsync(5000);

      const success = await fillPromise;
      expect(success).toBe(true);
      expect(dayClicked).toBe(true);
      expect(input.value).toBe("2026-10-15");
    });
  });
});
