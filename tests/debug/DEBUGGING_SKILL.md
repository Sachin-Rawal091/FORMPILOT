# FormPilot — Debugging & Testing Skill

> **Purpose:** Professional-grade debugging and testing protocol built from live analysis of FormPilot's actual source code.
> **Stack:** Vitest + happy-dom · TypeScript · Chrome MV3 · 6 core engines
> **Generated from:** Direct read of all engine files + test files in `D:\SACHIN RAWAL FILES\FormPilot`

---

## Triage Protocol — Follow in Order

When a test fails or a bug appears, run these steps in sequence. Never skip ahead.

### Step 1 — Reproduce in isolation
```bash
npx vitest run tests/<FailingFile>.test.ts
```
If it passes alone but fails with others → **test pollution** (state leaking between tests).
Fix: ensure `beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); })`.

### Step 2 — Check Chrome API mocks
Most common failure cause. Any test touching `StorageManager` or `StateManager` needs Chrome mocks.
```typescript
import { setupChromeMocks, resetChromeMocks } from './helpers/chromeMock';
beforeEach(() => setupChromeMocks());
afterEach(() => resetChromeMocks());
```

### Step 3 — Check happy-dom limitations
happy-dom does NOT support these — mock them:

| API | Support | Fix |
|-----|---------|-----|
| `getBoundingClientRect()` | ❌ Returns zeros | `el.getBoundingClientRect = () => ({ width: 100, height: 25 } as any)` |
| `getComputedStyle()` | ❌ No real CSS | `vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', ... } as any)` |
| `document.evaluate` (XPath) | ❌ Not supported | `vi.fn().mockReturnValue({ singleNodeValue: el })` |
| `attachShadow({ mode: 'open' })` | ✅ Works | — |
| `MutationObserver` | ✅ Works | — |
| `window.postMessage` | ✅ Works | — |

### Step 4 — Check async timing
SmartWaitEngine uses exponential backoff starting at 50ms. Timeouts under 300ms will flake.
```typescript
// Wrong — backoff needs multiple poll cycles
await SmartWaitEngine.waitForElement(meta, '', 50);

// Right — give 500ms minimum in tests
await SmartWaitEngine.waitForElement(meta, '', 500);
```

### Step 5 — Check mock cleanup
`vi.spyOn` persists across tests unless explicitly reset.
```typescript
beforeEach(() => vi.restoreAllMocks()); // REQUIRED in every describe block
```

---

## Engine Debug Guides

### SelectorEngine.ts

**Common failures and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| XPath test fails | `document.evaluate` absent in happy-dom | Mock: `document.evaluate = vi.fn().mockReturnValue({ singleNodeValue: el })` |
| Shadow DOM test fails | `attachShadow` mode is `'closed'` | Always use `mode: 'open'` — closed is inaccessible by design |
| Wrong confidence score | Strategy order changed | ID=1.0, primarySelector=0.95, Name=0.9, Aria=0.85, Label=0.8, Placeholder=0.7, CSS=0.5, XPath=0.4, Shadow=0.6 |
| Shadow DOM fires before XPath | Shadow runs after ALL 7 direct strategies | Correct. Pass empty `xpath` if you want shadow to run earlier |
| Primary selector beats ID | Raw `selector` string is tried 2nd (after ID, before name) | Pass `selector: ''` when testing ID strategy in isolation |

**Debug snippet — trace which strategy matched:**
```typescript
const result = SelectorEngine.findElement(meta, selector);
console.log('Matched:', SelectorStrategy[result?.strategy ?? -1], '| Confidence:', result?.confidence, '| Shadow:', result?.shadow);
```

---

### SmartWaitEngine.ts

**Common failures and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `waitForElementVisible` never resolves | `getBoundingClientRect` returns zeros | `el.getBoundingClientRect = () => ({ width: 100, height: 25 } as any)` |
| `waitForElementClickable` fails | `disabled` false but `pointerEvents: none` in mock | Mock: `{ display: 'block', visibility: 'visible', pointerEvents: 'auto' }` |
| `waitForURLChange` never resolves | URL unchanged in happy-dom | `Object.defineProperty(window, 'location', { value: { href: newUrl }, writable: true })` then fire `popstate` event |
| `waitForNetworkIdle` hangs | No postMessage fired | `setTimeout(() => window.postMessage({ type: 'FORMPILOT_NETWORK_IDLE' }, '*'), 50)` |
| `waitForDOMStability` times out | MutationObserver needs actual DOM change | `setTimeout(() => document.body.appendChild(document.createElement('div')), 50)` |
| Flaky timeout | Exponential backoff needs time | Always use >= 500ms timeout in tests |

**BUG in source — `waitForSelectOptions` race condition:**
Options that load DURING `waitForElement`'s polling are missed. Observer is attached AFTER options exist.
```typescript
// Fix to add after getting selectEl:
if (selectEl.options.length > 1) {
  cleanup(); resolve(true); return; // Already loaded
}
// THEN attach MutationObserver
```

