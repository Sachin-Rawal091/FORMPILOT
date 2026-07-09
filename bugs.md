# FormPilot — Full Project Audit Report

> Generated: 2026-07-09 | Auditor: OpenCode (DeepSeek)
> Mode: Independent evidence-grounded audit of entire codebase (~8,768 LOC across 50+ source files)
> Status: READ-ONLY AUDIT — findings only, no implementation

---

## Executive Summary

This is a comprehensive, independent audit of the FormPilot codebase. The prior session (2026-07-09 Antigravity/Gemini 2.5 Pro) fixed 8 of the 13 bugs from the previous audit (BUG-104, BUG-105, BUG-106, BUG-109, BUG-111, BUG-113 are FIXED; BUG-101 partially fixed with readback checks). This audit re-verifies all prior claims against live source.

**Overall risk**: LOW for current E2E flows (verified 10/10 row success in Puppeteer tests), but HIGH for edge cases — specifically unbounded IndexedDB growth under heavy sustained use, silent CLICK failures, and zero unit-test coverage on critical orchestrator paths (Executor._runAllRowsImpl, DataHandler, RecordingQueueHandler). These gaps would block reliable monitoring in production.

---

## Key to Fields

- **ID:** C-XXX (CRITICAL), H-XXX (HIGH), M-XXX (MEDIUM), L-XXX (LOW), I-XXX (INFO)
- **File:** Primary file + line reference
- **Evidence:** Quoted code, test output, or reproduction steps
- **Confidence:** CONFIRMED (verified via code + test/trace) vs. SUSPECTED (needs live verification)
- **Status:** OPEN / FIXED / WONTFIX

---

## CRITICAL

### C-01: Readback verification absent on CLICK/SUBMIT/NAVIGATE_NEXT/SCROLL — silent-failure pattern persists

| Field | Value |
|-------|-------|
| **Files** | `src/content/engines/ExecutionEngine.ts:160-167` (CLICK), `:169-176` (NAVIGATE_NEXT), `:329-343` (SUBMIT), `:324-327` (SCROLL) |
| **Severity** | CRITICAL |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:**

The 2026-07-09 fix added readback checks for value actions (FILL, SELECT, SELECT_RADIO, TOGGLE_CHECKBOX, FILE_UPLOAD, RICH_TEXT). But the following still have **zero post-execution DOM verification**:

**CLICK** (line 160-167):
```typescript
case Action.CLICK:
  dispatchEvents(el, ["mousedown", "mouseup", "click"]);
  if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
    await new Promise(r => setTimeout(r, 300));
  }
  break;
```
Dispatches events, waits 300ms for buttons. Never verifies navigation, modal-open, section-toggle, or any DOM state change occurred. If the click was swallowed by a detached node, a React handler that failed to fire, or an element hidden behind an overlay, the activity log reports SUCCESS regardless.

**NAVIGATE_NEXT** (line 169-176):
```typescript
case Action.NAVIGATE_NEXT:
  const currentURL = window.location.href;
  dispatchEvents(el, ["mousedown", "mouseup", "click"]);
  await SmartWaitEngine.waitForURLChange(currentURL, WAIT_URL_CHANGE_TIMEOUT)
    .catch((err) => {
      logger.warn('ExecutionEngine', `NAVIGATE_NEXT URL change timed out or failed: ${err.message}. Proceeding anyway.`);
    });
  break;
```
If URL change times out, the `.catch` logs a **warn** and continues — does **not** throw. RetryEngine sees a successful void return and reports `success: true`. A navigation that silently fails (SPA router rejected the click, form validation blocked navigation) is swallowed.

**SUBMIT** (line 329-343):
```typescript
case Action.SUBMIT:
  if (el instanceof HTMLFormElement) {
    const submitBtn = el.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) { dispatchEvents(submitBtn, ["mousedown", "mouseup", "click"]); }
    else { el.submit(); }
  } else { dispatchEvents(el, ["mousedown", "mouseup", "click"]); }
  break;
```
No verification. If the form was invalid (native HTML5 validation blocked the submit), no error is thrown. No `waitForURLChange` or `waitForDOMStability` await.

