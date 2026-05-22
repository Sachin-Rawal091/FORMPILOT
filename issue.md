# FormPilot Comprehensive Issue Backlog

**Updated:** 2026-05-22
**Status:** 26 Issues Identified (5 Critical, 9 High, 5 Medium, 7 Low)

This document consolidates all outstanding bugs, logical flaws, and architecture drift issues across the FormPilot Chrome Extension. Agents working on these issues must read this document, understand the root cause, apply the fix, and remove or check off the issue once completely resolved and verified via tests/builds.

---

## 🔴 CRITICAL SEVERITY (Must Fix Before Launch)

### 1. Resume Message Infinite Loop
*   **Locations:** `src/content/executor.ts:638-643`, `src/background/service-worker.ts:139-149`
*   **Root Cause:** The `executor.ts:resume()` method sends a `RESUME_EXECUTION` runtime message (intended to clear badges). The popup also sends `RESUME_EXECUTION` to resume. The service worker forwards *any* `RESUME_EXECUTION` message it receives straight back to the active tab. When the content script receives it, it runs `resume()`, which sends *another* `RESUME_EXECUTION` message, resulting in an infinite message loop that crashes the extension.
*   **Fix Strategy:** Remove the `RESUME_EXECUTION` message broadcast from `executor.ts:resume()`. If badge clearing is required from the content script, use a dedicated `CLEAR_BADGE` message type that the service worker handles natively without forwarding.

### 2. Popup CAPTCHA Resume Disconnected from Content Script Promise
*   **Locations:** `src/popup/components/CaptchaModal.tsx:99`, `src/content/engines/ResponseDetectionEngine.ts:395-420`
*   **Root Cause:** When a CAPTCHA is detected, `handleCaptchaIfPresent` pauses execution and creates a Promise that waits for the user to solve it. It injects a DOM overlay with a "Resume" button that resolves this promise. However, the popup also shows a `CaptchaModal` with a "Resume" button. Clicking the popup's resume button sends a `RESUME_EXECUTION` message, but this message *does not resolve the pending Promise* in `ResponseDetectionEngine`. Execution remains blocked forever (or until the 3-minute hard timeout).
*   **Fix Strategy:** Make the `RESUME_EXECUTION` message handler in `executor.ts` call a static method on `ResponseDetectionEngine` (e.g., `forceResolveCaptcha()`) that programmatically resolves the pending CAPTCHA promise and dismisses the DOM overlay.

### 3. `window.location.reload()` Destroys Content Script Mid-Execution
*   **Locations:** `src/content/executor.ts:336-343`
*   **Root Cause:** In `resetFormBetweenRows()`, if modal dismissal fails, the code falls back to `window.location.reload()`. This forcefully destroys the entire JS context (and the `runAllRows()` loop). While auto-resume partially recovers execution 500ms later in a new context, the flow is fragile, heavily dependent on the service worker having persisted the exact right state instantly, and abandons pending network requests. The comment stating "we'd need auto-resume" is outdated.
*   **Fix Strategy:** Remove `window.location.reload()`. Instead, use `history.back()`, or extract the base `siteUrl` from `this.siteUrl` and assign `window.location.href = this.siteUrl`. Implement a proper `SmartWaitEngine.waitForURLChange()` to ensure the clean page loads before proceeding to the next row.

### 4. `checkAutoResume()` Race Condition on Script Initialization
*   **Locations:** `src/content/executor.ts:43-66`
*   **Root Cause:** The `Executor` constructor registers message listeners, then calls `checkAutoResume()` which sleeps for 500ms before reading the state. If a `START_EXECUTION` or `RESUME_EXECUTION` message arrives *during* those 500ms, `executor.start()` or `executor.resume()` runs. Then, `checkAutoResume()` finishes sleeping, reads `RUNNING` from state, and blindly calls `this.start()` *again* with the old state, causing race conditions, duplicate execution loops, and overriding `this.sessionId`.
*   **Fix Strategy:** Add a guard inside `checkAutoResume()`: `if (this.isRunning) return;`. Do not resume if execution has already been actively triggered via messages.

### 5. Checkpointing Weaker Than Planned Architecture
*   **Locations:** `src/content/executor.ts:513`, `src/types/index.ts`
*   **Root Cause:** `currentStepIndex` is only saved to state every 5 steps (`CHECKPOINT_INTERVAL`). If a fatal error or reload occurs at step 4, recovery resumes from step 0, repeating actions. Furthermore, `lastStepResult` exists in the `ExecutionState` interface but is never updated.
*   **Fix Strategy:** Update `currentStepIndex` and `lastStepResult` in the state after *every* successful step completion (remove the `% CHECKPOINT_INTERVAL` modulus logic), or batch it reliably without risk of loss.