---

### ExecutionEngine.ts

**Common failures and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| Wrong LogStatus returned | `hasOwnProperty` vs `in` operator difference | Current impl uses `Object.prototype.hasOwnProperty.call()` — correct |
| Date format wrong | Timezone offset in `toISOString()` | Current impl splits at `"T"` → `"2024-01-15"` — correct |
| React onChange not firing | Wrong import path for `setInputValue` | Check: `import { setInputValue } from '../domUtils'` |
| `SELECT_RADIO` silent fail | `step.value` doesn't match radio's `value` attribute exactly | Must be exact string match — no trim or case conversion |
| `TOGGLE_CHECKBOX` always checks | `step.checked` is `undefined` → defaults to `true` | Set `step.checked = false` explicitly to uncheck |
| `FILE_UPLOAD` does nothing | Phase 1 stub — expected behaviour | `executor.ts` will handle blob injection. `console.warn` logged. |
| `WAIT` uses wrong timeout | Uses `WAIT_ELEMENT_TIMEOUT` (10s) instead of `WAIT_DOM_STABLE_TIMEOUT` (3s) | **BUG** — see BUG-005 below |

**Debug snippet — log resolution table:**
```typescript
const result = ExecutionEngine.resolveAndValidateValue(step, rowData);
console.table({ column: step.columnName, value: result.value, status: result.status, skipRow: result.shouldSkipRow, skipStep: result.shouldSkipStep });
```

---

### RetryEngine.ts

**Common failures and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `retriesUsed` off by one | `attempt` increments before classification | At maxRetries=2: 3 failed attempts = `retriesUsed: 3`. Expected. |
| SKIPPABLE not returned for optional | `step.required === false` not `!step.required` | Ensure `required: false` (explicit), not `required: undefined` |
| FATAL on custom error | Error message contains word "fatal" | Classifier does substring match. Don't use "fatal" in non-fatal errors. |
| Test takes > 1s | Backoff is 100ms → 200ms per retry | Mock setTimeout for speed: `vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; })` |
| Max retry test passes instantly | SKIPPABLE exits before max retries | Add `required: true` to force RETRYABLE path |

---

### StateManager.ts

**Common failures and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `initializeSession` throws mutex error | Previous test left `mutexLock` in storage | `await StorageManager.clearExecutionState()` in `beforeEach` |
| `updateState` throws "No active session" | State never initialized | Call `initializeSession` before any `updateState` in test |
| `incrementPageRetry` wrong boolean | Returns `true` when `newCount > maxPageRetries` (not `>=`) | At cap=3: counts 1,2,3 → false; count 4 → true. Off by one from spec. Consider `>=`. |
| State resets between calls | Chrome mock using real storage (persists) | Ensure mock uses in-memory Map, not actual storage |

---

### ResponseDetectionEngine.ts

**Common failures and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `detectCaptcha()` returns false | Element uses class not ID | `el.id = 'g-recaptcha'` for `#g-recaptcha` selector |
| `detectSuccess()` misses page | URL keyword absent AND no DOM element | Add both: URL with "success" AND `.success` class element |
| `detectFailure()` false positive | `.error` class on unrelated element | `document.body.innerHTML = ''` in `beforeEach` |
| `runSubmissionDetection` never resolves | `StateManager.getState()` returns null | `vi.spyOn(StateManager, 'getState').mockResolvedValue(mockState)` |
| `chrome.runtime.sendMessage` throws | Chrome mock absent | `setupChromeMocks()` in `beforeEach` |
| Countdown timer leaks across tests | `clearInterval` not called | `ResponseDetectionEngine.removeCaptchaOverlay()` in `afterEach` |

**BUG — Memory leak on repeated CAPTCHA detection:**
`captchaTimeoutId` may still be running if `activeOverlay` is null but timeout isn't cleared.
```typescript
// Fix in removeCaptchaOverlay — always clear regardless of overlay state:
static removeCaptchaOverlay(): void {
  if (this.countdownIntervalId) { clearInterval(this.countdownIntervalId); this.countdownIntervalId = null; }
  if (this.captchaTimeoutId) { clearTimeout(this.captchaTimeoutId); this.captchaTimeoutId = null; }
  this.activeOverlay?.remove();
  this.activeOverlay = null;
}
```

---

## All Bugs Found in Source Code

### BUG-001 — SelectorEngine: Dead code in Label strategy
**File:** `SelectorEngine.ts` ~lines 29–40  
**Severity:** Low — causes no crash but wastes cycles  
**Problem:** Strategy 4 (Label-linked) checks `meta.id` for `label[for]`. But if `meta.id` exists, Strategy 1 already returned. This branch never executes.  
**Fix:** Remove ID-based label search from Strategy 4. Use `labelText` only.
```typescript
// DELETE this block from Strategy 4 (dead code):
if (meta.id) {
  const label = document.querySelector(`label[for="${meta.id}"]`);
  ...
}
// KEEP only the labelText block
```

