# FormPilot — Complete Bug & Issue Report

> **Generated:** Full static analysis of all source files in D:\SACHIN RAWAL FILES\FormPilot
> **Files scanned:** executor.ts, recorder.ts, index.ts, domUtils.ts, SelectorEngine.ts,
>   SmartWaitEngine.ts, ExecutionEngine.ts, RetryEngine.ts, StateManager.ts,
>   ResponseDetectionEngine.ts, StorageManager.ts, db.ts, types/index.ts,
>   constants.ts, messages.ts, package.json
> **Total issues found:** 41

---

## SEVERITY LEGEND
- 🔴 CRITICAL — Will cause silent data corruption, crashes, or production failures
- 🟠 HIGH — Will cause wrong behavior on real sites
- 🟡 MEDIUM — Causes degraded reliability or broken edge cases
- 🟢 LOW — Code quality, maintainability, or minor logic issues

---

## 🔴 CRITICAL BUGS (9)

---

### BUG-001 — executor.ts: Auto-resume redirects to stateUrl instead of waiting for page load
**File:** `src/content/executor.ts` ~line 65–72
**Problem:**
```typescript
if (currentUrlObj.hostname === stateUrlObj.hostname) {
  window.location.href = state.currentUrl;
  return; // Will auto-resume on the new page
}
```
When the URL path doesn't match, the executor redirects using `window.location.href`. This destroys the current content script context immediately. The new page will load, but `checkAutoResume()` runs again in 500ms — BEFORE the new page DOM is stable. If the new page takes > 500ms to load, `StateManager.getState()` is called while the page is still loading, and the session is in `RUNNING` status, causing a second redirect loop.

**Fix:**
Remove the auto-redirect entirely from `checkAutoResume`. Only resume if the current URL already matches. If URL is wrong, send a message to the service worker to navigate the tab programmatically via `chrome.tabs.update`, then let the new page auto-resume.

---

### BUG-002 — executor.ts: `runAllRows` doesn't await chunk loading errors properly
**File:** `src/content/executor.ts` ~line 197–205
**Problem:**
```typescript
if (chunkRes?.error || !chunkRes?.excelRows) {
  throw new Error(chunkRes?.error || "Failed to load Excel row chunk.");
}
```
This `throw` is inside `runAllRows` which is called from `start()` inside a `try/catch`. But `runAllRows` is NOT `await`ed after `start()` reaches the loop — the outer catch in `start()` won't catch errors thrown inside `runAllRows` after the initial `await`. Any error here after chunk 1 silently kills the loop with no user notification and no mutex release.

**Fix:**
Wrap the entire body of `runAllRows` in a try/catch and call `this.handleFatalError()` explicitly on any throw.

---

### BUG-003 — executor.ts: `row.status` mutation doesn't persist immediately
**File:** `src/content/executor.ts` ~line 220–240
**Problem:**
```typescript
row.status = RowStatus.SUCCESS;
```
Then later:
```typescript
const setExcelRes = await this.safeSendMessage({ type: MessageType.SET_EXCEL_DATA, payload: { excelRows: [row], updateOnly: true }, ... });
```
The `row` object is mutated locally in the in-memory `excelRows` array (line `row.status = RowStatus.SUCCESS`), but `excelRows` is a local chunk array that gets replaced on the next chunk load. If the executor crashes between the status mutation and the `SET_EXCEL_DATA` message, the next resume will re-process already-completed rows.

**Fix:**
Send `SET_EXCEL_DATA` BEFORE marking the row as done in the loop counter update. Save the row status to IndexedDB as the authoritative source, not the local array.

---

### BUG-004 — executor.ts: `dismissSuccessUI` can click the NEXT ROW's submit button
**File:** `src/content/executor.ts` ~line 285–310
**Problem:**
```typescript
const dismissKeywords = ['complete', 'finish', 'done', 'close', 'ok', 'continue', 'dismiss', 'got it', 'next'];
for (const btn of allButtons) {
  const text = btn.textContent?.trim().toLowerCase() || '';
  if (isVisible && dismissKeywords.some(kw => text.includes(kw))) {
    btn.click();
    return true;
  }
}
```
`'next'`, `'continue'`, and `'ok'` are extremely common in active form buttons. If the form has a "Next" button visible (e.g. a multi-step form where step 1 completed and step 2 is now active), `dismissSuccessUI` will click it, advancing the form unexpectedly before the row has been fully processed.

**Fix:**
Only call `dismissSuccessUI` when `detectSuccess()` returns true. Scope the search to elements inside a detected success modal/overlay, not the entire document.

---

### BUG-005 — StorageManager.ts: `cleanupLogs` has a transaction/await mismatch
**File:** `src/storage/StorageManager.ts` ~line 95–120
**Problem:**
```typescript
const tx = db.transaction('logs', 'readwrite');
const store = tx.objectStore('logs');
const allKeys = await store.getAllKeys();
// ...
const allLogs = await store.getAll();
allLogs.sort(...);
const toDelete = allLogs.slice(LOG_MAX_ENTRIES);
for (const log of toDelete) {
  store.delete(log.id); // NOT awaited inside transaction
}
await tx.done;
```
The `store.delete(log.id)` calls inside the for-loop are NOT awaited. In IndexedDB via `idb`, deletes return Promises that must be awaited or the transaction may commit before deletes complete. This causes silent data retention (old logs never actually deleted).

**Fix:**
```typescript
await Promise.all(toDelete.map(log => store.delete(log.id)));
```

---

