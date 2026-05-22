# FormPilot — Codebase Issues Report
> **Audit Date:** 2026-05-21  
> **Scope:** Full codebase analysis of 30+ source/test/config files
---
## CRITICAL
### C-1. `manifest.json` missing `alarms` permission
- **File:** `public/manifest.json:19-24`
- **Issue:** `agent_plan.md` lists `alarms` as a minimum required permission, but it is absent from `manifest.json`.
- **Impact:** `chrome.alarms` API calls will throw runtime errors.
### C-2. Switch-case fallthrough in `service-worker.ts:178-183`
- **File:** `src/background/service-worker.ts:178`
- **Issue:** `EXECUTION_COMPLETE` handler calls `sendResponse` but does NOT `return`. Execution falls through to subsequent `if` blocks (`GET_RECORDING_DATA`, `GET_EXCEL_DATA`, etc.).
- **Impact:** After execution completes, the SW may incorrectly attempt to respond to a second message type, causing race conditions and incorrect responses.
### C-3. `window.location.reload()` in `resetFormBetweenRows()` destroys executor context
- **File:** `src/content/executor.ts:279`
- **Issue:** When the in-page form reset fails, the fallback is `window.location.reload()`. This destroys the entire content script JS context — `this.isRunning`, `this.recordingSteps`, etc. — with no auto-resume mechanism.
- **Impact:** Any form that can't be reset in-page causes the entire multi-row run to abort with unrecoverable state loss. The `agent_plan.md` explicitly requires a "checkpoint system" and "crash recovery" but neither is implemented for this path.
### C-4. Mutex race window — in-memory check vs storage check
- **File:** `src/content/executor.ts:103-105` vs `src/popup/store/useFormPilotStore.ts:512-514`
- **Issue:** Popup checks `mutexLock` from storage, but executor only checks `this.isRunning` (in-memory flag). If the popup sends `START_EXECUTION` but content script reinitializes before receiving it, or if two messages arrive rapidly, the mutex can be bypassed.
- **Impact:** Concurrent execution sessions possible, corrupting IndexedDB data.
### C-5. `[aria-invalid='true']` used as submission FAILURE signal
- **File:** `src/content/engines/ResponseDetectionEngine.ts:118`
- **Issue:** `detectFailure()` treats `[aria-invalid='true']` as a form-submission failure indicator. But `aria-invalid` is an inline field validation attribute set on individual fields before submission.
- **Impact:** Every form with unfilled required fields will trigger a "FAILED" detection, causing massive false positives. This was partially fixed in a prior session (removed from detection) but still present in the current file.
---
## HIGH
### H-1. CAPTCHA detection only runs at row completion, not mid-step
- **File:** `src/content/executor.ts:509` — `runSubmissionDetection()` called in `executeRow()`
- **Issue:** CAPTCHA detection runs only after all steps in a row are processed. If a CAPTCHA appears mid-execution (e.g., after step 2 of 10), the remaining 8 steps blindly execute into a blocked page.
- **Impact:** Wasted execution time, potential form corruption, and delayed CAPTCHA pause.
### H-2. `LogEntry.duration` always hardcoded to `0`
- **File:** `src/content/executor.ts:403, 430, 473, 527`
- **Issue:** Every log entry sets `duration: 0`. No step timing is ever captured.
- **Impact:** The `duration` field is completely useless. Cannot measure step performance, cannot detect slow steps, cannot compute avg execution time.
- **Plan requirement:** `agent_plan.md` specifies `duration: number // ms — used for anomaly detection baseline`
### H-3. `LogEntry.strategy` is misused — set to `LogStatus` instead of `SelectorStrategy`
- **File:** `src/content/executor.ts:398`
- **Issue:** `strategy: logStatus` where `logStatus` is a `LogStatus` string (e.g., "FILLED"), but the `LogEntry.strategy` field is documented to hold the `SelectorStrategy` that succeeded.
- **Impact:** Log entries lose the actual selector strategy used (ID, NAME, XPATH, etc.), making debugging selector failures impossible.
### H-4. No paginated Excel reading — `EXCEL_CHUNK_SIZE` never used
- **File:** `src/storage/StorageManager.ts:70-73`
- **Issue:** `getExcelData()` calls `db.getAll('excelData')` which loads ALL rows into memory at once. The constant `EXCEL_CHUNK_SIZE = 50` exists in `constants.ts` but is never referenced anywhere.
- **Plan requirement:** `agent_plan.md` explicitly states: "Request rows from StorageManager in paginated chunks (e.g., 50 rows) to prevent out-of-memory crashes; NEVER load the entire 10,000+ row array from Popup."
- **Impact:** With 10,000+ rows of Excel data, the extension will crash from memory exhaustion.
### H-5. `saveMappings` updates `columnName` but NOT `step.value`
- **File:** `src/popup/store/useFormPilotStore.ts:475-481`
- **Issue:** After column mapping, `step.value` still contains raw `{{columnName}}` template syntax instead of being resolved to the mapped column name. The executor relies on `step.columnName` for resolution, but the inconsistency can cause confusion.
- **Impact:** If any code reads `step.value` expecting actual data (not templates), it gets wrong values.
### H-6. Recorder `pageId` is hostname-based, not URL-pattern-based
- **File:** `src/content/recorder.ts:225`
- **Issue:** `pageId = "page_" + window.location.hostname.replace(/\./g, "_")`. Multi-page forms on different URL paths of the same domain (e.g., `/step1`, `/step2`) all get the same `pageId` (`page_localhost`).
- **Impact:** Multi-page recording/execution tracking is impossible. Steps from different pages are conflated into one page group.
### H-7. `PAGE_NAVIGATED` message defined but never sent
- **File:** `src/types/index.ts:188`
- **Issue:** `MessageType.PAGE_NAVIGATED` exists in the enum, but no code anywhere in the project sends this message type.
- **Plan requirement:** `agent_plan.md` requires multi-page form handling with pushState/popstate/hashchange detection and step queue persistence across navigations.
- **Impact:** Multi-page form support is non-functional despite being a core feature.
### H-8. `CAPTCHA_DETECTED` message omits `tabId`
- **File:** `src/content/engines/ResponseDetectionEngine.ts:363-367`
- **Issue:** The message payload contains `{ tabId: state.tabContext }` but the top-level `FormPilotMessage.tabId` is not set. The SW reads `message.tabId || sender.tab?.id` — if sent without sender context, `tabId` is undefined.
- **Impact:** Chrome notification/tab-focus for CAPTCHA may fail because `tabId` is missing.
---
## MEDIUM
### M-1. `manifest.json` `default_popup` path may be wrong with CRXJS
- **File:** `public/manifest.json:7`
- **Issue:** `"default_popup": "public/popup.html"` — CRXJS/Vite typically expects popup HTML at a specific build output path. Needs verification during development.
### M-2. `import.meta.env?.DEV` in logger may break in service worker
- **File:** `src/utils/logger.ts:12`
- **Issue:** `import.meta.env` may not be available in service worker or content script contexts depending on build configuration.
### M-3. `LogScreen.tsx:42` uses `recentLogs.length` as effect dependency
- **File:** `src/popup/screens/LogScreen.tsx:42`
- **Issue:** `useEffect` depends on `recentLogs.length`. If a log replaces another (same count), the effect won't re-run.
### M-4. `StepOptions` interface is empty and never used
- **File:** `src/types/index.ts:36-38`
- **Issue:** `interface StepOptions {}` — referenced by `step.options?: StepOptions` but no code sets or reads it.
### M-5. Recorder cross-origin iframe detection throws DOM error
- **File:** `src/content/recorder.ts:122`
- **Issue:** Accessing `window.parent.location.href` from cross-origin iframe throws a DOM security exception. While caught, it's noisy in console.
### M-6. No inline CAPTCHA detection during step loop
- **File:** `src/content/executor.ts` (step loop in `executeRow`)
- **Issue:** `detectCaptcha()` is never called between steps. Only `runSubmissionDetection()` at row end detects CAPTCHA.
### M-7. Sequential `if` blocks instead of `switch` in service-worker
- **File:** `src/background/service-worker.ts:48-279`
- **Issue:** All message handlers use sequential `if/else` chains. This is fragile — as C-2 shows, a missing `return` causes fallthrough bugs.
---
## LOW
### L-1. `NETWORK_IDLE_BLOCKLIST` defined but `waitForNetworkIdle` is a stub
- **File:** `src/content/engines/SmartWaitEngine.ts:236-258`
- **Issue:** The function just waits for a custom `postMessage` event or a static timeout ceiling. No actual fetch/XHR interception.
- **Impact:** Network idle detection is non-functional despite the blocklist being defined.
### L-2. `RecordingScreen.tsx` not verified during audit
- **File:** `src/popup/screens/RecordingScreen.tsx`
- **Note:** This screen was not read during the audit. Should be verified separately.
### L-3. No `@types/chrome` in `package.json`
- **Issue:** TypeScript compilation relies on whatever types CRXJS provides. If they're incomplete, some chrome API calls won't be type-checked.
---
## SUMMARY
| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 5 | Mutex gap, reload destroys executor, manifest missing alarms, switch fallthrough, false positive failure detection |
| HIGH | 8 | CAPTCHA too late, no pagination, pageId broken, PAGE_NAVIGATED never sent, no timing data, strategy field misused |
| MEDIUM | 7 | Empty StepOptions, stale effect dep, console noise, if-else fragility |
| LOW | 3 | Network idle is stub, unverified screens, missing types |
| **Total** | **23** | |
**Root cause themes:**
- **Tests pass but don't validate real-world paths** — 92/92 tests pass because they mock all chrome APIs and use simplified DOM scenarios that don't exercise failure recovery, multi-page navigation, or paginated data loading.
- **Plan-to-code gap** — Several `agent_plan.md` requirements (pagination, PAGE_NAVIGATED, checkpoint system) are specified but never implemented.
- **Message flow fragility** — Missing `return` statements, sequential `if` chains, and inconsistent `tabId` handling make the message bus unreliable.