---

## 🟠 HIGH SEVERITY (Must Fix for Reliable Operation)

### 6. `NAVIGATE_NEXT` Action Does Not Wait for Navigation
*   **Locations:** `src/content/engines/ExecutionEngine.ts:114`, `src/content/engines/SmartWaitEngine.ts:134`
*   **Root Cause:** The `NAVIGATE_NEXT` action dispatches a click event and then immediately proceeds to the next step in the array. It does not wait for the multi-page form or SPA router to actually load the next page. The next step will fail instantly because its target element hasn't rendered yet.
*   **Fix Strategy:** In `ExecutionEngine.ts:115`, after clicking for `NAVIGATE_NEXT`, `await SmartWaitEngine.waitForURLChange(currentURL, WAIT_URL_CHANGE_TIMEOUT)`.

### 7. File Upload is a Stub
*   **Locations:** `src/content/engines/ExecutionEngine.ts:168-173`
*   **Root Cause:** The `FILE_UPLOAD` action currently just logs `console.warn("File upload for ... requires blob injection")`. It cannot actually upload files.
*   **Fix Strategy:** Connect `StorageManager.getFileBlob()` to retrieve the binary data, construct a `DataTransfer` object, append the file, and assign it to the input element's `.files` property. Dispatch `change` events.

### 8. `UNKNOWN` Submission Treated as Success
*   **Locations:** `src/content/executor.ts:603`
*   **Root Cause:** If `ResponseDetectionEngine.runSubmissionDetection()` cannot find a success or failure indicator, it returns `"UNKNOWN"`. `executor.ts` treats `"UNKNOWN"` as `"SUCCESS"`. This will silently skip failed rows on confusing pages.
*   **Fix Strategy:** `"UNKNOWN"` should be treated as `"FAILED"` (or explicitly logged for human review). Do not increment `completedRows` unless positive confirmation of success is found.

### 9. Radio/Checkbox React-Unfriendly Property Setting
*   **Locations:** `src/content/engines/ExecutionEngine.ts:133,143`, `src/content/domUtils.ts`
*   **Root Cause:** The code sets `targetRadio.checked = true` or `el.checked = desiredState` directly. In React and Vue apps, this bypasses the framework's internal state tracker (unlike `setInputValue` which properly bypasses the prototype). The UI updates visually, but submitting the form sends the old, false values.
*   **Fix Strategy:** Implement `setCheckboxValue(input, boolean)` and `setRadioValue(input, boolean)` inside `domUtils.ts` using the same prototype-override trick as `setInputValue`, then dispatch native `change` and `click` events.

### 10. `form.submit()` Bypasses Native and Framework Handlers
*   **Locations:** `src/content/engines/ExecutionEngine.ts:160`
*   **Root Cause:** Calling `HTMLFormElement.submit()` directly ignores `<button type="submit">` interceptors, HTML5 validation (`required`, `pattern`), React `onSubmit` synthetic events, and analytics hooks.
*   **Fix Strategy:** If the target is a form, find the primary submit button (`form.querySelector('button[type="submit"], input[type="submit"]')`) and dispatch a click on *that* button instead.

### 11. Service Worker Not Router-Only
*   **Locations:** `src/background/service-worker.ts`
*   **Root Cause:** The service worker violates the 100-line router-only constraint described in `agent_plan.md`. It contains 294 lines, including heavy persistence logic, `stepQueue` debouncing, and proxy storage bridges.
*   **Fix Strategy:** Refactor complex logic (like step queuing and proxy functions) into dedicated helper classes inside a `src/background/` folder, keeping the `service-worker.ts` purely as an event router.

### 12. StorageManager Boundary Broken
*   **Locations:** `src/popup/screens/LogScreen.tsx:5`
*   **Root Cause:** `LogScreen.tsx` imports `getDB()` directly from `src/storage/db.ts` to fetch historic logs, bypassing the `StorageManager` API entirely.
*   **Fix Strategy:** Add a method `StorageManager.getAllLogs()` or `getHistoricLogs()` and remove direct `getDB()` imports in UI components.

### 13. `tabContext` Lost at Content Script Initialization
*   **Locations:** `src/content/engines/StateManager.ts:35`
*   **Root Cause:** `StateManager.initializeSession()` hardcodes `tabContext: -1`. This prevents the CAPTCHA notification loop from properly targeting and foregrounding the tab executing the script.
*   **Fix Strategy:** The popup already sends `tabId` via the `START_EXECUTION` message payload (or message wrapper). `executor.ts` should pass this `tabId` into `StateManager.initializeSession()`.