**SCROLL** (line 324-327):
```typescript
case Action.SCROLL:
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  await new Promise(r => setTimeout(r, 500));
  break;
```
No `getBoundingClientRect` check to verify element is actually in viewport. If the element is hidden or `scrollIntoView` was blocked, return is still `void`.

**Fix direction:**
- CLICK/SUBMIT: await `waitForURLChange(currentURL, WAIT_URL_CHANGE_TIMEOUT)` — throw on timeout. For non-navigation clicks, verify a measurable DOM state change within a short timeout.
- NAVIGATE_NEXT: throw on URL-change timeout instead of logging warn + continuing.
- SCROLL: verify `el.getBoundingClientRect()` intersects viewport; throw if not.

---

### C-02: `cleanupLogs()` retention policy not enforced — pre-cutoff entries survive after overLimit reached

| Field | Value |
|-------|-------|
| **File** | `src/storage/StorageManager.ts:194-230` |
| **Severity** | CRITICAL |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:**

The algorithm iterates entries in timestamp-ascending order. For each entry, deletes if `log.timestamp < cutoffTime || deletedCount < overLimit`. Once `deletedCount >= overLimit`, the `break` fires for the next entry newer than cutoff — even if more pre-cutoff entries remain.

```typescript
while (cursor) {
  const log = cursor.value;
  const shouldDelete = log.timestamp < cutoffTime || deletedCount < overLimit;
  if (shouldDelete) {
    await cursor.delete();
    deletedCount++;
    cursor = await cursor.continue();
  } else {
    break;  // <-- stops here, even if more pre-cutoff entries exist
  }
}
```

**Example:** 150k entries, `maxEntries=100k`, `overLimit=50k`. Oldest 80k are pre-cutoff. Loop deletes first 50k (all pre-cutoff, `deletedCount=50k`). Entry 50,001 is pre-cutoff too but `break` fires. Result: 30k entries older than retention period survive.