### BUG-006 — ResponseDetectionEngine.ts: Double timeout — countdown AND hard timeout both fire
**File:** `src/content/engines/ResponseDetectionEngine.ts` ~line 290–310
**Problem:**
```typescript
this.countdownIntervalId = setInterval(() => {
  if (remaining <= 0) {
    this.removeCaptchaOverlay();
    onTimeout(); // fires after CAPTCHA_SOLVE_TIMEOUT
  }
}, 1000);

this.captchaTimeoutId = setTimeout(() => {
  this.removeCaptchaOverlay();
  onTimeout(); // ALSO fires after CAPTCHA_SOLVE_TIMEOUT
}, CAPTCHA_SOLVE_TIMEOUT);
```
Both timers call `onTimeout()` at the same time when the countdown hits zero. `onTimeout` resolves a Promise with `"TIMEOUT"`. If both fire simultaneously, the Promise is resolved twice — the second resolution is silently ignored by JS, but `onTimeout` runs twice. In `handleCaptchaIfPresent`, `onTimeout` calls `StateManager.updateState()` twice — causing a double write to session storage and a potential state inconsistency.

**Fix:**
Remove the hard `captchaTimeoutId` timeout entirely. Let only the countdown interval handle the timeout. The countdown IS the hard timeout.

---

### BUG-007 — RetryEngine.ts: FATAL and SKIPPABLE paths don't use backoff but RETRYABLE increments attempt first
**File:** `src/content/engines/RetryEngine.ts` ~line 55–90
**Problem:**
```typescript
while (attempt <= maxRetries) {
  try {
    ...
    return { success: true, retriesUsed: attempt, ... };
  } catch (error: any) {
    attempt++;  // ← incremented BEFORE classification
    const classification = this.classifyError(error, step);
    if (classification === ErrorClassification.FATAL) {
      return { ..., retriesUsed: attempt - 1 }; // attempt - 1 to compensate
    }
    if (classification === ErrorClassification.SKIPPABLE) {
      return { ..., retriesUsed: attempt - 1 }; // same compensation
    }
    if (attempt > maxRetries) {
      return { ..., retriesUsed: attempt - 1 }; // same
    }
    await backoff...
  }
}
```
On the SUCCESSFUL path, `retriesUsed: attempt` is returned where `attempt` is the number of the successful attempt (0-indexed). This means a first-attempt success returns `retriesUsed: 0` — correct. But a success on attempt 2 returns `retriesUsed: 1` — also correct. The problem is the `- 1` compensations on failure paths are inconsistent: if `attempt` starts at 0 and is immediately incremented on first failure, then `attempt - 1 = 0`, meaning it reports 0 retries even though 1 attempt was made.

This is a logic error in the retry count reporting. Not a crash bug but causes misleading logs.

**Fix:** Move `attempt++` to AFTER classification:
```typescript
const classification = this.classifyError(error, step);
if (classification === ErrorClassification.FATAL) {
  return { ..., retriesUsed: attempt };
}
if (classification === ErrorClassification.SKIPPABLE) {
  return { ..., retriesUsed: attempt };
}
attempt++;
if (attempt > maxRetries) { ... }
```

---

### BUG-008 — executor.ts: `pageRetryCount` comparison is wrong
**File:** `src/content/executor.ts` ~line 350
**Problem:**
```typescript
if (state.pageRetryCount > MAX_PAGE_RETRIES) {
  // abort row
}
```
`MAX_PAGE_RETRIES = 3`. This condition triggers only when `pageRetryCount > 3`, i.e. at count 4. But `StateManager.incrementPageRetry` also uses `> maxPageRetries`:
```typescript
return newCount > maxPageRetries; // returns true at 4
```
Both use `>` instead of `>=`, meaning the system actually allows 4 page retries (0, 1, 2, 3, then aborts on 4) instead of the intended 3. Not a crash, but the cap is off by one from the design spec.

**Fix:** Change both to `>= MAX_PAGE_RETRIES`:
```typescript
if (state.pageRetryCount >= MAX_PAGE_RETRIES) { ... }
return newCount >= maxPageRetries;
```

---

### BUG-009 — db.ts: No indexes on `logs` store — full scans on every query
**File:** `src/storage/db.ts` ~line 15–30
**Problem:**
```typescript
if (!db.objectStoreNames.contains('logs')) {
  db.createObjectStore('logs', { keyPath: 'id' });
  // No indexes created
}
```
`StorageManager.getLogs(sessionId)` does:
```typescript
const allLogs = await db.getAll('logs');
return allLogs.filter(log => log.sessionId === sessionId);
```
With 100,000 log entries, this loads the entire logs store into memory and filters in JS. On a 10,000-row run with 50 steps each = 500,000 total entries. This will OOM the extension and freeze the browser tab.

Also `cleanupLogs` calls `store.getAll()` — same problem.

**Fix:** Add indexes during `upgrade()`:
```typescript
const logsStore = db.createObjectStore('logs', { keyPath: 'id' });
logsStore.createIndex('sessionId', 'sessionId');
logsStore.createIndex('timestamp', 'timestamp');
```
Then use `db.getAllFromIndex('logs', 'sessionId', sessionId)` in `getLogs`.
Requires bumping `DB_VERSION` to `3`.

---

## 🟠 HIGH BUGS (12)

---

### BUG-010 — executor.ts: Message listener uses `var` in switch case (TypeScript strict mode issue)
**File:** `src/content/executor.ts` ~line 98–110
**Problem:**
```typescript
case MessageType.START_EXECUTION:
  const payload = message.payload as { ... }; // 'const' inside case without braces
```
Using `const` inside a `switch` case without curly braces causes a "Lexical declaration cannot appear in a single-statement context" error in strict TypeScript. This will fail at compile time with `tsc --strict`.

