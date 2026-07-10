// Timeouts (ms)
export const SELECTOR_TIMEOUT = 5000;
export const WAIT_ELEMENT_TIMEOUT = 10000;
export const WAIT_DOM_STABLE_TIMEOUT = 3000;
export const WAIT_DOM_STABILITY_SILENCE = 300;
export const WAIT_NETWORK_IDLE_TIMEOUT = 5000;
export const WAIT_URL_CHANGE_TIMEOUT = 15000;
export const NAVIGATION_TIMEOUT = 30000;
export const STEP_HARD_TIMEOUT = 30000;

export const NETWORK_IDLE_CEILING = 8000;
export const NAVIGATION_DOM_THRESHOLD = 0.4;
export const CAPTCHA_SOLVE_TIMEOUT = 180000;
export const LOG_MAX_ENTRIES = 100000;

// Retry
export const MAX_STEP_RETRIES = 3;
export const RETRY_BACKOFF_BASE = 100;
export const RETRY_BACKOFF_MAX = 5000;
export const MAX_PAGE_RETRIES = 3;

// Polling
export const POLL_INTERVAL_BASE = 50;

// Execution
export const STEP_DELAY = 100;
export const CHECKPOINT_INTERVAL = 5;
export const POST_ROW_DELAY_MS = 500;
export const POST_SUBMIT_SETTLE_MS = 1500;

// Recorder
export const INPUT_DEBOUNCE_MS = 300;
export const DOUBLE_CLICK_WINDOW_MS = 200;

// Selector
export const SHADOW_TRAVERSAL_LIMIT = 500;
export const MIN_SELECTOR_CONFIDENCE = 0.4;
export const XPATH_MAX_DEPTH = 10;

// Excel
export const EXCEL_HEADER_SCAN_ROWS = 5;
export const EXCEL_FUZZY_MAX_DISTANCE = 2;
export const EXCEL_EMPTY_ROW_THRESHOLD = 0.8;
export const EXCEL_CHUNK_SIZE = 50;

// Storage
export const LOG_RETENTION_DAYS = 30;
export const STORAGE_QUOTA_WARNING = 0.8;

// Date Picker Adapters (click-based custom calendar widgets, e.g. react-multi-date-picker)
export const DATEPICKER_CALENDAR_OPEN_TIMEOUT = 3000;
export const DATEPICKER_VIEW_SWITCH_TIMEOUT = 2500;
export const DATEPICKER_NAV_STEP_TIMEOUT = 2000;
export const DATEPICKER_NAV_MAX_ITERATIONS = 60;
export const DATEPICKER_VALUE_SETTLE_TIMEOUT = 2000;