**NB:** The DB is bounded by `maxEntries` (doesn't grow unbounded), but the `LOG_RETENTION_DAYS` policy is silently violated.

**Fix direction:** Replace with two-pass algorithm:
1. Pass 1: delete oldest `Math.max(0, totalCount - maxEntries)` entries regardless of age
2. Pass 2: delete any remaining entries with `timestamp < cutoffTime`

---

## HIGH

### H-01: `Executor._runAllRowsImpl()` has 0 unit test coverage

| Field | Value |
|-------|-------|
| **File** | `src/content/executor.ts:393-512` |
| **Severity** | HIGH |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:** The test coverage analysis confirms `_runAllRowsImpl` is only exercised through E2E tests that mock storage and service worker at the `safeSendMessage` level. The following critical branches are untested:
- Chunk misalignment recovery (line 419-424)
- Already-completed row skipping with counter reconciliation (line 432-451)
- Per-row RowStatus persistence to IndexedDB (line 481-491)
- Form reset fallback to URL navigation (line 577-598)
- Entire `dismissSuccessUI()` strategy tree (line 621-697)

**Fix direction:** Create `Executor.test.ts` with 15+ unit tests mocking `safeSendMessage`, `StateManager`, `SmartWaitEngine`, and `SelectorEngine`, exercising each code branch in `_runAllRowsImpl` and `executeRow`.

---

### H-02: `DataHandler` and `RecordingQueueHandler` have zero test coverage

| Field | Value |
|-------|-------|
| **File** | `src/background/handlers/DataHandler.ts` (all 5 methods), `src/background/handlers/RecordingQueueHandler.ts` (all methods) |
| **Severity** | HIGH |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:** Both files are service worker modules handling data persistence (Excel rows, log entries, execution state, recording queue persistence). Zero imports or calls from any test file. Any regression would silently corrupt stored data.

**Fix direction:** Create `DataHandler.test.ts` testing all 5 message handlers. Create `RecordingQueueHandler.test.ts` testing queue persistence, deduplication, and restore.

---

### H-03: GenericDatePickerAdapter heuristic false-positive on non-calendar numeric grids

| Field | Value |
|-------|-------|
| **File** | `src/content/datepickers/adapters/GenericDatePickerAdapter.ts:245-263` |
| **Severity** | HIGH |
| **Confidence** | SUSPECTED |
| **Status** | OPEN |

**Evidence (code):** `findCalendarPopup()` structural heuristic scans all visible elements for ≥20 text-content numbers in range 1-31. A pricing table with 25 rows of `$1–$31`, a seating chart with numbered cells, or a scheduling grid of time slots would all match.

```typescript
// Structural heuristic: any visible element containing at least 20 numbers from 1 to 31
const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
for (const el of all) {
  if (this.isElementVisible(el)) {
    const numbers = Array.from(el.querySelectorAll("*")).filter((child) => {
      const text = this.normalizeNumbers(child.textContent?.trim() || "");
      const num = Number(text);
      return !isNaN(num) && num >= 1 && num <= 31 && text.length <= 2;
    });
    if (numbers.length >= 20) return el;
  }
}
```

The `selectDay` filter uses size (< 80px) and class-name (`/day|date|cell/i`) guards that are not specific enough to reject non-calendar tables.

**Fix direction:** Add three additional structural filters:
1. Must contain visible prev/next navigation buttons
2. Must contain visible month/year header text
3. Day cells should be arranged in approximately 7-column grid (detectable via bounding rect clustering)

---

### H-04: `StateManager.updateState()` has TOCTOU race between get and set

| Field | Value |
|-------|-------|
| **File** | `src/content/engines/StateManager.ts:92-113` |
| **Severity** | HIGH |
| **Confidence** | SUSPECTED |
| **Status** | OPEN |

**Evidence (trace):**
```typescript
const currentState = await StorageManager.getExecutionState();  // yield point
// ... construct updatedState ...
await StorageManager.setExecutionState(updatedState);           // yield point
```
Between the two `await` calls, the JS event loop can process other messages. The service worker's `tabs.onRemoved` listener (`service-worker.ts:275-313`) can call `StorageManager.setExecutionState()` to mark FAILED. If the content script's `updateState` wins the race, the state reverts to RUNNING, overriding tab-closed detection.

**Fix direction:** Add a version field to ExecutionState. The SW `tabs.onRemoved` handler should only set FAILED if `status === RUNNING || status === PAUSED`.

---

## MEDIUM

### M-01: XPath index inflation adds `[1]` on all same-type siblings

| Field | Value |
|-------|-------|
| **File** | `src/content/recorder.ts:539` |
| **Severity** | MEDIUM |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:**
```typescript
const pathIndex = (index > 0 || hasSameTypeSiblings) ? `[${index + 1}]` : "";
```
Every element with same-type siblings gets `[1]` even as first child. Produces unnecessarily verbose XPaths like `//div[1]/div[1]/div[1]/form[1]/input[1]`.

**Fix:** Only add index when `index > 0`.

---

### M-02: No encryption at rest for PII in IndexedDB

| Field | Value |
|-------|-------|
| **File** | `src/storage/db.ts` (all object stores) |
| **Severity** | MEDIUM |
| **Confidence** | CONFIRMED |
| **Status** | OPEN (documented limitation) |

**Evidence:** All five IndexedDB stores (`recordings`, `excelData`, `logs`, `sessions`, `files`) store data in plaintext. Progress log states: "Removed false 'ENCRYPTED AT REST' label." Document as known limitation in Chrome Web Store privacy policy.

---

### M-03: DB version pinning — cross-version contention risk on upgrade

| Field | Value |
|-------|-------|
| **File** | `src/storage/db.ts:4` |
| **Severity** | MEDIUM |
| **Confidence** | SUSPECTED |
| **Status** | OPEN |

**Evidence:** `const DB_VERSION = 5` — always connects with version 5. When upgraded to version 6, open tabs running old version get `onversionchange` events and their `openDB` calls fail with `VersionError`.

**Fix:** Add version-specific suffix to DB name (e.g., `FormPilotDB_v5`) or handle `onblocked`/`onversionchange` gracefully.

---

### M-04: CSP `unsafe-inline` could be stripped by CRXJS dev mode

| Field | Value |
|-------|-------|
| **File** | `public/manifest.json:14` |
| **Severity** | MEDIUM |
| **Confidence** | SUSPECTED |
| **Status** | OPEN |

**Evidence:** CSP includes `style-src 'self' 'unsafe-inline'` (required for Tailwind). Project history notes CRXJS dev mode has previously stripped CSP. If build output loses the header, Web Store review could reject.

**Fix:** Add build-time validation checking `dist/manifest.json` CSP matches source baseline.

---

### M-05: Executor message listener does not `await` async handlers

| Field | Value |
|-------|-------|
| **File** | `src/content/executor.ts:136-174` |
| **Severity** | MEDIUM |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:**
```typescript
case MessageType.ABORT_EXECUTION:
  this.abort();  // async function, return value discarded
  break;
```
`abort()` is async and not awaited. If it throws, rejection is unhandled. Same pattern at lines 149-150 (`this.pause()`), 167-168 (`this.abort()`).

**Fix:** Add `.catch()` to un-awaited async calls:
```typescript
this.abort().catch(err => logger.error('Executor', 'abort failed:', err));
```

---

## LOW

### L-01: `detectElementDateFormat` iterates all date inputs on page — performance concern

| Field | Value |
|-------|-------|
| **File** | `src/content/engines/ExecutionEngine.ts:667` |
| **Severity** | LOW |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:** On every FILL that looks like a date input, iterates ALL `.rmdp-input`, `.datepicker`, `.flatpickr-input`, `input[type="date"]` on the page to find a format sample. On forms with 100+ date inputs, this is O(n) per FILL.

**Fix:** Limit search to 20 sibling inputs, or cache the detected format per field.

---

### L-02: `generateXPath` uses hardcoded depth limit of 5

| Field | Value |
|-------|-------|
| **File** | `src/content/recorder.ts:506` |
| **Severity** | LOW |
| **Confidence** | CONFIRMED |
| **Status** | OPEN |

**Evidence:** `while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5)` — deeply nested elements without nearby ID'd ancestors produce ambiguous relative XPaths.

**Fix:** Extract as a constant (`XPATH_MAX_DEPTH`) and raise default to 10.

---

## INFO

### I-01: `isInsideDatePicker` uses substring match for `overlay` — possible false positive

| Field | Value |
|-------|-------|
| **File** | `src/content/recorder.ts:241` |
| **Severity** | INFO |
| **Confidence** | CONFIRMED |
| **Status** | WONTFIX |

**Evidence:** Regex `/...|backdrop|overlay/i` matches `overlay-scrollbar` or `feedback-overlay-container` as datepicker elements. Low risk — only prevents CLICK recording on these elements.

---

### I-02: recorder.ts only checks HTML `required` attribute, not other validation constraints

| Field | Value |
|-------|-------|
| **File** | `src/content/recorder.ts:359` |
| **Severity** | INFO |
| **Confidence** | CONFIRMED |
| **Status** | WONTFIX |

**Evidence:** Records `required: (el as any).required === true || el.hasAttribute('required')`. Doesn't capture `pattern`, `minlength`, `maxlength`, `min`, `max`, `step`, `type="email"` constraints. Execution engine doesn't validate these either.

---

## Already Fixed / Out of Scope

The following items from prior audits were investigated and found resolved or correct:

| Finding | Status | Evidence |
|---------|--------|----------|
| BUG-104 (sendToContentScript no error handling) | FIXED | `src/shared/messages.ts:27-37` — wrapped in try-catch |
| BUG-105 (RMDP test fixture broken) | FIXED | Test fixture wraps input in `.rmdp-container` |
| BUG-106 (CAPTCHA shadow limit hardcoded 200) | FIXED | `ResponseDetectionEngine.ts:59` — uses `SHADOW_TRAVERSAL_LIMIT` |
| BUG-109 (isElementInteractable depth) | FIXED | `RetryEngine.ts:232` — checks `depth < 20` |
| BUG-111 (console.log vs console.debug) | FIXED | `logger.ts:34` — uses `console.debug()` |
| BUG-113 (orphaned detectAdapter.ts) | FIXED | File deleted 2026-07-09 |
| BUG-101 value-action readbacks | PARTIAL | FILL/SELECT/RADIO/CHECKBOX/FILE_UPLOAD/RICH_TEXT done; CLICK/NAVIGATE_NEXT/SUBMIT/SCROLL still absent |
| Executor auto-resume loop | SAFE | sessionStorage key prevents redirect loop |
| Service worker self-healing injection | SAFE | Correctly handles missing content scripts |
| Mutex locking for concurrent runs | SAFE | Checked before start() and in initializeSession |
| Pause-aware polling | SAFE | SmartWaitEngine freezes timeouts during pause |
| DB schema upgrade path | SAFE | All migrations idempotent |
| Manifest permissions | JUSTIFIED | All 7 permissions used by at least one code path |
| SelectorEngine 8-layer fallback | SAFE | All strategies implemented, MIN_SELECTOR_CONFIDENCE=0.4 |
| Shadow DOM traversal | SAFE | Bounded by SHADOW_TRAVERSAL_LIMIT=500 |
| Dashboard redesign regressions | SAFE | No z-index/overlay/focus-trapping regressions |
| service-worker.ts missing tabId on control msgs | FIXED | Resolved 2026-06-23 with `lastActiveWebTabId` fallback + active tab query |
| executor.ts PAUSE/RESUME race with storage sync | FIXED | Direct storage writes on click + chrome.storage.onChanged listener |

---

## Test Coverage Gap Summary

| Item | Coverage | Tests Needed |
|------|----------|-------------|
| `Executor._runAllRowsImpl` | ZERO | 15+ unit tests |
| `DataHandler` (all 5 methods) | ZERO | 5 unit tests |
| `RecordingQueueHandler` (all methods) | ZERO | 10 unit tests |
| `Action.DATEPICKER` in `executeAction` | ZERO | 1 unit test |
| `Action.MANUAL_IFRAME` in `executeAction` | ZERO | 1 unit test |
| `Action.WAIT` in `executeAction` | ZERO | 1 unit test |
| `messages.ts` (sendToBackground, sendToContentScript) | ZERO | 2 unit tests |
| `sanitize.ts` (sanitizeTextValue, sanitizeLogText direct) | THIN | 4 unit tests |
| `RetryEngine.classifyError` | THIN | Private, tested indirectly via 9 tests |
| `RetryEngine.isElementInteractable` | THIN | Private, only 1 test exercises |
| `SmartWaitEngine.waitForNetworkIdle` ceiling timer path | THIN | 1 test, only postMessage path |
| `RmdpAdapter` individual methods | THIN | Only E2E via `DatePickerEngine.fill()` |
| `GenericDatePickerAdapter` individual methods | THIN | Only E2E via `DatePickerEngine.fill()` |

**Total: 10 test files, 114 tests, 6 ZERO-coverage items, 9 THIN-coverage items**

---

## Prioritized Fix Plan

### Cluster 1: Silent CLICK/SUBMIT Fixes (effort: small, risk: high)
1. C-01 CLICK/NAVIGATE_NEXT/SUBMIT/SCROLL readback verification + throws
2. M-05 async unhandled rejection guards
3. E2E: verify with Puppeteer

### Cluster 2: IndexedDB Retention Fix (effort: small, risk: medium)
1. C-02 cleanupLogs two-pass algorithm
2. M-03 DB version suffix for cross-version safety

### Cluster 3: GenericDatePickerAdapter Hardening (effort: medium, risk: low)
1. H-03 structural calendar validation (month/year header + nav button checks)
2. L-01 limit sibling date input scanning

### Cluster 4: Test Coverage Gap Closure (effort: large, risk: low)
1. H-01 Executor.test.ts — 15+ unit tests
2. H-02 DataHandler.test.ts + RecordingQueueHandler.test.ts

### Cluster 5: Production Readiness Polish (effort: small, risk: low)
1. M-01 XPath index inflation fix
2. M-04 CSP build-time validation
3. H-04 TOCTOU race guard in SW tabs.onRemoved

**Do not implement without explicit approval.**
