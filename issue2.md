# FormPilot Issue Review 2

Date: 2026-05-22
Scope: Static project scan and implementation-flow review
Status: Issues identified only. No fixes applied in this review.

## Verdict

The implementation flow is not production-complete yet. The project has a solid scaffold and many core pieces are present, but several launch-critical flows are incomplete or fragile: execution resume, navigation recovery, CAPTCHA resume, Excel mapping safety, file upload, and large-data handling.

## Critical / High Issues

### 1. Resume can create a message loop

Severity: Critical

Evidence:
- `src/popup/store/useFormPilotStore.ts` sends `MessageType.RESUME_EXECUTION`.
- `src/background/service-worker.ts` forwards `RESUME_EXECUTION` to the content script.
- `src/content/executor.ts` handles `RESUME_EXECUTION` and then sends another `RESUME_EXECUTION` runtime message from `resume()`.

Impact:
- Resume may bounce between content script and service worker repeatedly.
- This can cause duplicated resume handling, noisy logs, or unstable control state.

Files:
- `src/background/service-worker.ts`
- `src/content/executor.ts`
- `src/popup/store/useFormPilotStore.ts`

### 2. Popup CAPTCHA resume does not resolve the content-script CAPTCHA promise

Severity: Critical

Evidence:
- `ResponseDetectionEngine.runSubmissionDetection()` waits on the in-page overlay callback.
- `CaptchaModal` in the popup only calls `resumeExecution()`.
- There is no bridge from popup resume back to the pending `runSubmissionDetection()` promise.

Impact:
- User can click resume in the popup, but execution may remain blocked until timeout unless the in-page overlay resume button is clicked.

Files:
- `src/content/engines/ResponseDetectionEngine.ts`
- `src/popup/components/CaptchaModal.tsx`

### 3. Page reload destroys execution without auto-resume

Severity: Critical

Evidence:
- `resetFormBetweenRows()` calls `window.location.reload()`.
- The code comment states the executor instance is destroyed and auto-resume is not implemented.

Impact:
- Multi-row runs can stop after a reload fallback.
- Crash recovery and save-and-continue are not reliable.

Files:
- `src/content/executor.ts`

### 4. Executor does not restore active execution state on content-script startup

Severity: Critical

Evidence:
- Service worker supports `GET_EXECUTION_STATE`.
- `executor.ts` constructor only registers message listeners.
- No startup path loads stored execution state and resumes `runAllRows()`.

Impact:
- Reloads, navigation, extension restarts, and content-script reinjection cannot continue active execution.

Files:
- `src/content/executor.ts`
- `src/background/service-worker.ts`

### 5. Multi-page form handling is mostly incomplete

Severity: High

Evidence:
- `NAVIGATE_NEXT` is handled as a simple click.
- `SmartWaitEngine.waitForURLChange()` exists but is not wired into `NAVIGATE_NEXT`.
- Recorder derives `pageId` only from hostname, so multiple pages on the same site collapse into one page id.

Impact:
- Wizard flows and SPA step transitions can desync.
- Recorded page metadata is not enough for robust multi-page replay.

Files:
- `src/content/engines/ExecutionEngine.ts`
- `src/content/engines/SmartWaitEngine.ts`
- `src/content/recorder.ts`

### 6. Unmapped Excel fields can replay recorded sample values

Severity: High

Evidence:
- If `step.columnName` is missing, `ExecutionEngine.resolveAndValidateValue()` uses `step.value`.
- `saveMappings()` sets `columnName` to `undefined` for unmatched mapping rows.

Impact:
- If a mapping is missed, FormPilot can submit the original recorded value for every Excel row.
- This is dangerous for real forms because incorrect user data may be submitted silently.

Files:
- `src/content/engines/ExecutionEngine.ts`
- `src/popup/store/useFormPilotStore.ts`
- `src/popup/screens/DataScreen.tsx`

### 7. File upload action is only a stub

Severity: High

Evidence:
- `Action.FILE_UPLOAD` only logs a warning.
- No blob lookup from IndexedDB.
- No `DataTransfer` injection.

Impact:
- Job application and document-upload flows cannot actually upload files.

Files:
- `src/content/engines/ExecutionEngine.ts`
- `src/types/index.ts`
- `src/storage/StorageManager.ts`

### 8. Unknown submission result is treated as success

Severity: High

Evidence:
- Row summary logs `UNKNOWN` as failed because only `SUCCESS` maps to success in the log.
- The row return value treats `SUCCESS` or `UNKNOWN` as `"SUCCESS"`.

Impact:
- Failed or ambiguous submissions can be counted as completed rows.
- Dashboard success rate can be inaccurate.

Files:
- `src/content/executor.ts`
- `src/content/engines/ResponseDetectionEngine.ts`

### 9. Radio and checkbox handling may not work reliably with controlled React/Vue forms

Severity: High

Evidence:
- Radio execution directly assigns `targetRadio.checked = true`.
- Checkbox execution directly assigns `el.checked = desiredState`.
- Text inputs use native setters, but checked-state controls do not.

Impact:
- React/Vue state may not sync with DOM state.
- Forms can visually toggle but submit stale application state.

Files:
- `src/content/engines/ExecutionEngine.ts`
- `src/content/domUtils.ts`

### 10. `form.submit()` bypasses validation and submit handlers

Severity: High

Evidence:
- `Action.SUBMIT` calls `el.submit()` when the target is a form.

Impact:
- Native validation, React submit handlers, analytics hooks, and framework-controlled submit logic can be skipped.