### BUG-002 — SmartWaitEngine: Race condition in `waitForSelectOptions`
**File:** `SmartWaitEngine.ts` ~lines 170–210  
**Severity:** Medium — silently fails on fast-loading dynamic dropdowns  
**Problem:** Options that load during `waitForElement`'s polling phase are missed. MutationObserver attached after options already exist. Observer never fires.  
**Fix:** Check option count immediately after `waitForElement` resolves, before attaching observer.
```typescript
const selectEl = result.element as HTMLSelectElement;
const initialOptionsCount = selectEl.options.length;

// ADD THIS CHECK BEFORE observer:
if (selectEl.options.length > 1) {
  return true; // Already loaded — no need for observer
}
// THEN attach MutationObserver...
```

### BUG-003 — RetryEngine: `retriesUsed` inflated by 1 on SKIPPABLE
**File:** `RetryEngine.ts` ~lines 75–88  
**Severity:** Low — cosmetic, wrong count in logs  
**Problem:** `attempt++` before `classifyError`. SKIPPABLE step returns `retriesUsed: 1` even with no real retry.  
**Fix:** Return `retriesUsed: 0` for immediate SKIPPABLE classification, or classify before incrementing.

### BUG-004 — ResponseDetectionEngine: Potential timer leak
**File:** `ResponseDetectionEngine.ts` ~lines 255–270  
**Severity:** Medium — can cause unexpected timeout callbacks in tests  
**Problem:** `captchaTimeoutId` not cleared when `activeOverlay` is null.  
**Fix:** Clear both timers unconditionally in `removeCaptchaOverlay` (see fix above).

### BUG-005 — ExecutionEngine: Wrong constant for WAIT action
**File:** `ExecutionEngine.ts` ~line 115  
**Severity:** Medium — WAIT action pauses 10s instead of 3s  
**Problem:** `Action.WAIT` passes `WAIT_ELEMENT_TIMEOUT` (10,000ms) to `waitForDOMStability`. Should be `WAIT_DOM_STABLE_TIMEOUT` (3,000ms).  
**Fix:**
```typescript
// Wrong:
case Action.WAIT:
  await SmartWaitEngine.waitForDOMStability(WAIT_ELEMENT_TIMEOUT); // 10,000ms

// Correct:
case Action.WAIT:
  import { WAIT_DOM_STABLE_TIMEOUT } from '../../shared/constants';
  await SmartWaitEngine.waitForDOMStability(WAIT_DOM_STABLE_TIMEOUT); // 3,000ms
```

### BUG-006 — messages.ts is empty
**File:** `src/shared/messages.ts`  
**Severity:** High — ADR-003 requires typed message helpers here  
**Problem:** File is completely empty. `FormPilotMessage<T>` and `MessageType` are in `types/index.ts`. No send helpers exported.  
**Fix:** Populate with send helpers and re-export types:
```typescript
// src/shared/messages.ts
export { FormPilotMessage, MessageType } from '../types';

export async function sendToBackground<T>(msg: FormPilotMessage<T>): Promise<FormPilotMessage> {
  return chrome.runtime.sendMessage(msg);
}

export async function sendToContentScript<T>(tabId: number, msg: FormPilotMessage<T>): Promise<FormPilotMessage> {
  return chrome.tabs.sendMessage(tabId, msg);
}
```

---

## Test Coverage Map

| Engine | Test File | Status | Missing Tests |
|--------|-----------|--------|---------------|
| SelectorEngine | `SelectorEngine.test.ts` | ✅ 9 cases | Invalid CSS graceful fallback |
| SmartWaitEngine | `SmartWaitEngine.test.ts` | ✅ 7 cases | Disabled button clickable test |
| ExecutionEngine | `ExecutionEngine.test.ts` | ⚠️ Partial | All 13 action types; date coercion |
| RetryEngine | `RetryEngine.test.ts` | ✅ 7 cases | `MAX_PAGE_RETRIES` escalation |
| StateManager | `StateManager.test.ts` | ⚠️ Partial | `incrementPageRetry` overflow |
| ResponseDetection | `ResponseDetectionEngine.test.ts` | ⚠️ Partial | Inline error; CAPTCHA shadow DOM |
| Integration | `IntegrationFlow.test.ts` | ❓ Unknown | Full row execution flow |
| Real-world | `RealWorldMatrix.test.ts` | ❓ Unknown | Puppeteer site tests |

---

## Test Commands

```bash
# Run all tests
npx vitest run

# Run with verbose output
npx vitest run --reporter=verbose

# Run single engine
npx vitest run tests/SelectorEngine.test.ts
npx vitest run tests/SmartWaitEngine.test.ts
npx vitest run tests/ExecutionEngine.test.ts
npx vitest run tests/RetryEngine.test.ts
npx vitest run tests/StateManager.test.ts
npx vitest run tests/ResponseDetectionEngine.test.ts

# Watch mode
npx vitest

# Coverage
npx vitest run --coverage

# UI mode
npx vitest --ui
```
