# FormPilot — Plugins & Skills Playbook

> **Owner:** Sachin Rawal  
> **Project:** FormPilot — Production Chrome Extension  
> **Updated:** 2026-05-21  
> **Purpose:** This file is the single source of truth for all installed plugins and skills.  
> The AI agent MUST read this file to know WHEN and HOW to automatically activate each plugin or skill — no manual instruction from Sachin required.

---

## Agent Auto-Activation Rules

> These rules govern when the agent triggers each plugin or skill automatically, without waiting for Sachin to ask.

| If Sachin says or asks about... | Auto-activate this Plugin/Skill |
| :--- | :--- |
| "screenshot", "take a screenshot", "show me the UI" | `chrome-devtools-plugin` → `take_screenshot` |
| "verify UI", "check popup looks right", "does the layout look good?" | `chrome-devtools-plugin` → `take_screenshot` + `lighthouse_audit` |
| "run the form", "test the portal", "fill the form", "simulate" | `chrome-devtools-plugin` → `fill_form`, `click`, `wait_for` |
| "accessibility", "a11y", "screen reader", "ARIA", "tab order" | `chrome-devtools-plugin` → `a11y-debugging` skill |
| "performance", "slow", "INP", "interaction lag", "freezing" | `chrome-devtools-plugin` → `performance_start_trace` / `performance_analyze_insight` |
| "network request", "API call", "what's being fetched?" | `chrome-devtools-plugin` → `list_network_requests` / `get_network_request` |
| "console error", "JS error", "what's in the console?" | `chrome-devtools-plugin` → `list_console_messages` / `get_console_message` |
| "popup CSS", "modern CSS", "style the form", "animate", "hover effect" | `modern-web-guidance-plugin` |
| "dialog", "modal", "overlay", "captcha popup" | `modern-web-guidance-plugin` → `animate-to-from-top-layer`, `light-dismiss-a-dialog` |
| "validate input", "form validation", "show error only after typing" | `modern-web-guidance-plugin` → `validate-input-after-interaction`, `required-field-feedback` |
| "lighthouse", "audit", "SEO check", "performance score" | `chrome-devtools-plugin` → `lighthouse_audit` |
| "agent", "subagent", "multi-agent", "AI SDK" | `google-antigravity-sdk` skill |

---

## Plugin 1: `chrome-devtools-plugin`

> **What it does:** Provides live browser automation, debugging, performance tracing, visual screenshotting, and accessibility auditing via Chrome DevTools and Puppeteer MCP tools.

### Installed Skills
| Skill | Path | Status |
| :--- | :--- | :---: |
| `a11y-debugging` | `plugins/chrome-devtools-plugin/skills/a11y-debugging/SKILL.md` | ✅ Active |

### Full Tool Index

| Tool | What it does | When to auto-use in FormPilot |
| :--- | :--- | :--- |
| `list_pages` | List all open browser tabs/pages | Session start — verify browser is connected |
| `new_page` | Open a new browser tab | Opening `krp_portal.html` or any test form |
| `navigate_page` | Navigate to a URL | Load target form pages for testing |
| `take_screenshot` | Capture a full screenshot | Any time UI is changed — verify visually |
| `take_snapshot` | Capture DOM HTML snapshot | Inspect DOM state of React popup |
| `click` | Click a DOM element | Simulate button/link actions in test forms |
| `fill` | Fill a single input field | Fill one field by selector |
| `fill_form` | Fill multiple inputs at once | Simulate FormPilot's multi-field autofill loop |
| `type_text` | Type text character-by-character | Simulate real keystrokes for debounce testing |
| `hover` | Hover over an element | Test hover animations and tooltips |
| `select_page` | Switch between browser tabs | Multi-tab/multi-page form testing |
| `press_key` | Simulate keyboard key press | Test Tab-order, Enter, Escape key behaviors |
| `wait_for` | Wait for selector / text / event | Critical — wait for form transitions before next step |
| `handle_dialog` | Accept/dismiss JS dialogs | Handle `window.confirm()` during form submission |
| `get_console_message` | Get a specific console log | Debug output from content scripts |
| `list_console_messages` | Get all console logs | Verify no errors in recorder/executor output |
| `list_network_requests` | List all network requests | Verify API calls during form submissions |
| `get_network_request` | Inspect a specific network call | Debug payload data sent by forms |
| `evaluate_script` | Run JS in the active page | Directly query DOM or trigger extension actions |
| `lighthouse_audit` | Run Google Lighthouse audit | Audit popup UI quality — performance, a11y, SEO |
| `performance_start_trace` | Start a performance trace | Begin profiling step execution loop timing |
| `performance_stop_trace` | Stop and save performance trace | End profiling after multi-row run cycle |
| `performance_analyze_insight` | Analyze performance trace insights | Identify slow rendering or JS blocking in executor |
| `take_memory_snapshot` | Take V8 memory heap snapshot | Detect memory leaks in long execution sessions |
| `emulate` | Emulate devices/network conditions | Test popup on mobile viewport sizes |
| `resize_page` | Resize browser window | Test popup at different responsive breakpoints |
| `drag` | Drag-and-drop interaction | Test DataScreen Excel drag-and-drop upload zone |
| `upload_file` | Simulate a file upload | Upload test `.xlsx` files into DataScreen |
| `close_page` | Close browser tab | Cleanup after test runs |