**Fix:**
```typescript
case MessageType.START_EXECUTION: {
  const payload = message.payload as { recordingId: string; sessionId: string };
  this.start(payload?.recordingId, payload?.sessionId || message.sessionId, message.tabId);
  break;
}
```

---

### BUG-011 — executor.ts: `start()` is called twice on auto-resume
**File:** `src/content/executor.ts` ~line 43–80
**Problem:**
`checkAutoResume()` calls `this.start(state.recordingId, state.sessionId)`. But `setupMessageListener()` also listens for `START_EXECUTION` messages. If the popup sends `START_EXECUTION` while `checkAutoResume` is in its 500ms delay, both will call `start()`. The `isRunning` guard catches the second call, but only after the first `start()` has already acquired the mutex. The second call logs "Executor is already running" but sends no error back to the popup — the popup thinks it started a new session but actually joined an existing one.

**Fix:**
Increase `checkAutoResume` delay to 1000ms and only auto-resume if `status === RUNNING && !this.isRunning`. Also add a flag `this.autoResumeInProgress` to block incoming `START_EXECUTION` messages during auto-resume.

---

### BUG-012 — recorder.ts: labelText includes child element text in `generateSelectorMeta`
**File:** `src/content/recorder.ts` ~line 280–295
**Problem:**
```typescript
const parentLabel = el.closest("label");
if (parentLabel) {
  meta.labelText = parentLabel.textContent?.trim();
}
```
`parentLabel.textContent` includes ALL descendant text — including the input's own value and any tooltips/icons inside the label. For example, a label containing `<span>Email</span><input><span class="tooltip">Required</span>` would give `labelText = "EmailRequired"`. This creates a selector that will never match.

**Fix:**
```typescript
// Get only direct text nodes, not descendant text
meta.labelText = Array.from(parentLabel.childNodes)
  .filter(n => n.nodeType === Node.TEXT_NODE)
  .map(n => n.textContent?.trim())
  .filter(Boolean)
  .join(' ')
  .trim();
```

---

### BUG-013 — recorder.ts: XPath generation produces wrong index (off-by-one)
**File:** `src/content/recorder.ts` ~line 305–325
**Problem:**
```typescript
while (sibling) {
  if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
    index++;
  }
  sibling = sibling.previousSibling;
}
const pathIndex = index > 0 ? `[${index + 1}]` : "";
```
This counts previous siblings of the same type. If `index = 0` (no previous siblings), no index is appended. If `index = 1` (one previous sibling), it appends `[2]`. This is correct XPath indexing. BUT: it doesn't check if there are ANY next siblings of the same type before omitting the index. If an element is the ONLY sibling of its type, no index is appended (correct). But if it's the FIRST of multiple siblings, it should be `[1]`, not no-index. Without `[1]`, XPath returns the first match, which is correct — but is semantically ambiguous.

This is a minor issue but can produce unstable XPaths on certain DOM structures.

**Fix:** Always include the index if there are any siblings of the same type:
```typescript
const hasSiblings = !!current.parentElement?.querySelector(
  `:scope > ${current.nodeName.toLowerCase()}:nth-of-type(2)`
);
const pathIndex = (index > 0 || hasSiblings) ? `[${index + 1}]` : "";
```

---

### BUG-014 — ExecutionEngine.ts: `SELECT_RADIO` searches document-wide, not form-scoped
**File:** `src/content/engines/ExecutionEngine.ts` ~line 105–118
**Problem:**
```typescript
const nameAttr = el.getAttribute("name");
const radios = Array.from(document.querySelectorAll(
  `input[type="radio"][name="${nameAttr}"]`
)) as HTMLInputElement[];
const targetRadio = radios.find(r => r.value === resolvedValue);
```
If a page has two forms with radio groups of the same `name` attribute (common in SPA wizards where form sections are stacked in DOM), this will find radios from the wrong form. It also doesn't escape `nameAttr` before using it in a CSS selector — if `nameAttr` contains `"` or special characters, this throws.

**Fix:**
```typescript
const nameAttr = el.getAttribute("name");
if (!nameAttr || !resolvedValue) return;

// Search within closest form or fieldset, fallback to document
const scope = el.closest('form, fieldset') || document;
const radios = Array.from(
  scope.querySelectorAll(`input[type="radio"][name="${CSS.escape(nameAttr)}"]`)
) as HTMLInputElement[];
```

---

### BUG-015 — ExecutionEngine.ts: `waitForSelectOptions` called with wrong arguments after SELECT
**File:** `src/content/engines/ExecutionEngine.ts` ~line 95–101
**Problem:**
```typescript
case Action.SELECT:
  if (el instanceof HTMLSelectElement) {
    setSelectValue(el, resolvedValue || "");
    await SmartWaitEngine.waitForSelectOptions(
      step.selectorMeta, step.selector, WAIT_ELEMENT_TIMEOUT
    ).catch(() => {});
  }
```
`waitForSelectOptions` in `SmartWaitEngine` calls `waitForElement` internally, which will RE-FIND the select element from scratch. This is correct. But `WAIT_ELEMENT_TIMEOUT = 10,000ms` is used — this is the element-finding timeout, not the options-loading timeout. The correct constant is `WAIT_DOM_STABLE_TIMEOUT = 3,000ms` or a dedicated options-wait timeout. Using 10s here means SELECT actions can block execution for 10 seconds waiting for options that will never come.

