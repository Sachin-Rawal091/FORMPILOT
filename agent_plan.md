# FormPilot — Project Plan

> **Last Updated:** 2026-05-19
> **Source:** [Notion — FormPilot HQ](https://www.notion.so/FormPilot-HQ-Master-Workspace-362c10bc080b814da659fef29417f993)
> **Coverage:** Full sync from Notion (vision, architecture, engines, interfaces, folder structure, sprint plan)
> **Patched:** 2026-05-19 — Added 5 missing ExecutionState fields, CAPTCHA_PAUSED status, 4 missing constants, 2 missing IndexedDB stores, expanded Action enum, SelectorResult shadow field

## Vision

FormPilot is a **production-grade Chrome Extension** that eliminates manual form filling at scale. Users record a form flow once, upload an Excel file with data, and FormPilot fills hundreds of forms automatically — handling multi-page flows, dynamic React/Vue sites, save-and-continue workflows, and real-world failures with full resilience.

> **Core Loop:** 🔴 Record → 📊 Upload Data → ▶️ Execute → 🔁 Recover → 📋 Log

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ POPUP LAYER (React + Zustand)                                       │
│ Popup.tsx · ProgressScreen · RunScreen · LogViewer · Options        │
│ SheetJS parses Excel here → ExcelRow[] → IndexedDB                 │
└───────────────────┬──────────────────────────────────────────────────┘
                    │ FormPilotMessage<T> via messages.ts
┌───────────────────┴──────────────────────────────────────────────────┐
│ SERVICE WORKER (router only, <100 lines)                            │
│ Routes by msg.type → chrome.tabs.sendMessage or chrome.scripting    │
└───────────────────┬──────────────────────────────────────────────────┘
                    │ chrome.tabs.sendMessage(tabId, msg)
┌───────────────────┴──────────────────────────────────────────────────┐
│ CONTENT SCRIPT — owns ALL execution (lives in the page tab)         │
│                                                                      │
│  executor.ts → Row loop → Step loop                                  │
│     ├─ SelectorEngine (7-layer fallback + shadow DOM)                │
│     ├─ SmartWaitEngine (DOM/network/mutation/URL)                    │
│     ├─ ExecutionEngine (fill/click/select/scroll/submit)             │
│     ├─ RetryEngine (backoff + error classification)                  │
│     ├─ StateManager (session snapshot every step)                    │
│     └─ ResponseDetectionEngine (success/fail/captcha)                │
└───────────────────┬──────────────────────────────────────────────────┘
                    │
┌───────────────────┴──────────────────────────────────────────────────┐
│ STORAGE LAYER (StorageManager.ts — single access point)             │
│ session storage │ chrome.storage.local │ IndexedDB                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Architecture Decision Records (ADRs)

- **ADR-001:** Content Script is the Executor — Service Workers die after ~30s; all long-running logic lives in content script
- **ADR-002:** Native Setter for React/Vue inputs — never `element.value = x`; use native input setter + dispatch events
- **ADR-003:** Typed Message Bus — `FormPilotMessage<T>`, no raw strings; every message has `type`, `payload`, `sessionId`, `tabId`
- **ADR-004:** Storage Zone Boundaries — `StorageManager.ts` is the ONLY entry point for all storage operations

---

## Folder Structure

```
formpilot/
├── public/
│   ├── manifest.json
│   ├── icons/
│   │   ├── icon-16.png
│   │   ├── icon-32.png
│   │   ├── icon-48.png
│   │   └── icon-128.png
│   └── popup.html
├── src/
│   ├── background/
│   │   └── service-worker.ts          # Router only (<100 lines)
│   ├── content/
│   │   ├── index.ts                   # Content script entry point
│   │   ├── executor.ts                # Row loop → Step loop orchestrator
│   │   ├── recorder.ts                # Recording engine
│   │   ├── domUtils.ts                # setInputValue(), setSelectValue(), dispatchEvents()
│   │   └── engines/
│   │       ├── SelectorEngine.ts      # 7-layer fallback + shadow DOM
│   │       ├── SmartWaitEngine.ts     # DOM/network/mutation/URL waits
│   │       ├── ExecutionEngine.ts     # FILL/CLICK/SELECT/SCROLL/WAIT/SUBMIT
│   │       ├── RetryEngine.ts         # Backoff + error classification
│   │       ├── StateManager.ts        # Session snapshots, pause/resume
│   │       └── ResponseDetectionEngine.ts  # Success/fail/captcha detection
│   ├── popup/
│   │   ├── App.tsx                    # Main popup component
│   │   ├── main.tsx                   # React entry point
│   │   ├── store/
│   │   │   └── useFormPilotStore.ts   # Zustand store
│   │   ├── screens/
│   │   │   ├── HomeScreen.tsx         # Record / Upload / Run controls
│   │   │   ├── RecordingScreen.tsx    # Live recording indicator
│   │   │   ├── DataScreen.tsx         # Excel upload + column mapping
│   │   │   ├── RunScreen.tsx          # Execution progress + controls
│   │   │   └── LogScreen.tsx          # Execution log viewer
│   │   └── components/
│   │       ├── ProgressBar.tsx
│   │       ├── StatusBadge.tsx
│   │       ├── LogTable.tsx
│   │       └── CaptchaModal.tsx       # ← ADDED: overlay when captchaPending=true
│   ├── storage/
│   │   ├── StorageManager.ts          # ONLY entry point for all storage
│   │   └── db.ts                      # ← ADDED: IndexedDB schema init (idb)
│   ├── types/
│   │   └── index.ts                   # ALL TypeScript interfaces
│   ├── shared/
│   │   ├── constants.ts               # All tunable values
│   │   └── messages.ts                # FormPilotMessage<T> helpers
│   └── utils/
│       └── logger.ts                  # Structured logging utility
├── tests/
│   └── ...                            # Vitest tests (mirror src/ structure)
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── package.json
└── README.md
```

---

## TypeScript Interfaces (`src/types/index.ts`)

### Action Enum

```typescript
// PATCHED: Added FILE_UPLOAD, SELECT_RADIO, TOGGLE_CHECKBOX, RICH_TEXT,
// NAVIGATE_NEXT, MANUAL_IFRAME, DATEPICKER — required by resilience features
enum Action {
  FILL,
  CLICK,
  SELECT,
  SELECT_RADIO, // match radio by value attribute, not DOM index
  TOGGLE_CHECKBOX, // check current state before toggling
  WAIT,
  SCROLL,
  SUBMIT,
  FILE_UPLOAD, // DataTransfer injection — pre-uploaded file from IndexedDB
  RICH_TEXT, // contenteditable + execCommand for TinyMCE/Quill/CKEditor
  NAVIGATE_NEXT, // multi-page "Next" / "Save & Continue" step
  MANUAL_IFRAME, // cross-origin iframe — pause + prompt user to fill manually
  DATEPICKER, // custom date picker click sequence
}
```

### Step

```typescript
interface Step {
  id: string; // UUID
  action: Action;
  selector: string; // Primary selector string
  selectorMeta: SelectorMeta; // All captured selectors for fallback
  value?: string; // For FILL/SELECT — supports {{columnName}} placeholders
  options?: StepOptions;
  pageId: string; // Which page in a multi-page flow
  // ADDED: required for missing-value resolution + resilience features
  columnName?: string; // maps to Excel column header
  required?: boolean; // false = skip step on miss; true = skip row
  defaultValue?: string; // used when cell is empty/null
  expectedType?: "text" | "number" | "date" | "boolean"; // enables auto-coercion
  skipOnEmpty?: boolean; // always skip if empty, never use default
  frameId?: number; // for same-origin iframe steps
  checked?: boolean; // for TOGGLE_CHECKBOX — desired end state
  retryable?: boolean; // default: true
  maxRetries?: number; // default: 3
}
```

### SelectorMeta & SelectorResult

```typescript
interface SelectorMeta {
  id?: string; // element.id
  name?: string; // element.name
  ariaLabel?: string; // aria-label
  placeholder?: string; // placeholder
  labelText?: string; // associated <label> text
  cssPath?: string; // computed unique CSS path
  xpath?: string; // XPath fallback
}

// PATCHED: Added shadow field — required for Shadow DOM piercing (C3 fix)
interface SelectorResult {
  element: Element;
  strategy: SelectorStrategy; // Which fallback layer matched
  confidence: number; // 0-1 reliability score
  shadow: boolean; // true if found inside a shadow root
}

enum SelectorStrategy {
  ID,
  NAME,
  ARIA_LABEL,
  LABEL_LINKED,
  PLACEHOLDER,
  CSS_PATH,
  XPATH,
  SHADOW_DOM,
}
```

### ExecutionState

```typescript
// PATCHED: Added 5 critical fields — without these you get production bugs:
// - pageRetryCount: missing = infinite retry loop (never escalates to FATAL)
// - mutexLock: missing = double-clicking Run corrupts session state
// - captchaPending: missing = popup can't show CaptchaModal on reopen
// - tabContext: missing = multi-tab form navigation breaks
// - lastStepResult: missing = ProgressScreen goes blank if popup is closed mid-run
interface ExecutionState {
  sessionId: string; // UUID per run
  currentRowIndex: number;
  currentStepIndex: number;
  currentPageId: string;
  status: ExecutionStatus;
  totalRows: number;
  completedRows: number;
  failedRows: number;
  skippedRows: number;
  // ↓ ADDED FIELDS ↓
  pageRetryCount: number; // increments on RETRYABLE; reset on page transition; cap=3
  mutexLock: string | null; // holds sessionId of active run; null = no run active
  captchaPending: boolean; // true = CaptchaModal shown in popup on next open
  tabContext: number; // active tab ID — tracks execution across multi-tab forms
  lastStepResult: string; // last LogStatus string — popup reconstructs progress on reopen
}

// PATCHED: Added CAPTCHA_PAUSED — required by ResponseDetectionEngine CAPTCHA flow
enum ExecutionStatus {
  IDLE,
  RUNNING,
  PAUSED,
  CAPTCHA_PAUSED, // ← ADDED: execution halted waiting for user to solve CAPTCHA
  COMPLETE,
  FAILED,
}
```

### Recording & ExcelRow

```typescript
interface Recording {
  id: string;
  name: string;
  siteUrl: string;
  siteId: string; // derived from hostname — used as storage key
  steps: Step[];
  pages: PageDef[]; // Multi-page flow definitions
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  version: number; // increment on edit — prevents stale replay
}

interface ExcelRow {
  rowIndex: number;
  data: Record<string, string | number | boolean | null>; // supports typed values
  status: RowStatus;
  isValid: boolean;
  validationErrors: string[];
  error?: string;
}

enum RowStatus {
  PENDING,
  SUCCESS,
  FAILED,
  SKIPPED,
}
```

### LogEntry

```typescript
// PATCHED: Added strategy, duration fields — required by LogViewer UI
interface LogEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  rowIndex: number;
  stepId: string;
  action: Action;
  selector: string;
  strategy?: string; // which SelectorStrategy succeeded
  value?: string;
  result: StepResult;
  status: LogStatus; // granular status for UI color coding
  error?: string;
  retryCount: number;
  duration: number; // ms — used for anomaly detection baseline
  selectorStrategy?: SelectorStrategy;
}

enum StepResult {
  SUCCESS,
  FAILED,
  SKIPPED,
}

// PATCHED: Added all granular log statuses for LogViewer color coding
type LogStatus =
  | "FILLED" // ✅ green  — normal fill
  | "FILLED_DEFAULT" // 🔵 blue   — used configured default value
  | "FILLED_COERCED" // 🔵 blue   — type-coerced before fill
  | "STEP_SKIPPED" // ⚪ gray   — optional step skipped
  | "WARN" // ⚠️ amber  — used raw string after failed coercion
  | "ROW_SKIPPED" // ❌ red    — required field missing, row aborted
  | "RETRIED" // ⚠️ amber  — retry attempted
  | "CAPTCHA_DETECTED" // 🔴 red    — execution paused for CAPTCHA
  | "SUCCESS" // ✅ green  — row completed successfully
  | "FAILED"; // ❌ red    — row failed
```

### FormPilotMessage (ADR-003)

```typescript
// PATCHED: Added sessionId field — required for state correlation across components
interface FormPilotMessage<T = unknown> {
  type: MessageType;
  payload: T;
  sessionId: string; // ← ADDED: UUID ties message to its execution session
  tabId?: number;
  timestamp: number;
}

// PATCHED: Added CAPTCHA_DETECTED — required by ResponseDetectionEngine
enum MessageType {
  // Popup → SW → Content Script
  START_RECORDING,
  STOP_RECORDING,
  START_EXECUTION,
  PAUSE_EXECUTION,
  RESUME_EXECUTION,
  ABORT_EXECUTION,
  // Content Script → SW → Popup
  RECORDING_EVENT,
  EXECUTION_PROGRESS,
  EXECUTION_COMPLETE,
  STEP_RESULT,
  STATE_UPDATE,
  ERROR_REPORT,
  CAPTCHA_DETECTED, // ← ADDED: content script → popup, triggers CaptchaModal
  PAGE_NAVIGATED, // ← ADDED: content script → SW, multi-page tracking
  GET_STATUS, // ← ADDED: popup → SW, reconstruct progress on reopen
}
```

---

## Engine Specs

### 1. Selector Engine (`SelectorEngine.ts`)

**7-layer fallback chain** — tries each strategy in order, returns first match:

| Priority | Strategy     | Selector                        | Confidence |
| -------- | ------------ | ------------------------------- | ---------- |
| 1        | ID           | `#id`                           | 1.0        |
| 2        | Name         | `[name="x"]`                    | 0.9        |
| 3        | Aria-label   | `[aria-label="x"]`              | 0.85       |
| 4        | Label-linked | `label[for]` → input            | 0.8        |
| 5        | Placeholder  | `[placeholder="x"]`             | 0.7        |
| 6        | CSS Path     | Computed unique path            | 0.5        |
| 7        | XPath        | XPath fallback                  | 0.4        |
| 8        | Shadow DOM   | Recursive shadow root traversal | 0.6        |

**Additional requirements:**

- Selector scoring system (rank by reliability)
- Fallback chain — try next strategy if current fails
- Handle dynamic DOM (React/SPA re-renders)
- Shadow DOM piercing: walk `document.querySelectorAll('*')`, check `el.shadowRoot`, traverse recursively
- **Performance cap:** abort shadow traversal after 500 elements checked
- Return `SelectorResult` with strategy used + confidence score + `shadow: boolean`

### 2. Smart Wait Engine (`SmartWaitEngine.ts`)

| Function                                     | Mechanism                                                |
| -------------------------------------------- | -------------------------------------------------------- |
| `waitForElement(selector, timeout)`          | Polls until element present in DOM                       |
| `waitForElementVisible(selector, timeout)`   | Checks element is visible (not `display:none`)           |
| `waitForElementClickable(selector, timeout)` | Checks element is interactable (not disabled)            |
| `waitForDOMStability(timeout)`               | MutationObserver — resolves when no mutations for N ms   |
| `waitForURLChange(currentURL, timeout)`      | Detects navigation (pushState/popstate/hashchange)       |
| `waitForNetworkIdle(timeout)`                | Intercepts fetch/XHR — resolves when no pending requests |
| `waitForSelectOptions(selector, timeout)`    | Detects new `<option>` elements in dependent selects     |

**Rules:**

- Configurable timeout per wait type (see `constants.ts`)
- Exponential backoff on poll interval
- ⚠️ **NO `setTimeout`-only waits anywhere** — always use smart detection
- **Navigation detection** requires TWO signals simultaneously: URL change AND > 40% of `document.body` direct children replaced — single signal = UI update, not navigation
- **Network idle ceiling:** 8000ms — after ceiling, treat as idle enough and proceed
- **XHR blocklist:** ignore analytics/tracking domains (see `NETWORK_IDLE_BLOCKLIST` in constants)

### 3. Execution Engine (`ExecutionEngine.ts`)

- **Step queue** — sequential async processing (one step at a time)
- **Large Excel Data Handling:** Request rows from `StorageManager.ts` in paginated chunks (e.g., 50 rows) to prevent out-of-memory crashes; NEVER load the entire 10,000+ row array from Popup.
- **Cross-Origin Iframe Execution:** If a step targets a cross-origin iframe, delegate via `messages.ts` using `frameId`. Same-origin iframes: inject content script using `chrome.scripting` with `frameIds`. Cross-origin: pause + prompt user to fill manually + resume.
- **Variable resolution:** `resolveAndValidateValue()` runs before every FILL step — handles 8 missing-value scenarios (see Missing Value Resolution below)
- Each step: **resolve variables → find element → smart wait → execute action → dispatch events → save state → log result**
- Actions:
  - `FILL` — uses `setInputValue()` from `domUtils.ts` (React-safe native setter)
  - `CLICK` — handles React synthetic events (mousedown → mouseup → click)
  - `SELECT` — uses `setSelectValue()` from `domUtils.ts`; calls `waitForSelectOptions()` after every SELECT (dynamic dropdowns)
  - `SELECT_RADIO` — match by `value` attribute, not DOM index
  - `TOGGLE_CHECKBOX` — read current `.checked` state; only click if state change needed
  - `SCROLL` — scroll to element / scroll by amount
  - `WAIT` — explicit pause via Smart Wait Engine
  - `SUBMIT` — form submission handler
  - `FILE_UPLOAD` — read blob from IndexedDB by alias; inject via `DataTransfer`; dispatch drop event; verify filename in DOM
  - `RICH_TEXT` — `element.focus()` → `execCommand('selectAll')` → `execCommand('insertText', false, value)`
  - `NAVIGATE_NEXT` — routes through full Execution Engine path (not bypassed)
  - `MANUAL_IFRAME` — pause + show popup prompt + resume on user confirm
- Step result reporting back to State Manager after each step
- **Mutex check on start:** read `mutexLock` from `ExecutionState`; if non-null, block start and show "Active session exists — Resume or Abort?"

### 4. Retry Engine (`RetryEngine.ts`)

- Per-step retry with configurable max attempts (default: 3)
- Exponential backoff between retries (100ms → 200ms → 400ms)
- On retry: attempt alternate selector from fallback chain
- **Error classification:**
  - `SKIPPABLE` — element optional, skip and continue (e.g., optional field not found)
  - `RETRYABLE` — temporary failure, try again (e.g., element not yet rendered)
  - `FATAL` — unrecoverable, abort entire run (e.g., page crashed)
- **Page-level retry cap:** `pageRetryCount` in `ExecutionState` increments on every `RETRYABLE` error. After 3 page retries → escalate to `FATAL` → skip row. Reset `pageRetryCount` to 0 on every successful page transition.
- Skip logic — mark step as skipped, continue to next
- Stop logic — abort entire run on FATAL error
- All retry attempts logged with attempt count

### 5. State Manager (`StateManager.ts`)

- Saves to `chrome.storage.session` after **every step**:
  - `currentRowIndex`, `currentStepIndex`, `currentPageId`
  - `sessionId` (UUID per run)
  - `status`: IDLE / RUNNING / PAUSED / CAPTCHA_PAUSED / COMPLETE / FAILED
  - `pageRetryCount`, `mutexLock`, `captchaPending`, `tabContext`, `lastStepResult`
- `resumeState()` — restore execution from last saved state
- Clear state on successful run completion
- Detect stale state from previous crash on startup
- **Popup reconstruction:** Popup reads `ExecutionState` from session storage on mount — never from React state. If `captchaPending = true`, show `CaptchaModal` immediately.
- **Mutex management:** Set `mutexLock = sessionId` on run start. Clear on COMPLETE / FATAL / user Abort.

### 6. Response Detection Engine (`ResponseDetectionEngine.ts`)

- Detect URL change to confirmation/success page
- Detect success DOM elements (`.success`, `.confirmation`, `[data-success]`)
- Detect toast/alert success messages
- Detect validation error messages (`.error`, `.invalid`, `[aria-invalid]`)
- Detect "stayed on same page after submit" (failure signal)
- Detect network error responses (via fetch interception)
- **CAPTCHA Detection & UX Loop:**
  - Detects: `#g-recaptcha`, `iframe[src*="recaptcha"]`, `iframe[src*="hcaptcha"]`, `iframe[src*="challenges.cloudflare"]`
  - Set `status = CAPTCHA_PAUSED` and `captchaPending = true` in `ExecutionState`
  - Send `CAPTCHA_DETECTED` message via message bus to popup
  - Trigger `chrome.notifications.create` to alert the user
  - Apply a red "!" badge to the extension icon
  - Bring the tab to the foreground (`chrome.tabs.update(tabId, { active: true })`)
  - Inject a floating UI overlay prompting the user to solve the CAPTCHA and click "Resume"
  - **3-minute timeout** (180,000ms): if unsolved → log `ROW_SKIPPED: captcha_timeout` → move to next row
- **Inline field error check:** After each FILL/CLICK, check for `[aria-invalid]` or `.error` near the filled element — surface immediately, don't wait until page completion
- Output: `SUCCESS` / `FAILED` / `UNKNOWN` per submission
- Trigger retry on `FAILED` if retry budget remains
- Log result to IndexedDB via StorageManager

---

## Missing Value Resolution (8 Scenarios)

Runs inside `resolveAndValidateValue()` in `ExecutionEngine.ts` before every FILL step.

| Scenario                      | Required? | Resolution                   | Log Status       |
| ----------------------------- | --------- | ---------------------------- | ---------------- |
| Value exists, valid type      | —         | Continue to Selector Engine  | `FILLED`         |
| Column not found in Excel     | Yes       | Skip entire row              | `ROW_SKIPPED`    |
| Column not found in Excel     | No        | Skip this step only          | `STEP_SKIPPED`   |
| Value empty/null, default set | —         | Use `step.defaultValue`      | `FILLED_DEFAULT` |
| Value empty/null, no default  | Yes       | Skip entire row              | `ROW_SKIPPED`    |
| Value empty/null, no default  | No        | Skip step, leave field empty | `STEP_SKIPPED`   |
| Wrong type, coercible         | —         | Auto-coerce then fill        | `FILLED_COERCED` |
| Wrong type, not coercible     | —         | Use raw string, continue     | `WARN`           |

**Supported auto-coercions:**

- `"42"` → `42` (string → number)
- `"2024-01-15"` → `new Date(...)` (ISO string → Date)
- `"true"` / `"false"` → `true` / `false` (boolean string → boolean)
- `42` → `"42"` (number → string, always safe)

---

## Multi-Page Form Handling

> Critical for forms that span multiple URL changes (wizards, multi-step flows)

- Detect `history.pushState` navigation
- Detect `popstate` event
- Detect `hashchange` event
- URL polling fallback (for meta-refresh style redirects)
- Persist execution state through navigation (`chrome.storage.session` survives)
- Resume step queue after new page DOM is stable (via SmartWaitEngine)
- Navigation timeout detection — if page doesn't load within threshold, classify as FATAL
- **SPA false navigation prevention:** navigation only confirmed when BOTH URL changes AND > 40% of `document.body` children are replaced simultaneously

---

## Save & Continue Support

- **Checkpoint system** — save progress after every N steps (configurable via `CHECKPOINT_INTERVAL`)
- On browser crash / tab close: state persists in `chrome.storage.session`
- On extension restart: detect incomplete session → offer resume
- Per-row tracking: each row's status (PENDING/SUCCESS/FAILED/SKIPPED) saved independently
- Skip already-completed steps on resume
- Conflict detection: if page structure changed since last save, log warning

---

## Storage Schema

### chrome.storage.session (volatile, per-session)

```
executionState: ExecutionState     # Current run position — full interface including 5 new fields
```

### chrome.storage.local (persistent, 10MB cap)

```
recordings_index: RecordingIndex[] # Metadata only — step arrays in IndexedDB
settings: UserSettings             # User preferences
site_config_{siteId}: SiteConfig   # Per-site navigation threshold, XHR blocklist
field_map_{recordingId}: FieldMap  # columnName → stepId mapping
```

> ⚠️ NEVER write logs or Excel data to chrome.storage.local — 10MB cap will fill in one large run

### IndexedDB via idb (persistent, unlimited)

```
Store: "recordings" → Recording[]    # ← ADDED: step arrays moved here from chrome.storage.local
Store: "excelData"  → ExcelRow[]     # Uploaded spreadsheet rows (paginated reads only)
Store: "logs"       → LogEntry[]     # Execution logs (per session)
Store: "sessions"   → SessionMeta[]  # Session history / run summaries
Store: "files"      → FileBlob[]     # ← ADDED: pre-uploaded files for FILE_UPLOAD action
```

**Retention policy:** Keep last 30 days OR 100,000 log entries, whichever limit is hit first. Run eviction check on every session start.

---

## Constants (`src/shared/constants.ts`)

```typescript
// Timeouts (ms)
SELECTOR_TIMEOUT: 5000;
WAIT_ELEMENT_TIMEOUT: 10000;
WAIT_DOM_STABLE_TIMEOUT: 3000;
WAIT_DOM_STABILITY_SILENCE: 300; // ms of no mutations before declaring stable
WAIT_NETWORK_IDLE_TIMEOUT: 5000;
WAIT_URL_CHANGE_TIMEOUT: 15000;
NAVIGATION_TIMEOUT: 30000;
STEP_HARD_TIMEOUT: 30000; // global hard ceiling per step

// ADDED: missing values that prevent real bugs
NETWORK_IDLE_CEILING: 8000; // after this ms, treat network as idle and proceed
NAVIGATION_DOM_THRESHOLD: 0.4; // 40% of body children replaced = real navigation
CAPTCHA_SOLVE_TIMEOUT: 180000; // 3 min (180s) before skipping row on CAPTCHA
LOG_MAX_ENTRIES: 100000; // IndexedDB retention cap before eviction

// Retry
MAX_STEP_RETRIES: 3;
RETRY_BACKOFF_BASE: 100; // 100ms → 200ms → 400ms
RETRY_BACKOFF_MAX: 5000; // cap on exponential backoff
MAX_PAGE_RETRIES: 3; // pageRetryCount ceiling before FATAL escalation

// Polling
POLL_INTERVAL_BASE: 50; // ms, with exponential backoff
DOM_STABILITY_WINDOW: 500; // ms of no mutations = stable

// Execution
STEP_DELAY: 100; // ms between steps (human-like pacing)
CHECKPOINT_INTERVAL: 5; // Save every N steps

// Recorder
INPUT_DEBOUNCE_MS: 300; // debounce input events during recording
DOUBLE_CLICK_WINDOW_MS: 200; // max ms between clicks to dedup

// Selector
SHADOW_TRAVERSAL_LIMIT: 500; // max elements to check during shadow DOM piercing
MIN_SELECTOR_CONFIDENCE: 0.6; // minimum confidence to accept a match

// Excel
EXCEL_HEADER_SCAN_ROWS: 5; // rows to scan for auto header detection
EXCEL_FUZZY_MAX_DISTANCE: 2; // Levenshtein distance for fuzzy column matching
EXCEL_EMPTY_ROW_THRESHOLD: 0.8; // % empty cells that marks a row as invalid
EXCEL_CHUNK_SIZE: 50; // rows to load at a time from IndexedDB

// Storage
LOG_RETENTION_DAYS: 30;
STORAGE_QUOTA_WARNING: 0.8; // show warning when 80% full

// Network idle XHR blocklist — domains ignored during waitForNetworkIdle
NETWORK_IDLE_BLOCKLIST: [
  "google-analytics.com",
  "analytics.google.com",
  "mixpanel.com",
  "hotjar.com",
  "facebook.com/tr",
  "doubleclick.net",
  "googletagmanager.com",
];
```

---

## Security & Permissions

- **Minimum permissions:** `activeTab`, `storage`, `scripting`, `alarms`, `notifications`
- **Permissions Scope (`<all_urls>`):** Required to run on unknown, dynamic user-specified websites. **Critical for Week 15:** Must provide rock-solid justification in the Web Store review that this is a user-directed tool executing explicitly recorded scripts without harvesting data. (Consider adding an optional Site Whitelist mode).
- No remote code execution (MV3 CSP enforced)
- No `eval()` anywhere
- No data leaves the browser (all local storage)
- CSP-compliant content script injection
- Excel data stored only in IndexedDB (never synced)
- All message payloads validated before processing (no blind deserialization)

---

## Tech Stack

| Tool               | Purpose            | When Added |
| ------------------ | ------------------ | ---------- |
| Chrome MV3         | Extension platform | Week 1     |
| TypeScript         | Type safety        | Week 1     |
| Vite + CRXJS       | Build system       | Week 1     |
| React              | Popup + Options UI | Week 1     |
| idb                | IndexedDB wrapper  | Week 2     |
| SheetJS            | Excel parsing      | Week 5     |
| Tailwind CSS       | Styling            | Week 11    |
| Zustand            | Popup state        | Week 11    |
| Vitest + happy-dom | Unit testing       | Week 13    |

> ⚠️ **Do NOT use Playwright** for testing. It cannot test MV3 content scripts. Use Vitest for unit tests, puppeteer for integration tests.

---

## 7 Non-Negotiable Rules

1. **Service worker = router only.** No await chain > 20s inside it.
2. **Never** `element.value = x`. Always `setInputValue()` from `domUtils.ts`.
3. **Never** write logs or Excel data to `chrome.storage.local`. IndexedDB only.
4. **All messages** use `FormPilotMessage<T>` with `sessionId`. No raw strings.
5. `StorageManager.ts` is the **only** file that calls storage APIs directly.
6. `pageRetryCount` increments on every RETRYABLE error. Resets on every page transition. Cap = 3.
7. `mutexLock` is checked before every run start. Block if non-null.

---

## Build Dependency Order

```
Phase 0 (before any engine):
  src/types/index.ts          ← no dependencies — CREATE FIRST
  src/shared/messages.ts      ← no dependencies
  src/shared/constants.ts     ← no dependencies

Phase 1 (storage):
  src/storage/db.ts           ← types/index.ts
  src/storage/StorageManager.ts ← db.ts, types/index.ts

Phase 2 (DOM utilities):
  src/content/domUtils.ts     ← no dependencies

Phase 3 (core engines — strict order):
  SelectorEngine.ts     ← domUtils, constants, types
  SmartWaitEngine.ts    ← SelectorEngine, constants, types
  ExecutionEngine.ts    ← SelectorEngine, SmartWaitEngine, domUtils, constants, types
  RetryEngine.ts        ← ExecutionEngine, constants, types
  StateManager.ts       ← StorageManager, types
  ResponseDetection.ts  ← SelectorEngine, SmartWaitEngine, constants, types

Phase 4 (orchestration):
  executor.ts           ← all engines, StateManager, StorageManager, Logger
  recorder.ts           ← SelectorEngine, domUtils, constants, types

Phase 5 (utilities):
  utils/logger.ts       ← StorageManager, types

Phase 6 (service worker):
  background/service-worker.ts  ← shared/messages.ts ONLY

Phase 7 (UI — last):
  popup/*               ← types, messages, StorageManager
```

> Rule: **nothing imports from a phase later than itself.**

---

## 16-Week Sprint Plan

### Phase 0: Pre-Build (Week 1)

- [x] Project definition & architecture design
- [x] Initialize project (Vite + CRXJS + TypeScript + React)
- [x] Create `manifest.json` (MV3)
- [x] Define all TypeScript interfaces (`src/types/index.ts`) — **patched version**
- [x] Define constants (`src/shared/constants.ts`) — **patched version**
- [x] Scaffold folder structure
- [x] Set up `StorageManager.ts` + `db.ts` (IndexedDB init)
- [x] Scaffold service worker (router only)
- [x] Scaffold content script entry point

### Phase 1: Core Engines (Weeks 2–6)

- [x] **Week 2:** SelectorEngine — 8-layer fallback (add Shadow DOM as layer 8) + scoring + `shadow` field in SelectorResult
- [x] **Week 3:** SmartWaitEngine — all 7 wait functions + dual-signal navigation detection + network idle ceiling + XHR blocklist
- [x] **Week 3:** domUtils.ts — setInputValue(), setSelectValue(), setTextareaValue(), event dispatching
- [x] **Week 4:** ExecutionEngine — step queue, all 13 actions, `resolveAndValidateValue()`, mutex check, paginated Excel loading
- [x] **Week 5:** RetryEngine — backoff, fallback chain retry, error classification, `pageRetryCount` enforcement
- [x] **Week 5:** ExcelDataEngine — SheetJS parsing, fuzzy column matching, merged cell handling, type coercion, 8-scenario resolution
- [x] **Week 6:** StateManager — full `ExecutionState` snapshots including 5 new fields, pause/resume/abort, mutex management

### Phase 2: Automation (Weeks 7–9)

- [x] **Week 7:** Multi-page form handling (pushState, popstate, hashchange, URL polling, dual-signal nav detection)
- [x] **Week 8:** Recording Engine — debounced input capture (300ms), deduplication pass, shadow DOM detection, iframe origin detection, FILE_UPLOAD detection, checkbox state capture, radio value capture
- [x] **Week 8:** Save & Continue — checkpoint system, crash recovery
- [x] **Week 9:** ResponseDetectionEngine — success/fail/captcha detection, CAPTCHA UX loop, 3-minute timeout, `CaptchaModal` in popup, inline field error check

### Phase 3: UI (Weeks 10–12)

- [x] **Week 10:** Popup shell — React + Zustand + Tailwind setup; reads `ExecutionState` from storage on mount
- [x] **Week 10:** HomeScreen — record/upload/run controls; Run button disabled when `mutexLock` set
- [x] **Week 11:** RecordingScreen + DataScreen (Excel upload + fuzzy column mapping UI + confidence badges)
- [x] **Week 11:** RunScreen — live progress, pause/resume/abort buttons; `CaptchaModal` overlay on `captchaPending=true`
- [x] **Week 12:** LogScreen — color-coded log viewer (FILLED=green, SKIPPED=gray, RETRIED=amber, ROW_SKIPPED=red) + CSV/JSON export

### Phase 4: Testing & Polish (Weeks 13–14)

- [x] **Week 13:** Vitest unit tests for all engines (mock DOM via happy-dom)
- [x] **Week 13:** Integration tests (recording → execution flow)
- [x] **Week 13:** Real-world test matrix:
      | Form Type | Pass Criteria |
      |-----------|---------------|
      | Login flow | Logs in successfully |
      | Multi-step SaaS signup | All steps complete |
      | Government static HTML form | All fields filled |
      | Job application (LinkedIn/Workday) | File upload + fields |
      | E-commerce checkout (Shopify) | Cart → Confirmation |
      | React SPA form | Controlled inputs fill correctly |
- [x] **Week 14:** Fix P1/P2 bugs from Week 13; performance optimization; graceful degradation for unsupported sites

### Phase 5: Launch (Weeks 15–16)

- [ ] **Week 15:** Chrome Web Store listing, screenshots, description
- [ ] **Week 15:** Privacy policy, permissions justification (`<all_urls>` explanation)
- [ ] **Week 15:** Production build check (no `console.log`, no `eval()`, icons at 16/32/48/128px)
- [ ] **Week 16:** Submit to Chrome Web Store, bug fixes from review

---

## Milestones

| #   | Phase                                               | Weeks | Status         |
| --- | --------------------------------------------------- | ----- | -------------- |
| 0   | Project Setup & Scaffold                            | 1     |  Complete     |
| 1   | Core Engines                                        | 2–6   |  Complete     |
| 2   | Automation (Multi-page, Recording, Save & Continue) | 7–9   |  Complete     |
| 3   | Popup UI                                            | 10–12 |  Complete     |
| 4   | Testing & Polish                                    | 13–14 |  Complete     |
| 5   | Chrome Web Store Launch                             | 15–16 | ⬜ Pending     |

---

## KPIs

| Metric                       | Target    |
| ---------------------------- | --------- |
| Form completion success rate | > 90%     |
| Retry recovery success       | > 70%     |
| Crash / unrecoverable rate   | < 5%      |
| Avg step execution time      | < 2s/step |
| Recording accuracy           | > 95%     |

---

## Future (v2/v3 — Not in v1 Scope)

- 🤖 AI-powered selector healing (v2)
- 🗺️ AI field mapping — claude-haiku maps Excel columns to form fields (v2)
- 📈 Cloud sync & team sharing — Supabase backend (v3)
- 💰 Monetization — freemium model ($0 / $12 Pro / $29 Team)
- 🏢 Enterprise features — SSO, API access, audit logs (v4)

> See Notion HQ for full v2/v3 specs: AI System Design, Scaling Strategy, Monetization pages.
> Notion HQ: https://www.notion.so/FormPilot-HQ-Master-Workspace-362c10bc080b814da659fef29417f993