---

### Skill: `a11y-debugging` — Accessibility Debugging

**Auto-activate when:** Any popup UI component is created or updated, or when Sachin asks about "accessibility", "ARIA", "screen reader", "tab order", "focus", "keyboard navigation".

#### Checklist: What to verify on every UI component

```
- [ ] All interactive elements have descriptive aria-label or aria-labelledby
- [ ] Focus order is logical (Tab key moves through controls correctly)
- [ ] Error messages are announced via aria-live regions
- [ ] Color contrast ratio meets WCAG 2.1 AA (4.5:1 for text, 3:1 for UI)
- [ ] All images have non-empty alt attributes
- [ ] Modals/dialogs trap focus correctly when open
- [ ] Form inputs have associated <label> elements
- [ ] Interactive elements are reachable by keyboard (no mouse-only traps)
```

#### How to run an accessibility audit in FormPilot
```
1. Start the local test server (if needed)
2. Use chrome-devtools-mcp → lighthouse_audit → with category "accessibility"
3. Read the audit report for violations
4. Fix each violation in the relevant .tsx component
5. Re-run the audit to confirm 0 violations
```

---

### FormPilot-Specific Automation Scripts (Agent runs these automatically)

#### 🔴 Auto-Script: Visual Popup UI Verification
> **Trigger:** Any change to popup `.tsx` or `.css` files.
```
1. take_screenshot → capture current popup state
2. Run lighthouse_audit → check performance + a11y scores
3. Report any score drops from previous baseline
```

#### 🔵 Auto-Script: Form-Filling End-to-End Test
> **Trigger:** Any change to `executor.ts`, `ExecutionEngine.ts`, or `recorder.ts`.
```
1. new_page → open krp_portal.html on localhost:8080
2. fill_form → fill all Step 1 fields
3. wait_for → wait for Step 2 to load
4. Repeat through all form steps
5. take_screenshot → capture receipt modal
6. list_console_messages → verify 0 errors in content script
```

#### 🟡 Auto-Script: Performance Profiling of Execution Loop
> **Trigger:** When Sachin mentions "slow" or "execution is taking long".
```
1. performance_start_trace
2. fill_form → run a 10-row Excel batch execution
3. performance_stop_trace
4. performance_analyze_insight → identify bottlenecks
5. Report top 3 performance hotspots
```

---

## Plugin 2: `modern-web-guidance-plugin`

> **What it does:** Injects expert-curated, production-ready modern web platform patterns (CSS, Forms, Performance, UX, Accessibility) into code generation — replacing outdated workarounds with native browser APIs.  
> **Version:** v0.0.151 | **Maintained by:** Google Chrome Team  
> **Coverage:** 99 modern browser features · 124 real-world use case guides

### Auto-Activation in FormPilot

The agent MUST apply these guidelines automatically (without being asked) when implementing the corresponding features:

---

#### 🎨 POPUP UI — React Components (`src/popup/screens/`)

| Scenario | Apply this modern web pattern |
| :--- | :--- |
| Captcha Solver Overlay (ResponseDetectionEngine) | `animate-to-from-top-layer` — Use native `<dialog>` on the Top Layer with `@starting-style` entry animations instead of custom `z-index` stacking |
| Light-dismiss Captcha modal | `light-dismiss-a-dialog` — Close on outside click via native `<dialog closedby="any">` |
| Column mapping dropdowns in DataScreen | `branded-select-styling` — Custom `<select>` picker styled with brand colors using `appearance: base-select` |
| Auto-resize text inputs in mapping UI | `form-fields-automatically-fit-contents` — `field-sizing: content` CSS property |
| Inline form validation in popup settings | `validate-input-after-interaction` — `:user-invalid` CSS pseudo-class |
| Required fields in upload form | `required-field-feedback` — Show errors only after `:user-invalid` state triggers |
| Checkbox / Radio controls (brand colors) | `brand-consistent-forms` — `accent-color: var(--brand-color)` |
| Tab switching (Home/Data/Run/Log screens) | `anchor-positioning-tab-underline` — Animate tab underline between screens |
| Popup screen transitions | `animate-element-entry-exit` — `@starting-style` + `transition-behavior: allow-discrete` |
| Loading states / skeleton screens | `defer-rendering-heavy-content` — `content-visibility: auto` |
| Progress radial in RunScreen | `animate-to-intrinsic-sizes` — Smooth expand/collapse animations |
| Notification toasts | `persistent-toast-notifications` — Native Popover API for stacking toasts |

