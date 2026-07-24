# FormAnchor — Privacy Policy

**Last Updated:** July 23, 2026

At FormAnchor, we believe your data belongs to you. FormAnchor is built to be a fully client-side, local-first browser extension. We do not harvest, collect, or transmit any user data, spreadsheet information, or recorded web flows to any external servers.

This Privacy Policy explains how FormAnchor handles and stores data inside your local browser environment.

---

## 1. What Data Does FormAnchor Access?

To perform its automated form-filling duties, FormAnchor accesses:
*   **Recorded Workflows (Steps):** When you explicitly use the "Record" feature, FormAnchor captures local interaction metadata (element IDs, tags, class names, CSS paths, associated labels, and action types) to replay them.
*   **Uploaded Spreadsheets:** When you upload an Excel or CSV spreadsheet, FormAnchor parses the file in-browser to extract cell values and match them to your recorded form fields.
*   **Web Form Fields:** When executing a recorded workflow, FormAnchor interacts with the fields, inputs, dropdowns, check boxes, and buttons on the target websites under your direction.

---

## 2. Where Is Your Data Stored?

All data is stored **exclusively** inside your local browser storage:
*   **IndexedDB (Local Storage):** Recorded automation steps, parsed Excel row data, and color-coded execution logs are saved to IndexedDB inside your sandbox. This database is persistent, unlimited in capacity, and private to the extension.
    *   *Encryption at Rest:* Sensitive spreadsheet rows and uploaded file blobs are encrypted at rest using AES-GCM 256-bit encryption. The cryptographic key is generated as a non-extractable CryptoKey handle and stored locally in IndexedDB, separate from the encrypted data.
    *   *Client-Side Security Limits:* Please note that client-side encryption-at-rest relies on local key storage. While this fully secures your data against casual filesystem inspection, it does not protect against an attacker who has already compromised your local operating system user profile or obtained equivalent administrative access to read your browser's extension storage context.
*   **`chrome.storage.session` (Volatile Storage):** Active execution progress, active step pointers, page-retry counts, and session mutex locks are saved here. This data is cleared as soon as the execution finishes or when the browser session ends.
*   **No Cloud Storage:** FormAnchor does not use any cloud servers, databases, or third-party storage providers.

---

## 3. How Is Your Data Shared or Transmitted?

*   **Zero Transmission:** FormAnchor has **no external backend API** and makes no network connections to send your data.
*   **No Analytics or Tracking:** We do not embed telemetry tools, Google Analytics, Mixpanel, or any tracking code.
*   **Local-Only Parsing:** Spreadsheets are parsed in memory using the open-source `SheetJS` library natively inside your browser. No files are uploaded to any server for parsing.

---

## 3.5. Chrome Web Store Limited Use Compliance

FormAnchor's use of requested permissions and accessed data complies with the Chrome Web Store [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use/) requirements:

*   **No Personally Identifiable Information (PII) Collection:** FormAnchor does not collect, store, or process PII beyond what the user explicitly provides in their uploaded spreadsheets. All such data remains local.
*   **No Sale or Transfer to Third Parties:** FormAnchor does not sell, license, or transfer any user data to third parties for any purpose, including advertising, analytics, credit assessment, or data brokerage.
*   **No Secondary Use:** All data accessed by FormAnchor is used exclusively for its single disclosed purpose — automating web form filling from spreadsheet data. Data is never repurposed for advertising, market research, or any unrelated functionality.
*   **Web Browsing Activity Disclosure:** FormAnchor accesses web browsing activity (DOM element metadata, page URLs, CSS selectors, and element attributes) **only** during user-initiated recording and execution sessions. This data is stored locally in IndexedDB and is never transmitted to any external server.
*   **Website Content Disclosure:** FormAnchor reads and interacts with website content (form field values, button labels, dropdown options) **only** to replay user-recorded fill steps. This interaction is entirely local and user-directed.

---

## 4. Required Extension Permissions

FormAnchor requests the following permissions to operate on your behalf:
*   `<all_urls>` (host permission): Required to allow FormAnchor's recorder and executor scripts to interact with form fields on target websites that you navigate to.
*   `storage`: Required to save and load recorded flows, user settings, and execution logs in local IndexedDB.
*   `scripting`: Required to inject DOM helper libraries (such as safe React-input setters) into your active tab.
*   `notifications`: Required to display desktop notifications when user attention is needed (e.g. when a CAPTCHA is detected).
*   `tabs`: Required to locate background web pages and perform same-tab URL redirection.
*   `downloads`: Required to export activity logs as JSON/CSV files directly to your downloads folder.
*   `alarms`: Required to run periodic local maintenance (clearing old logs per your retention settings, recovering stuck execution locks) while the extension is idle.

---

## 5. Data Retention & Deletion

*   **Execution Logs:** Retained locally per your configured retention settings. You may adjust retention duration in the extension's Settings screen.
*   **Recorded Workflows & Excel Data:** Stored locally in IndexedDB until you explicitly delete them from the extension's dashboard or use the "Wipe Extension Databases" function in Settings.
*   **Session-Volatile Data:** Active execution progress, step pointers, and mutex locks are stored in `chrome.storage.session` and are automatically cleared when the browser session ends or execution completes.
*   **Full Data Wipe:** At any time, you may navigate to Settings → Wipe Extension Databases to permanently delete all stored recordings, Excel data, execution logs, and session state. This action is irreversible.

---

## 6. Contact Information

If you have any questions regarding FormAnchor's local-first architecture or privacy policies, please contact Sachin Rawal at `sachinrawal473@gmail.com` or open an issue on the project home repository.