**Fix:**
```typescript
await SmartWaitEngine.waitForSelectOptions(
  step.selectorMeta, step.selector, WAIT_DOM_STABLE_TIMEOUT
).catch(() => {});
```

---

### BUG-016 — SmartWaitEngine.ts: `waitForURLChange` resolves `false` on timeout, not throws
**File:** `src/content/engines/SmartWaitEngine.ts` ~line 115–140
**Problem:**
```typescript
timeoutTimer = setTimeout(() => {
  cleanup();
  resolve(false); // ← resolves false, not rejects
}, timeout);
```
`waitForURLChange` returns `Promise<boolean>`. But `pollForCondition` returns `Promise<T>` and `rejects` on timeout. These are inconsistent. Callers in executor.ts use `await SmartWaitEngine.waitForDOMStability(...)` with `.catch(() => {})` — they expect throws on timeout, not `false` returns. Any code that `await`s `waitForURLChange` and doesn't check the boolean return will silently proceed as if navigation succeeded.

**Fix:** Make the API consistent — either throw on timeout (preferred) or document that `false` means timeout and check at every callsite.

---

### BUG-017 — ResponseDetectionEngine.ts: CAPTCHA shadow DOM search always runs even after CSS match
**File:** `src/content/engines/ResponseDetectionEngine.ts` ~line 25–50
**Problem:**
```typescript
for (const selector of captchaSelectors) {
  if (document.querySelector(selector)) {
    return true; // ← returns early, correct
  }
}

// Shadow DOM traversal always runs if no direct match found
let shadowFound = false;
// ...
traverseShadow(document);
return shadowFound;
```
This is actually correct — shadow DOM only runs if no direct match. But `traverseShadow` checks `el.matches(selector)` against ALL 11 CAPTCHA selectors for EVERY element up to 200 elements deep. With 11 selectors × 200 elements = 2,200 `matches()` calls on every page action. `detectCaptcha()` is called inside the step loop before every step. This is a performance bottleneck.

