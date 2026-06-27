/**
 * Utility functions for DOM manipulation, focusing on React-safe event dispatching.
 */

/**
 * Dispatches a sequence of events to simulate a user action.
 */
export function dispatchEvents(element: Element, eventTypes: string[]): void {
  eventTypes.forEach((type) => {
    let event;
    if (type.startsWith("mouse") || type === "click") {
      event = new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1,
      });
    } else if (type.startsWith("key")) {
      event = new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
      });
    } else {
      event = new Event(type, {
        bubbles: true,
        cancelable: true,
      });
    }
    element.dispatchEvent(event);
  });
}

/**
 * Sets the value of a checkbox element, bypassing React's value setter overloads.
 */
export function setCheckboxValue(input: HTMLInputElement, checked: boolean): void {
  const nativeCheckboxValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "checked"
  )?.set;

  if (nativeCheckboxValueSetter) {
    nativeCheckboxValueSetter.call(input, checked);
  } else {
    input.checked = checked;
  }
  dispatchEvents(input, ["change", "click"]);
}
/**
 * Sets the value of an input element, bypassing React's value setter overloads.
 * This is crucial for filling out React/Vue controlled forms.
 */
export function setInputValue(input: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  dispatchEvents(input, ["input", "change"]);
}

/**
 * Sets the value of a select element, bypassing React's value setter overloads.
 */
export function setSelectValue(select: HTMLSelectElement, value: string): void {
  const normalizedValue = value.trim().toLowerCase();
  
  // Find option that matches value or text case-insensitively
  let targetValue = value;
  for (let i = 0; i < select.options.length; i++) {
    const opt = select.options[i];
    if (
      opt.value.trim().toLowerCase() === normalizedValue ||
      opt.text.trim().toLowerCase() === normalizedValue
    ) {
      targetValue = opt.value;
      break;
    }
  }

  const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  )?.set;

  if (nativeSelectValueSetter) {
    nativeSelectValueSetter.call(select, targetValue);
  } else {
    select.value = targetValue;
  }
  dispatchEvents(select, ["change"]);
}

/**
 * Sets the value of a textarea element, bypassing React's value setter overloads.
 */
export function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  if (nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  dispatchEvents(textarea, ["input", "change"]);
}