### 14. Unsafe Selector Injection (XSS Vector)
*   **Locations:** `src/content/engines/ExecutionEngine.ts:130`
*   **Root Cause:** In the `SELECT_RADIO` action block, `document.querySelectorAll('input[type="radio"][name="${nameAttr}"]')` injects `nameAttr` directly. If the HTML attribute contains unescaped quotes (e.g., `name="user's[data]"`), it crashes the selector parser.
*   **Fix Strategy:** Wrap `nameAttr` with `CSS.escape(nameAttr)`.

---

## 🟡 MEDIUM SEVERITY

### 15. Auto-Resume URL Validation is Weak
*   **Locations:** `src/content/executor.ts:50-56`
*   **Root Cause:** `checkAutoResume()` only verifies `window.location.hostname.includes(siteHost)`. If execution crashes on a deeply nested wizard page (e.g., `/checkout/step3`), and the user re-opens the root URL (`/`), auto-resume triggers on the homepage, looking for step 3 elements, generating massive failures.
*   **Fix Strategy:** Store the full `currentUrl` path alongside `siteUrl` in `ExecutionState`. On auto-resume, ensure both hostname AND path match, or at least have a mechanism to navigate back to the active `currentUrl` before resuming.

### 16. Selector Confidence Threshold Unused
*   **Locations:** `src/content/engines/SelectorEngine.ts`, `src/shared/constants.ts`
*   **Root Cause:** `MIN_SELECTOR_CONFIDENCE = 0.6` is defined but never checked. `SelectorEngine` will happily return an XPath match with 0.4 confidence.
*   **Fix Strategy:** Wrap the return values in `SelectorEngine` to check `if (confidence >= MIN_SELECTOR_CONFIDENCE) return match;`.

### 17. `CHUNK_SIZE` Constant Not Imported
*   **Locations:** `src/content/executor.ts:201`
*   **Root Cause:** `executor.ts` hardcodes `const CHUNK_SIZE = 50` rather than importing `EXCEL_CHUNK_SIZE` from shared constants.

### 18. Localized Execution Timing Constants
*   **Locations:** `src/content/executor.ts:27-29`
*   **Root Cause:** `POST_ROW_DELAY_MS` and `POST_SUBMIT_SETTLE_MS` are declared at the top of `executor.ts` instead of centrally in `shared/constants.ts`.

### 19. No Log Retention Enforcement
*   **Locations:** `src/storage/StorageManager.ts`, `src/shared/constants.ts:14,45`
*   **Root Cause:** `LOG_MAX_ENTRIES` and `LOG_RETENTION_DAYS` are defined but `addLogEntry` just grows IndexedDB infinitely.
*   **Fix Strategy:** Add an async maintenance function in `StorageManager` that trims `logs` DB periodically (e.g., keeping only the last 10,000 entries).

---

## 🟢 LOW SEVERITY

### 20. Raw Console Logs
*   **Locations:** Throughout `executor.ts`, `recorder.ts`, `service-worker.ts`
*   **Issue:** Dozens of `console.log()` outputs will clutter user consoles in production.
*   **Fix:** Wrap with a `Logger` utility or conditionally execute based on a `DEBUG_MODE` constant.

### 21. `.gitignore` Too Small
*   **Locations:** `.gitignore`
*   **Issue:** Only ignores `node_modules`. Missing `dist/`, `.env`, `coverage/`, `.DS_Store`, etc.

### 22. Documentation Encoding (Mojibake)
*   **Locations:** `AGENTS.md`, `agent_plan.md`, `agent_progess.md`
*   **Issue:** Markdown files contain corrupted character encoding for symbols (e.g., checkboxes, bullets).

### 23. Unsafe `LogStatus` Cast
*   **Locations:** `src/content/executor.ts:450`
*   **Issue:** `res.resolvedStatus as LogStatus` can mask undefined values. Ensure safe fallback.

### 24. Network Idle Proxy Missing
*   **Locations:** `src/content/engines/SmartWaitEngine.ts:236`
*   **Issue:** `waitForNetworkIdle` expects an injected script sending `FORMPILOT_NETWORK_IDLE` postMessages, but no such script is currently injected into the `main` world.

### 25. Unused `alarms` Permission
*   **Locations:** `manifest.json`
*   **Issue:** `alarms` was added for potential auto-resume loops but is never used by the service worker APIs. Will require justification during Web Store review.

### 26. `excelData` Store State Stale During Execution
*   **Locations:** `src/popup/store/useFormPilotStore.ts:503`
*   **Issue:** Zustand holds an in-memory copy of `excelData` for `totalRows` calculation. As the executor modifies row statuses (`SUCCESS`, `FAILED`) in IndexedDB, the popup store doesn't listen to these changes. The UI won't break since it calculates progress from `completedRows` / `totalRows`, but it's technically stale.