**Fix:** Cache the CAPTCHA selectors array outside the traversal closure and break out of both loops immediately on first match (already done for the outer loop, but the inner `for` loop over selectors doesn't break the outer element loop):
```typescript
for (const selector of captchaSelectors) {
  if (el.matches && el.matches(selector)) {
    shadowFound = true;
    return; // exits traverseShadow entirely
  }
}
```
This is already done — the `return` exits `traverseShadow`. But the `checkedCount > 200` check only runs at the TOP of the loop, not in the inner `for` loop, so between the `checkedCount` check and the `return`, up to 11 extra checks run. Minor but worth fixing.

---

### BUG-018 — recorder.ts: Cross-origin iframe detection logic is inverted
**File:** `src/content/recorder.ts` ~line 155–170
**Problem:**
```typescript
if (window !== window.top) {
  try {
    if (window.parent.location.href) {
      // Access succeeds, same-origin → falls through (no action)
    }
  } catch (err) {
    this.addRecordedStep(Action.MANUAL_IFRAME, el, "");
    return; // cross-origin → records MANUAL_IFRAME
  }
}
```
The logic is:
- If we're in a frame AND accessing `window.parent.location.href` THROWS → cross-origin → record MANUAL_IFRAME → correct.
- If we're in a frame AND it doesn't throw → same-origin → fall through and record normal CLICK → correct.

BUT: this check runs on EVERY click inside the recorder, even when not in any frame. `window !== window.top` is always false when the content script runs at the top level. So this code only activates when the content script is injected into an iframe — which only happens with same-origin iframes (since the content script can't be injected cross-origin anyway). The cross-origin MANUAL_IFRAME path is therefore unreachable in practice.

**Fix:** Remove this iframe check from the recorder entirely for the click handler. Instead, detect iframe presence during recording by checking if the clicked element's `ownerDocument` differs from the top `document`.

---

### BUG-019 — executor.ts: `safeSendMessage` resolves instead of rejects on timeout
**File:** `src/content/executor.ts` ~line 115–140
**Problem:**
```typescript
const timer = setTimeout(() => {
  if (!resolved) {
    resolved = true;
    resolve({ error: "TIMEOUT", timeout: true }); // resolves, doesn't reject
  }
}, timeoutMs);
```
When `safeSendMessage` times out, it resolves with `{ error: "TIMEOUT" }` instead of rejecting. All callers then check `if (chunkRes?.error)`. But some callsites use `await this.safeSendMessage(...)` without checking the return value (e.g. log entry sending). This is actually intentional for non-critical calls. But for critical calls like `GET_RECORDING_DATA` and `GET_EXCEL_DATA`, the timeout silently causes wrong behavior. The check `countRes?.count === undefined` catches it, but `countRes.count === 0` would also throw even for a valid 0-row dataset.

**Fix:**
```typescript
if (countRes?.error || countRes?.count === undefined) {
  // Don't also check === 0 — valid if dataset is empty
}
```

---

### BUG-020 — package.json: `xlsx` package is the wrong package name for SheetJS
**File:** `package.json` line 18
**Problem:**
```json
"xlsx": "^0.18.5"
```
The SheetJS community edition is `xlsx` on npm, but version `0.18.5` is outdated (released 2022). SheetJS switched to a paid model for newer versions — `0.18.5` is the last free version on npm but has known issues with `.xlsx` files using newer Office formats (`.xlsx` created in Excel 365 with rich formatting, merged cells, or pivot tables).

Additionally, if this package is imported anywhere as `import * as XLSX from 'xlsx'` and used in the content script or storage layer, it adds ~500KB to the bundle.

**Fix:** Keep `0.18.5` for now but import only in the popup (not content scripts). Consider `exceljs` as an alternative for better Office format support. Also verify `xlsx` is not imported in any content script file.

---

### BUG-021 — executor.ts: `resetFormBetweenRows` uses `window.location.reload()` as last resort
**File:** `src/content/executor.ts` ~line 272–280
**Problem:**
```typescript
console.log("[Executor] Already at start URL, forcing reload as last resort.");
window.location.reload();
await new Promise(r => setTimeout(r, 10000)); // Safety net
```
`window.location.reload()` destroys the current content script context, including the Executor instance and all its state. The 10,000ms `setTimeout` after it is dead code — it will never execute because the page is being reloaded. The auto-resume logic SHOULD pick up — but only if `StateManager` correctly persisted the state before the reload. If state wasn't persisted (e.g. the `updateState` call before this line failed), the session is lost.

**Fix:** Before any navigation or reload, explicitly call `StateManager.updateState({ currentRowIndex: rowIdx + 1 })` to mark the current row as done. Then navigate. Remove the dead `setTimeout(10000)`.

---

## 🟡 MEDIUM BUGS (13)

---

### BUG-022 — db.ts: `DB_VERSION = 2` but no `version 1 → 2` migration
**File:** `src/storage/db.ts` ~line 4
**Problem:**
```typescript
const DB_VERSION = 2;
upgrade(db) {
  if (!db.objectStoreNames.contains('recordings')) {
    db.createObjectStore('recordings', { keyPath: 'id' });
  }
  // ...
}
```
The `upgrade` function uses `if (!db.objectStoreNames.contains(...))` guards. This works for fresh installs. But for users who already have DB version 1 (without the `files` or `sessions` stores), upgrading to version 2 will call `upgrade(db, oldVersion=1, newVersion=2)`. The guards correctly handle this. HOWEVER, if the version was already at 2 and someone changes schema, the `if !contains` guards prevent the new store from being added on existing installs. The correct pattern is to check `oldVersion` in the upgrade function.

**Fix:**
```typescript
upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('recordings', { keyPath: 'id' });
    db.createObjectStore('excelData', { keyPath: 'rowIndex' });
    db.createObjectStore('logs', { keyPath: 'id' });
    db.createObjectStore('sessions', { keyPath: 'sessionId' });
  }
  if (oldVersion < 2) {
    db.createObjectStore('files', { keyPath: 'alias' });
  }
  // Future: if (oldVersion < 3) { ... }
}
```

---

### BUG-023 — StorageManager.ts: `getExcelData` loads ALL rows for paginated reads
**File:** `src/storage/StorageManager.ts` ~line 55–65
**Problem:**
```typescript
async getExcelData(offset?: number, limit?: number): Promise<ExcelRow[]> {
  if (offset !== undefined && limit !== undefined) {
    const allRows = await store.getAll(); // ← loads ALL rows first
    return allRows.slice(offset, offset + limit);
  }
}
```
Pagination is implemented by loading ALL rows then slicing. A 10,000 row Excel file means loading 10,000 objects from IndexedDB into memory every time 50 rows are needed. This completely defeats the purpose of chunked loading in `executor.ts`.

**Fix:** Use IDBCursor for true offset/limit pagination:
```typescript
const rows: ExcelRow[] = [];
let cursor = await store.openCursor();
let skipped = 0;
while (cursor) {
  if (skipped < offset) { skipped++; cursor = await cursor.continue(); continue; }
  rows.push(cursor.value);
  if (rows.length >= limit) break;
  cursor = await cursor.continue();
}
return rows;
```

---

### BUG-024 — recorder.ts: `handleClickEvent` filters out text inputs, missing `search` and `date` types
**File:** `src/content/recorder.ts` ~line 128–145
**Problem:**
```typescript
if (
  (tagName === "input" && (typeAttr === "checkbox" || typeAttr === "radio" || typeAttr === "file" ||
    typeAttr === "text" || typeAttr === "email" || typeAttr === "password" || typeAttr === "number" ||
    typeAttr === "tel" || typeAttr === "url")) ||
  tagName === "select" || tagName === "textarea"
) {
  return; // handled by change or input events
}
```
Missing from the filter: `typeAttr === "search"`, `typeAttr === "date"`, `typeAttr === "time"`, `typeAttr === "datetime-local"`, `typeAttr === "month"`, `typeAttr === "week"`, `typeAttr === "color"`, `typeAttr === "range"`.

Clicking a `date` input will record a CLICK action AND a CHANGE action — duplicating the step.

**Fix:** Add all missing input types OR simplify to:
```typescript
const isInputLike = tagName === 'input' || tagName === 'select' || tagName === 'textarea';
if (isInputLike) return;
```

---

### BUG-025 — executor.ts: `POST_SUBMIT_SETTLE_MS = 1500` is hardcoded wait
**File:** `src/content/executor.ts` ~line 432
**Problem:**
```typescript
await new Promise(r => setTimeout(r, POST_SUBMIT_SETTLE_MS));
const finalOutcome = await ResponseDetectionEngine.runSubmissionDetection(...);
```
`POST_SUBMIT_SETTLE_MS = 1500ms`. This is a fixed delay. Fast sites will waste 1.5s per row. AJAX-heavy sites that redirect after 3-5 seconds will always report `UNKNOWN` because detection runs too early.

**Fix:** Replace with `waitForNetworkIdle()` or `waitForDOMStability()` — or at minimum add a `waitForURLChange` with a short timeout as the primary signal, fallback to the fixed delay.

---

### BUG-026 — constants.ts: `POST_ROW_DELAY_MS = 2500` adds 2.5s between every row
**File:** `src/shared/constants.ts` line 29
**Problem:**
For a 1,000-row run: 2,500ms × 1,000 rows = 2,500 seconds = 41 minutes of pure waiting added to execution time. This is excessive for forms that reset instantly. For KRP-style portals this may be needed, but it should be adaptive, not fixed.

**Fix:** Make `POST_ROW_DELAY_MS` configurable per site in `SiteConfig` and default to 500ms. Only increase for sites that demonstrably need it.

---

### BUG-027 — SelectorEngine.ts: `findInShadowDOM` re-checks the root document
**File:** `src/content/engines/SelectorEngine.ts` ~line 88–115
**Problem:**
```typescript
const traverse = (root: Document | ShadowRoot) => {
  const allElements = root.querySelectorAll("*");
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    // Try primarySelector
    if (primarySelector) {
      if (el.matches && el.matches(primarySelector)) { foundElement = el; return; }
    }
    // Try ID
    if (meta.id && el.id === meta.id) { foundElement = el; return; }
    // ...
    if (el.shadowRoot) { traverse(el.shadowRoot); }
  }
};
traverse(document); // ← starts at document
```
`traverse(document)` iterates ALL elements in the entire document plus all shadow roots. But the direct document strategies (ID, name, CSS, etc.) have already been tried and failed. Re-checking `el.id === meta.id` and `el.matches(primarySelector)` for EVERY element in the document is redundant — these were already checked in strategies 1–7. Shadow DOM traversal should only check INSIDE shadow roots, not re-scan the regular DOM.

**Fix:** Pass the shadow root only, not the document:
```typescript
const traverse = (root: ShadowRoot) => { ... };

// Only traverse shadow roots of top-level elements
for (const el of document.querySelectorAll('*')) {
  if (el.shadowRoot) traverse(el.shadowRoot);
}
```

---

### BUG-028 — ExecutionEngine.ts: `DATEPICKER` action just clicks and sets raw value
**File:** `src/content/engines/ExecutionEngine.ts` ~line 133–140
**Problem:**
```typescript
case Action.DATEPICKER:
  dispatchEvents(el, ["mousedown", "mouseup", "click"]);
  if (resolvedValue) {
    setInputValue(el as HTMLInputElement, resolvedValue);
  }
  break;
```
This clicks the date picker opener, then immediately sets the value on the opener element. Custom date pickers (flatpickr, MUI, Ant Design) don't accept `setInputValue` on the trigger button — they have their own hidden input. The value is set and lost. The calendar is opened but no date is selected.

This is a stub that will silently fail on every custom date picker. It needs a proper implementation or a clear "NOT IMPLEMENTED" warning that pauses execution.

**Fix (short term):** Log a `WARN` status and pause execution with a user prompt:
```typescript
case Action.DATEPICKER:
  console.warn('[FormPilot] DATEPICKER action is not fully implemented. Manual interaction required.');
  // Pause + notify user via CAPTCHA-style overlay
  break;
```

---

### BUG-029 — domUtils.ts: `dispatchEvents` fires `blur` after every fill — breaks multi-field validation
**File:** `src/content/domUtils.ts` ~lines 40–50
**Problem:**
```typescript
dispatchEvents(input, ["input", "change", "blur"]);
```
Dispatching `blur` after every `setInputValue` call triggers field-level validation on every field immediately after filling it. Many forms with "required field" validation show errors as soon as a field is blurred without navigating away. This causes premature validation errors in the log, making `detectInlineError` report false positives on every filled field.

**Fix:** Remove `"blur"` from the default event dispatch in `setInputValue` and `setTextareaValue`. Only fire `blur` on the LAST field before a form submission or on `SUBMIT` action.

---

### BUG-030 — recorder.ts: `generateCssPath` includes `:nth-of-type` even for unique elements
**File:** `src/content/recorder.ts` ~line 255–278
**Problem:**
```typescript
if (nth > 1 || current.nextElementSibling) {
  selector += `:nth-of-type(${nth})`;
}
```
This adds `:nth-of-type(1)` to elements that have a next sibling of any type. An `<input>` inside a `<div>` that has any following sibling (like a `<span>` for error messages) gets `input:nth-of-type(1)` appended unnecessarily. This makes CSS paths longer and more fragile than needed.

**Fix:**
```typescript
const sameSiblings = current.parentElement
  ? Array.from(current.parentElement.children)
      .filter(c => c.nodeName === current.nodeName)
  : [];
if (sameSiblings.length > 1) {
  selector += `:nth-of-type(${nth})`;
}
```

---

### BUG-031 — executor.ts: `broadcastStateUpdate` swallows errors silently
**File:** `src/content/executor.ts` ~line 490
**Problem:**
```typescript
private broadcastStateUpdate(state: ExecutionState) {
  chrome.runtime.sendMessage({ ... }).catch(() => {
    // Catch error when popup is closed (no listener)
  });
}
```
`.catch(() => {})` silently swallows ALL errors including real ones (extension context invalidated, service worker dead, etc.). If the service worker dies mid-execution, all subsequent `broadcastStateUpdate` calls fail silently, and the popup's progress bar freezes. The user has no way to know the extension is still running.

**Fix:** Log the error at minimum:
```typescript
.catch((err) => {
  if (!err?.message?.includes('Could not establish connection')) {
    console.warn('[Executor] broadcastStateUpdate failed:', err?.message);
  }
});
```

---

### BUG-032 — StateManager.ts: `updateState` adds `currentUrl` on every call including COMPLETE
**File:** `src/content/engines/StateManager.ts` ~line 52–60
**Problem:**
```typescript
const updatedState = {
  ...currentState,
  ...updates,
  currentUrl: window.location.href // Added on EVERY update
};
```
When `completeExecution` calls `StateManager.updateState({ status: ExecutionStatus.COMPLETE, mutexLock: null })`, the final state written to session storage includes `currentUrl: window.location.href` — which may be the success/confirmation page URL, not the original form URL. On a crash-resume, `checkAutoResume` compares `state.currentUrl` to `window.location.href`. If the session completed on a confirmation page, any future visit to that confirmation page would trigger a spurious auto-resume attempt.

**Fix:** Only update `currentUrl` on `RUNNING` status updates, not on COMPLETE/FAILED/PAUSED.

---

### BUG-033 — recorder.ts: Debounce timers stored in a `Map` but never fully cleared
**File:** `src/content/recorder.ts` ~line 166–180
**Problem:**
```typescript
private debounceTimers: Map<HTMLElement, ReturnType<typeof setTimeout>> = new Map();
```
Timers are deleted after firing (`this.debounceTimers.delete(el)`). But if recording is stopped (`isRecording = false`) while a debounce timer is pending, the timer still fires and calls `addRecordedStep` — recording a step AFTER recording was supposed to stop.

**Fix:** On `STOP_RECORDING`, clear all pending debounce timers:
```typescript
case MessageType.STOP_RECORDING:
  this.isRecording = false;
  this.debounceTimers.forEach(timer => clearTimeout(timer));
  this.debounceTimers.clear();
  break;
```

---

### BUG-034 — executor.ts: `checkAutoResume` runs on every page load including non-form pages
**File:** `src/content/executor.ts` ~line 35–80
**Problem:**
The content script is injected on ALL URLs (`<all_urls>` in manifest). `checkAutoResume` runs on EVERY page load — including Google, YouTube, banking sites, etc. On every page load, it calls `StateManager.getState()` (which calls `chrome.storage.session.get`) regardless of whether FormPilot is active. This is a minor performance issue but also a potential privacy concern — the extension reads session storage on every page visit.

**Fix:** Add an early guard using the manifest's `matches` pattern or check the page URL against the stored `siteUrl` before proceeding:
```typescript
const storedSiteUrl = state?.siteUrl;
if (storedSiteUrl) {
  const storedHost = new URL(storedSiteUrl).hostname;
  if (!window.location.hostname.includes(storedHost)) return;
}
```

---

## 🟢 LOW / CODE QUALITY (7)

---

### BUG-035 — messages.ts: `sendToBackground` and `sendToContentScript` return `any`
**File:** `src/shared/messages.ts`
**Problem:** Both helper functions return `Promise<any>`. This defeats the purpose of the typed message bus — callers get no type safety on responses.
**Fix:** Return `Promise<FormPilotMessage>` or a generic `Promise<FormPilotMessage<R>>`.

---

### BUG-036 — types/index.ts: `StepOptions` is empty
**File:** `src/types/index.ts` ~line 20
**Problem:** `interface StepOptions {}` is an empty placeholder. `Step.options?: StepOptions` is never used anywhere in the codebase. Dead code.
**Fix:** Remove or populate with actual options (timeout override, custom wait strategy, etc.).

---

### BUG-037 — types/index.ts: `LogEntry` has both `strategy?: string` and `selectorStrategy?: SelectorStrategy`
**File:** `src/types/index.ts` ~line 100–115
**Problem:** Two fields for the same concept. `strategy` is a string, `selectorStrategy` is the enum. The codebase uses `strategy: res.selectorStrategy.toString()` in executor.ts — converting enum to string and storing in the string field. The typed `selectorStrategy` field is never written.
**Fix:** Remove `strategy?: string` and use only `selectorStrategy?: SelectorStrategy`.

---

### BUG-038 — constants.ts: `DOM_STABILITY_WINDOW = 500` is never imported or used
**File:** `src/shared/constants.ts` line 26
**Problem:** `DOM_STABILITY_WINDOW = 500` is defined but never imported in any engine. `WAIT_DOM_STABILITY_SILENCE = 300` is the one actually used. Dead constant.
**Fix:** Remove `DOM_STABILITY_WINDOW` or rename it to replace `WAIT_DOM_STABILITY_SILENCE` for clarity.

---

### BUG-039 — recorder.ts: `restoreRecordingState` fires on every page load
**File:** `src/content/recorder.ts` ~line 42–68
**Problem:** `restoreRecordingState()` sends a `GET_STATUS` message on every single page load. If the service worker is asleep (MV3 idle timeout), this wakes it up unnecessarily on every page navigation. For a user not using FormPilot, this adds latency to every page load.
**Fix:** Only call `restoreRecordingState` if there's a badge or indicator that recording was in progress — or gate it on a lightweight `chrome.storage.session.get('recordingState')` check first.

---

### BUG-040 — executor.ts: `generateUUID` uses `Math.random()` — not cryptographically secure
**File:** `src/content/executor.ts` ~line 505
**Problem:** `Math.random()` is not cryptographically secure. UUID collisions are extremely unlikely but not impossible for session IDs used as mutex locks.
**Fix:**
```typescript
private generateUUID(): string {
  return crypto.randomUUID(); // Available in Chrome 92+ content scripts
}
```

---

### BUG-041 — package.json: `typescript: "^6.0.3"` doesn't exist
**File:** `package.json` devDependencies
**Problem:** TypeScript's latest stable version as of 2025 is 5.x. Version `^6.0.3` does not exist on npm. This will fail `npm install` with a "No matching version" error on a clean install.
**Fix:**
```json
"typescript": "^5.8.3"
```

---

## SUMMARY TABLE

| ID | Severity | File | Issue |
|----|----------|------|-------|
| BUG-001 | 🔴 Critical | executor.ts | Auto-resume redirect loop |
| BUG-002 | 🔴 Critical | executor.ts | runAllRows errors not caught |
| BUG-003 | 🔴 Critical | executor.ts | Row status mutated before persisted |
| BUG-004 | 🔴 Critical | executor.ts | dismissSuccessUI clicks active form buttons |
| BUG-005 | 🔴 Critical | StorageManager.ts | cleanupLogs deletes not awaited |
| BUG-006 | 🔴 Critical | ResponseDetectionEngine.ts | Double timeout on CAPTCHA |
| BUG-007 | 🔴 Critical | RetryEngine.ts | attempt++ before classification — wrong retriesUsed |
| BUG-008 | 🔴 Critical | executor.ts | pageRetryCount off by one (uses > not >=) |
| BUG-009 | 🔴 Critical | db.ts | No indexes on logs — OOM on large datasets |
| BUG-010 | 🟠 High | executor.ts | const in switch case — compile error |
| BUG-011 | 🟠 High | executor.ts | start() called twice on auto-resume |
| BUG-012 | 🟠 High | recorder.ts | labelText includes child element text |
| BUG-013 | 🟠 High | recorder.ts | XPath index off by one |
| BUG-014 | 🟠 High | ExecutionEngine.ts | SELECT_RADIO searches document-wide, no CSS.escape |
| BUG-015 | 🟠 High | ExecutionEngine.ts | waitForSelectOptions uses wrong timeout constant |
| BUG-016 | 🟠 High | SmartWaitEngine.ts | waitForURLChange returns false instead of throws |
| BUG-017 | 🟠 High | ResponseDetectionEngine.ts | CAPTCHA shadow search performance |
| BUG-018 | 🟠 High | recorder.ts | Cross-origin iframe detection unreachable |
| BUG-019 | 🟠 High | executor.ts | safeSendMessage timeout check for count === 0 |
| BUG-020 | 🟠 High | package.json | xlsx 0.18.5 outdated / format issues |
| BUG-021 | 🟠 High | executor.ts | window.location.reload() dead setTimeout |
| BUG-022 | 🟡 Medium | db.ts | No oldVersion migration pattern |
| BUG-023 | 🟡 Medium | StorageManager.ts | Fake pagination loads all rows |
| BUG-024 | 🟡 Medium | recorder.ts | Click filter missing date/search/color input types |
| BUG-025 | 🟡 Medium | executor.ts | Fixed POST_SUBMIT_SETTLE_MS too short/long |
| BUG-026 | 🟡 Medium | constants.ts | POST_ROW_DELAY_MS adds 41min to 1000-row run |
| BUG-027 | 🟡 Medium | SelectorEngine.ts | findInShadowDOM rescans regular DOM |
| BUG-028 | 🟡 Medium | ExecutionEngine.ts | DATEPICKER action stub silently fails |
| BUG-029 | 🟡 Medium | domUtils.ts | blur after every fill causes false validation errors |
| BUG-030 | 🟡 Medium | recorder.ts | CSS path adds nth-of-type unnecessarily |
| BUG-031 | 🟡 Medium | executor.ts | broadcastStateUpdate swallows all errors |
| BUG-032 | 🟡 Medium | StateManager.ts | currentUrl written on COMPLETE — bad auto-resume |
| BUG-033 | 🟡 Medium | recorder.ts | Debounce timers fire after recording stopped |
| BUG-034 | 🟡 Medium | executor.ts | checkAutoResume runs on all pages |
| BUG-035 | 🟢 Low | messages.ts | sendToBackground returns any |
| BUG-036 | 🟢 Low | types/index.ts | StepOptions empty/unused |
| BUG-037 | 🟢 Low | types/index.ts | Duplicate strategy fields in LogEntry |
| BUG-038 | 🟢 Low | constants.ts | DOM_STABILITY_WINDOW unused |
| BUG-039 | 🟢 Low | recorder.ts | restoreRecordingState fires on every page |
| BUG-040 | 🟢 Low | executor.ts | Math.random() for UUID |
| BUG-041 | 🟢 Low | package.json | TypeScript 6.0.3 doesn't exist |

---

## PRIORITY FIX ORDER FOR AI AGENT

Fix in this exact sequence:

```
1. BUG-041 — Fix package.json typescript version → allows npm install
2. BUG-010 — Fix const in switch case → allows TypeScript compilation
3. BUG-009 — Add db.ts indexes → prevents OOM on any real run
4. BUG-005 — Fix cleanupLogs awaits → fixes silent log retention
5. BUG-006 — Fix double CAPTCHA timeout → fixes state corruption
6. BUG-003 — Fix row status persistence order → fixes resume accuracy
7. BUG-004 — Fix dismissSuccessUI scope → prevents clicking wrong buttons
8. BUG-008 — Fix pageRetryCount comparison → correct retry cap
9. BUG-007 — Fix attempt++ position → correct log counts
10. BUG-023 — Fix fake pagination → prevents OOM on large datasets
11. BUG-033 — Fix debounce timer cleanup → prevents post-stop recording
12. BUG-029 — Remove blur from fill events → prevents false validation errors
13. BUG-014 — Fix SELECT_RADIO scope + CSS.escape → prevents wrong radio selection
14. BUG-015 — Fix waitForSelectOptions timeout constant → prevents 10s waits
15. BUG-022 — Fix db upgrade pattern → safe for existing users
```
