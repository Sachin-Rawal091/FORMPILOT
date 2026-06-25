# FormPilot — Privacy Policy

**Last Updated:** May 21, 2026

At FormPilot, we believe your data belongs to you. FormPilot is built to be a fully client-side, local-first browser extension. We do not harvest, collect, or transmit any user data, spreadsheet information, or recorded web flows to any external servers.

This Privacy Policy explains how FormPilot handles and stores data inside your local browser environment.

---

## 1. What Data Does FormPilot Access?

To perform its automated form-filling duties, FormPilot accesses:
*   **Recorded Workflows (Steps):** When you explicitly use the "Record" feature, FormPilot captures local interaction metadata (element IDs, tags, class names, CSS paths, associated labels, and action types) to replay them.
*   **Uploaded Spreadsheets:** When you upload an Excel or CSV spreadsheet, FormPilot parses the file in-browser to extract cell values and match them to your recorded form fields.
*   **Web Form Fields:** When executing a recorded workflow, FormPilot interacts with the fields, inputs, dropdowns, check boxes, and buttons on the target websites under your direction.

---

## 2. Where Is Your Data Stored?

All data is stored **exclusively** inside your local browser storage:
*   **IndexedDB (Local Storage):** Recorded automation steps, parsed Excel row data, and color-coded execution logs are saved to IndexedDB inside your sandbox. This database is persistent, unlimited in capacity, and private to the extension.
*   **`chrome.storage.session` (Volatile Storage):** Active execution progress, active step pointers, page-retry counts, and session mutex locks are saved here. This data is cleared as soon as the execution finishes or when the browser session ends.
*   **No Cloud Storage:** FormPilot does not use any cloud servers, databases, or third-party storage providers.

---

## 3. How Is Your Data Shared or Transmitted?

*   **Zero Transmission:** FormPilot has **no external backend API** and makes no network connections to send your data.
*   **No Analytics or Tracking:** We do not embed telemetry tools, Google Analytics, Mixpanel, or any tracking code.
*   **Local-Only Parsing:** Spreadsheets are parsed in memory using the open-source `SheetJS` library natively inside your browser. No files are uploaded to any server for parsing.

---

## 4. Required Extension Permissions

FormPilot requests the following permissions to operate on your behalf:
*   `activeTab` & `<all_urls>`: Required to allow FormPilot's recorder and executor scripts to interact with form fields on target websites that you navigate to.
*   `storage`: Required to save and load recorded flows, user settings, and execution logs in local IndexedDB.
*   `scripting`: Required to inject DOM helper libraries (such as safe React-input setters) into your active tab.
*   `notifications`: Required to display desktop notifications when user attention is needed (e.g. when a CAPTCHA is detected).
*   `tabs`: Required to locate background web pages and perform same-tab URL redirection.

---

## 5. Contact Information

If you have any questions regarding FormPilot's local-first architecture or privacy policies, please contact Sachin Rawal at `sachin.rawal.files@gmail.com` or open an issue on the project home repository.