Files:
- `src/content/engines/ExecutionEngine.ts`

## Architecture / Flow Issues

### 11. Service worker is not router-only

Severity: Medium

Evidence:
- `agent_plan.md` says service worker should be router only and less than 100 lines.
- Current `src/background/service-worker.ts` is 279 lines and manages queues, persistence, proxy data access, notifications, badges, and routing.

Impact:
- The implementation has drifted from the architecture.
- More logic in the MV3 service worker increases lifecycle and race-condition risk.

Files:
- `agent_plan.md`
- `src/background/service-worker.ts`

### 12. StorageManager boundary is broken

Severity: Medium

Evidence:
- `agent_plan.md` says `StorageManager.ts` is the only storage entry point.
- `LogScreen.tsx` imports `getDB()` directly.

Impact:
- Storage behavior can become inconsistent.
- Retention, indexing, and future migrations become harder to enforce.

Files:
- `agent_plan.md`
- `src/popup/screens/LogScreen.tsx`
- `src/storage/db.ts`

### 13. `tabContext` is lost when execution starts

Severity: Medium

Evidence:
- Popup initializes execution state with the active tab id.
- Content `StateManager.initializeSession()` creates a new state with `tabContext: -1`.

Impact:
- CAPTCHA tab focus, multi-tab tracking, and resume routing can break.

Files:
- `src/popup/store/useFormPilotStore.ts`
- `src/content/engines/StateManager.ts`

### 14. Checkpointing is weaker than the plan describes

Severity: Medium

Evidence:
- `currentStepIndex` is only saved every `CHECKPOINT_INTERVAL`.
- `lastStepResult` exists in the type but is never updated.
- Plan says state is saved after every step.

Impact:
- Crash recovery can repeat work or resume from stale progress.
- Popup reconstruction after close/reopen is incomplete.

Files:
- `src/content/executor.ts`
- `src/types/index.ts`
- `agent_plan.md`

### 15. Large data handling is not scalable yet

Severity: Medium

Evidence:
- `getExcelData()` returns all rows.
- `setExcelData()` clears and rewrites the whole Excel store.
- Logs are loaded with `getAll()` and filtered in memory.

Impact:
- Large spreadsheets and long runs can cause slowdowns, memory pressure, and IndexedDB churn.

Files:
- `src/storage/StorageManager.ts`
- `src/content/executor.ts`
- `src/popup/screens/LogScreen.tsx`

### 16. Retention and chunking constants are unused

Severity: Medium

Evidence:
- `LOG_MAX_ENTRIES`, `LOG_RETENTION_DAYS`, and `EXCEL_CHUNK_SIZE` are defined.
- No implementation enforces retention or chunked row loading.

Impact:
- Logs can grow without cleanup.
- Excel execution is not paginated as planned.

Files:
- `src/shared/constants.ts`
- `src/storage/StorageManager.ts`
- `src/content/executor.ts`

### 17. Selector confidence threshold is unused

Severity: Medium

Evidence:
- `MIN_SELECTOR_CONFIDENCE` is defined as `0.6`.
- CSS path with confidence `0.5` and XPath with confidence `0.4` are accepted directly.

Impact:
- Low-confidence selectors may be used even when they should be rejected or treated as risky.

Files:
- `src/shared/constants.ts`
- `src/content/engines/SelectorEngine.ts`

### 18. Test suite appears stale against current implementation

Severity: Medium

Evidence:
- `StateManager.initializeSession()` returns `ExecutionStatus.RUNNING`.
- `StateManager.test.ts` expects `ExecutionStatus.IDLE`.

Impact:
- The progress claim of all tests passing may be stale.
- Current test suite may not reflect current behavior.

Files:
- `src/content/engines/StateManager.ts`
- `tests/StateManager.test.ts`
- `agent_progess.md`

## Lower Priority Issues

### 19. Production code still contains many raw console logs

Severity: Low

Impact:
- Launch polish checklist says debug logs should be removed or gated.
- Console output may expose internal data or create noise during Web Store review/testing.

Files:
- `src/background/service-worker.ts`
- `src/content/executor.ts`
- `src/content/recorder.ts`
- `src/popup/store/useFormPilotStore.ts`

### 20. `.gitignore` is too small

Severity: Low

Evidence:
- `.gitignore` only ignores `node_modules`.

Impact:
- Generated artifacts such as `dist/` can be accidentally committed.

Files:
- `.gitignore`

### 21. Documentation encoding contains mojibake

Severity: Low

Evidence:
- Several markdown files show corrupted symbols in rendered text.

Impact:
- Handoff documents are harder to read and may confuse future agents.

Files:
- `AGENTS.md`
- `agent_plan.md`
- `agent_progess.md`
- `agent_log.md`
- `agent_handoff.md`

## Suggested Fix Order

1. Fix resume message loop.
2. Implement execution auto-resume after reload/navigation.
3. Wire CAPTCHA popup resume into the content-side pending CAPTCHA flow.
4. Make `NAVIGATE_NEXT` wait for real navigation or DOM transition.
5. Block execution when required mapping steps are unmatched.
6. Replace file upload stub with real IndexedDB blob and `DataTransfer` injection.
7. Treat `UNKNOWN` submission outcome as failed or user-review-required.
8. Move all direct DB access back behind `StorageManager`.
9. Add chunked Excel reads, log indexes, and retention cleanup.
10. Re-run and repair the full test suite after the behavior changes.