---

#### ⚡ PERFORMANCE — Execution Engine (`src/content/engines/`)

| Scenario | Apply this modern web pattern |
| :--- | :--- |
| Parsing large Excel files (SheetJS) | `break-up-long-tasks` — Use `scheduler.yield()` to yield between row processing chunks |
| Step execution loop in ExecutionEngine | `schedule-tasks-by-priority` — Use Scheduler API to prioritize critical DOM writes |
| Background analytics logging | `batch-analytics-events` — Batch log entries with `fetchLater()` |
| Expensive DOM queries in SelectorEngine | `interactions-in-complex-layouts` — Avoid layout recalculation in scan loops |
| Pause execution when tab backgrounded | `efficient-background-processing` — Use Page Visibility API to pause step loops |

---

#### 🛡️ SECURITY & PRIVACY (`manifest.json`, `executor.ts`)

| Scenario | Apply this modern web pattern |
| :--- | :--- |
| Handling `<all_urls>` permission scope | `privacy` guide — Data minimization, third-party audit rules, permission justification |
| AbortController for timed-out steps | `AbortController and AbortSignal` — Clean cancellation of fetch and async operations |
| Partitioned data across sites | `partitioned-cookies` — Ensure no cross-site data leakage during form fill |

---

#### ♿ ACCESSIBILITY — UI Components (`src/popup/screens/`)

| Scenario | Apply this modern web pattern |
| :--- | :--- |
| Error messages in popup forms | `accessible-error-announcement` — `aria-invalid` + `aria-live` region sync |
| Focus management in modal overlays | Native `<dialog>` handles focus trapping automatically |
| Keyboard shortcuts in RunScreen | Ensure all controls reachable with Tab + Enter/Space |

---

## Plugin 3: `google-antigravity-sdk`

> **What it does:** Enables design, implementation, and orchestration of autonomous AI agents and multi-agent pipelines using the Google Antigravity Python SDK.

### Auto-Activate When:
- Sachin mentions building a "bot", "subagent", "autonomous workflow"
- Any Python-based agent integration is discussed
- Multi-agent orchestration or delegation is needed

### Key Reference Files (Agent reads these automatically when activated)

| Topic | File |
| :--- | :--- |
| Architecture Overview | `references/architecture.md` |
| Agent Configuration & Model Selection | `references/agent_configuration.md` |
| MCP Server Integration | `references/mcp_integration.md` |
| Safety & Execution Policies | `references/safety_policies.md` |
| Error Handling & Hooks | `references/error_handling.md` |
| Observability & Token Tracking | `references/observability.md` |
| Built-in Tools Reference | `references/built_in_tools.md` |

---

## How Sachin Triggers Plugins (Quick Reference)

Instead of writing detailed instructions, Sachin can use these **shorthand trigger phrases** and the agent will automatically load the right plugin + skill:

| Sachin types... | Agent does automatically |
| :--- | :--- |
| `@screenshot` | Takes a live screenshot of current browser state |
| `@audit` | Runs Lighthouse audit (performance + a11y + SEO) |
| `@fill-form` | Runs FormPilot end-to-end form-filling test on KRP portal |
| `@a11y` | Runs accessibility analysis on popup UI components |
| `@perf` | Starts a performance trace of the execution loop |
| `@console` | Dumps all console messages from content script |
| `@network` | Lists all network requests made during last action |
| `@modern-css` | Agent applies modern-web-guidance CSS patterns to current component |
| `@modernize` | Agent audits current code and replaces legacy patterns with modern web APIs |

---

## Plugin Health Status

| Plugin | Status | Last Verified |
| :--- | :---: | :---: |
| `chrome-devtools-plugin` | ✅ Active | 2026-05-21 |
| `chrome-devtools-plugin/a11y-debugging` | ✅ Active | 2026-05-21 |
| `modern-web-guidance-plugin` | ✅ Active | 2026-05-21 |
| `google-antigravity-sdk` | ✅ Active | 2026-05-21 |

---

## Agent Protocol for Using This File

Every new conversation session, the agent MUST:

1. Read this `PLUGINS_PLAYBOOK.md` as part of startup (alongside `AGENTS.md`, `agent_plan.md`, `agent_progess.md`)
2. Keep the auto-activation rules table in mind throughout the entire session
3. Apply plugin-driven patterns proactively — do NOT wait for Sachin to ask
4. After any plugin action, briefly state: `[Plugin: chrome-devtools-plugin] → took screenshot` so Sachin always knows which plugin is working
5. If a plugin tool fails, diagnose and report immediately — do NOT silently skip

---

*This file is maintained by Sachin Rawal & the Antigravity agent. Update when new plugins, skills, or trigger mappings are added.*
