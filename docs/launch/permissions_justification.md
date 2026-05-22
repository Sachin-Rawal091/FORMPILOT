# FormPilot — Chrome Web Store Review Permissions Justification

This document provides a detailed, high-fidelity justification for the requested permissions in FormPilot's manifest, specifically for the `<all_urls>` permission, tailored for the Chrome Web Store review team.

---

## 1. Technical Overview of FormPilot

FormPilot is a productivity tool that automates repetitive web-form filling tasks for business users.
*   **The User Loop:** A user opens a target webpage (which could be a SaaS CRM, a government portal, or an internal enterprise application), clicks "Record" in the extension, fills out the form once, uploads an Excel file with row data, and instructs the extension to automate filling those forms for the remaining hundreds of spreadsheet rows.
*   **Local Execution:** Because FormPilot operates as a **local-first extension**, all spreadsheet parsing (via SheetJS), recording step storage (via IndexedDB), and execution injection happen strictly inside the user's local browser environment. No user data, web content, or form values are ever sent to external cloud servers.

---

## 2. Why the `<all_urls>` Permission Is Essential

To fulfill its core value proposition, FormPilot **must** be able to execute on websites designated dynamically by the user:

1.  **Dynamic Web Target Agility:** FormPilot does not target a single, static website. It is designed to work on *any* web form the user needs to automate. Since target URLs are supplied on-the-fly by users (often entering raw URLs, internal subdomains, or private intranet links), it is impossible to pre-register host permissions in the `manifest.json`.
2.  **Multi-Page Cross-Domain Replay:** Real-world workflows frequently cross domain boundaries. For example, a user recording a registration flow might start on `portal.company-app.com`, navigate to a single-sign-on (SSO) provider on `identity-service.net`, and complete execution on `app-confirmation.org`. To execute these steps seamlessly across domain jumps without dropping active automation states, the content script and executor must be granted global matching permission.
3.  **Active Content Script Injection:** When a recorded flow is replayed, FormPilot's `executor.ts` must query the DOM, find elements using its 7-layer Selector Engine, and inject synthetic focus and change events. Chrome's scripting API requires host permission on the active tab and target frame origins to inject these automated scripts.

---

## 3. Why the `activeTab` Permission Alone Is Insufficient

While `activeTab` grants temporary access to the active webpage when the user clicks the extension icon, it does not cover FormPilot's dynamic multi-page execution lifecycle:
*   **Background Navigation Loss:** During a multi-step form replay, the tab automatically navigates, redirects, or reloads. When the URL transitions (e.g. from Page 1 to Page 2), the `activeTab` privilege is lost. The extension would instantly throw access exceptions, causing the automation queue to fail mid-run.
*   **Volatile Session Restoration:** If a session is paused waiting for a manual CAPTCHA resolution, or if a user switches tabs to copy reference text, the `activeTab` state can be revoked by Chrome, blocking the background runner from continuing.
*   **Cross-Origin Iframe Execution:** Enterprise applications heavily rely on same-origin or cross-origin iframes to embed input fields (e.g. secure payment gateways, rich-text editors). Grasping and filling these inputs requires programmatic injection across iframe frame IDs, which is blocked under strict MV3 guidelines unless the extension has host permissions matching those origins.

---

## 4. How FormPilot Adheres to the "Least Privilege" Principle

Although `<all_urls>` is a broad permission, FormPilot implements strict, defense-in-depth safety boundaries to guarantee it is not abused:

*   **100% User-Directed Triggering:** FormPilot's engines only active when the user explicitly clicks the "Record" or "Run" buttons. The extension remains completely silent and idle during normal browsing.
*   **Zero Remote Code Execution (RCE):** The extension compiles all automation logic directly into its packaged `/dist` folder. It never calls `eval()`, `new Function()`, or loads external Javascript scripts, preventing remote injection vectors.
*   **Optional Whitelist Mode:** We are building an optional "Site Whitelist" configuration in the Popup Options screen, allowing security-conscious enterprise users to restrict extension execution strictly to a custom list of domains, overriding the global host match.
*   **In-Browser SheetJS Processing:** Spreadsheets are read as binary arrays and parsed strictly within the content script sandbox. No external network requests are made to server-side excel parsers.

---

## 5. Summary of Other Requested Permissions

| Permission | Technical Need / Justification |
|------------|--------------------------------|
| `storage` | To save user settings and index recorded flows. |
| `scripting` | To inject React/Vue native event setters into the target tab's context. |
| `alarms` | To manage the 3-minute CAPTCHA-pause timer in the background. |
| `notifications` | To alert users with desktop notifications when manual input (like a CAPTCHA) is required. |
