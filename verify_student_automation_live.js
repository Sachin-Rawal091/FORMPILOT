import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\733cb1d7-8c38-4a11-aa90-067a1ea6e2ae\\screenshots';

async function run() {
  console.log('=== STARTING STUDENT PORTAL LIVE CHECKBOX VERIFICATION ===');
  console.log('Using extension path:', extensionPath);

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  let browser;
  let popupPage;
  let executionTab;

  // 1. Launch Puppeteer with extension loaded
  browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1300,950'
    ]
  });

  try {
    console.log('Waiting for extension to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Discover Extension ID
    const targets = await browser.targets();
    const bgTarget = targets.find(
      t => t.type() === 'service_worker' || t.type() === 'background_page'
    );
    if (!bgTarget) throw new Error('Failed to find extension service worker.');
    const extensionId = bgTarget.url().split('/')[2];
    console.log(`Detected Extension ID: ${extensionId}`);

    // 3. Open the extension popup
    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log(`[POPUP LOG] ${msg.text()}`));
    popupPage.on('pageerror', err => console.error(`[POPUP ERROR] ${err.message}`));
    await popupPage.setViewport({ width: 380, height: 600 });
    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;
    await popupPage.goto(popupUrl);
    console.log('Popup UI loaded.');
    await popupPage.waitForSelector('input[type="text"]');

    // 4. Inject Settings (Set stepDelay = 250ms for swift E2E execution)
    await popupPage.evaluate(() => {
      chrome.storage.local.set({
        settings: {
          stepDelay: 250,
          maxStepRetries: 3,
          waitElementTimeout: 10000,
          autoSubmit: true,
          headlessMode: false,
        }
      });
    });
    console.log('Set stepDelay to 250ms in extension settings.');

    // 5. Inject Student Portal Flow Recording
    const studentRecording = {
      id: "student-portal-flow-verif",
      name: "Student Portal Flow Verification",
      siteUrl: "http://localhost:8080/student",
      siteId: "http://localhost:8080/student",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      pageCount: 1,
      pages: [{ id: "default", urlPattern: "*://localhost:8080/student*" }],
      steps: [
        // Step 1: Student Details
        {
          id: "step-full-name",
          action: 0, // Action.FILL
          selector: "#fullName",
          selectorMeta: { id: "fullName", cssPath: "#fullName" },
          columnName: "Full Name",
          pageId: "default"
        },
        {
          id: "step-birth-date",
          action: 0, // Action.FILL
          selector: "#birthDate",
          selectorMeta: { id: "birthDate", cssPath: "#birthDate" },
          columnName: "Date of Birth",
          pageId: "default"
        },
        {
          id: "step-gender-male",
          action: 4, // Action.SELECT_RADIO
          selector: "input[name=\"gender\"][value=\"Male\"]",
          selectorMeta: { name: "gender", cssPath: "input[name=\"gender\"][value=\"Male\"]" },
          columnName: "Gender",
          pageId: "default"
        },
        {
          id: "step-gender-female",
          action: 4, // Action.SELECT_RADIO
          selector: "input[name=\"gender\"][value=\"Female\"]",
          selectorMeta: { name: "gender", cssPath: "input[name=\"gender\"][value=\"Female\"]" },
          columnName: "Gender",
          pageId: "default"
        },
        {
          id: "step-gender-other",
          action: 4, // Action.SELECT_RADIO
          selector: "input[name=\"gender\"][value=\"Other\"]",
          selectorMeta: { name: "gender", cssPath: "input[name=\"gender\"][value=\"Other\"]" },
          columnName: "Gender",
          pageId: "default"
        },
        {
          id: "step-email",
          action: 0, // Action.FILL
          selector: "#emailAddress",
          selectorMeta: { id: "emailAddress", cssPath: "#emailAddress" },
          columnName: "Email Address",
          pageId: "default"
        },
        {
          id: "step-next-1",
          action: 1, // Action.CLICK
          selector: "#btn-next",
          selectorMeta: { id: "btn-next", cssPath: "#btn-next" },
          pageId: "default"
        },
        // Step 2: Guardian Details
        {
          id: "step-guardian-name",
          action: 0, // Action.FILL
          selector: "#guardianName",
          selectorMeta: { id: "guardianName", cssPath: "#guardianName" },
          columnName: "Guardian Full Name",
          pageId: "default"
        },
        {
          id: "step-guardian-relationship",
          action: 2, // Action.SELECT
          selector: "#guardianRelationship",
          selectorMeta: { id: "guardianRelationship", cssPath: "#guardianRelationship" },
          columnName: "Relationship to Student",
          pageId: "default"
        },
        {
          id: "step-guardian-phone",
          action: 0, // Action.FILL
          selector: "#guardianPhone",
          selectorMeta: { id: "guardianPhone", cssPath: "#guardianPhone" },
          columnName: "Guardian Contact Phone",
          pageId: "default"
        },
        {
          id: "step-next-2",
          action: 1, // Action.CLICK
          selector: "#btn-next",
          selectorMeta: { id: "btn-next", cssPath: "#btn-next" },
          pageId: "default"
        },
        // Step 3: Contact
        {
          id: "step-address",
          action: 0, // Action.FILL
          selector: "#addressLine",
          selectorMeta: { id: "addressLine", cssPath: "#addressLine" },
          columnName: "Street Address",
          pageId: "default"
        },
        {
          id: "step-city",
          action: 0, // Action.FILL
          selector: "#city",
          selectorMeta: { id: "city", cssPath: "#city" },
          columnName: "City",
          pageId: "default"
        },
        {
          id: "step-state",
          action: 2, // Action.SELECT
          selector: "#stateRegion",
          selectorMeta: { id: "stateRegion", cssPath: "#stateRegion" },
          columnName: "State / Region",
          pageId: "default"
        },
        {
          id: "step-zip",
          action: 0, // Action.FILL
          selector: "#postalCode",
          selectorMeta: { id: "postalCode", cssPath: "#postalCode" },
          columnName: "Postal / ZIP Code",
          pageId: "default"
        },
        {
          id: "step-next-3",
          action: 1, // Action.CLICK
          selector: "#btn-next",
          selectorMeta: { id: "btn-next", cssPath: "#btn-next" },
          pageId: "default"
        },
        // Step 4: Academic
        {
          id: "step-prev-school",
          action: 0, // Action.FILL
          selector: "#prevSchool",
          selectorMeta: { id: "prevSchool", cssPath: "#prevSchool" },
          columnName: "Previous School Attended",
          pageId: "default"
        },
        {
          id: "step-last-grade",
          action: 2, // Action.SELECT
          selector: "#lastGrade",
          selectorMeta: { id: "lastGrade", cssPath: "#lastGrade" },
          columnName: "Last Grade Completed",
          pageId: "default"
        },
        {
          id: "step-gpa",
          action: 0, // Action.FILL
          selector: "#gpaPercentage",
          selectorMeta: { id: "gpaPercentage", cssPath: "#gpaPercentage" },
          columnName: "GPA / Percentage (%)",
          pageId: "default"
        },
        {
          id: "step-next-4",
          action: 1, // Action.CLICK
          selector: "#btn-next",
          selectorMeta: { id: "btn-next", cssPath: "#btn-next" },
          pageId: "default"
        },
        // Step 5: Program & Extracurriculars
        {
          id: "step-stream-science",
          action: 3, // Action.SELECT_RADIO
          selector: "input[name=\"academicStream\"][value=\"Science\"]",
          selectorMeta: { name: "academicStream", cssPath: "input[name=\"academicStream\"][value=\"Science\"]" },
          columnName: "Desired Academic Stream",
          pageId: "default"
        },
        {
          id: "step-stream-commerce",
          action: 3, // Action.SELECT_RADIO
          selector: "input[name=\"academicStream\"][value=\"Commerce\"]",
          selectorMeta: { name: "academicStream", cssPath: "input[name=\"academicStream\"][value=\"Commerce\"]" },
          columnName: "Desired Academic Stream",
          pageId: "default"
        },
        {
          id: "step-stream-arts",
          action: 3, // Action.SELECT_RADIO
          selector: "input[name=\"academicStream\"][value=\"Arts\"]",
          selectorMeta: { name: "academicStream", cssPath: "input[name=\"academicStream\"][value=\"Arts\"]" },
          columnName: "Desired Academic Stream",
          pageId: "default"
        },
        {
          id: "step-interest-sports",
          action: 4, // Action.TOGGLE_CHECKBOX
          selector: "input[name=\"extracurricular\"][value=\"Sports\"]",
          selectorMeta: { name: "extracurricular", cssPath: "input[name=\"extracurricular\"][value=\"Sports\"]", labelText: "Sports" },
          columnName: "Extracurricular Interests",
          pageId: "default"
        },
        {
          id: "step-interest-music",
          action: 4, // Action.TOGGLE_CHECKBOX
          selector: "input[name=\"extracurricular\"][value=\"Music\"]",
          selectorMeta: { name: "extracurricular", cssPath: "input[name=\"extracurricular\"][value=\"Music\"]", labelText: "Music" },
          columnName: "Extracurricular Interests",
          pageId: "default"
        },
        {
          id: "step-interest-arts",
          action: 4, // Action.TOGGLE_CHECKBOX
          selector: "input[name=\"extracurricular\"][value=\"Arts\"]",
          selectorMeta: { name: "extracurricular", cssPath: "input[name=\"extracurricular\"][value=\"Arts\"]", labelText: "Arts & Crafts" },
          columnName: "Extracurricular Interests",
          pageId: "default"
        },
        {
          id: "step-accommodations",
          action: 0, // Action.FILL
          selector: "#specialAccommodations",
          selectorMeta: { id: "specialAccommodations", cssPath: "#specialAccommodations" },
          columnName: "Special Accommodations",
          skipOnEmpty: true,
          pageId: "default"
        },
        {
          id: "step-next-5",
          action: 1, // Action.CLICK
          selector: "#btn-next",
          selectorMeta: { id: "btn-next", cssPath: "#btn-next" },
          pageId: "default"
        },
        // Step 6: Consent
        {
          id: "step-consent",
          action: 4, // Action.TOGGLE_CHECKBOX
          selector: "#policyConsent",
          selectorMeta: { id: "policyConsent", cssPath: "#policyConsent", labelText: "I declare that all information provided is accurate" },
          columnName: "Policy Consent",
          pageId: "default"
        },
        {
          id: "step-signature",
          action: 0, // Action.FILL
          selector: "#studentSignature",
          selectorMeta: { id: "studentSignature", cssPath: "#studentSignature" },
          columnName: "Signature",
          pageId: "default"
        },
        {
          id: "step-submit",
          action: 1, // Action.CLICK
          selector: "#btn-submit",
          selectorMeta: { id: "btn-submit", cssPath: "#btn-submit" },
          pageId: "default"
        },
        {
          id: "step-dismiss-receipt",
          action: 1, // Action.CLICK
          selector: "#btn-complete",
          selectorMeta: { id: "btn-complete", cssPath: "#btn-complete" },
          pageId: "default"
        }
      ]
    };

    await popupPage.evaluate(async (recording) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('FormPilotDB');
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['recordings'], 'readwrite');
          const store = tx.objectStore('recordings');
          const putReq = store.put(recording);
          putReq.onsuccess = () => resolve(true);
          putReq.onerror = () => reject(putReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, studentRecording);
    console.log('Successfully injected "Student Portal Flow Verification" flow into IndexedDB!');

    // Reload popup to display the newly injected flow
    // Reload popup to display the newly injected flow
    await popupPage.reload();
    await popupPage.waitForSelector('div.rounded-card');

    // 6. Navigate to /student in a separate page first so there is a valid web tab open
    executionTab = await browser.newPage();
    executionTab.on('console', msg => console.log(`[PORTAL LOG] ${msg.text()}`));
    executionTab.on('pageerror', err => console.error(`[PORTAL ERROR] ${err.message}`));
    await executionTab.setViewport({ width: 950, height: 800 });
    await executionTab.goto('http://localhost:8080/student');
    console.log('Student Portal tab loaded.');

    // 7. Select Flow and Upload Data in popup
    await popupPage.bringToFront();
    await popupPage.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div.rounded-card'));
      const ourCard = cards.find(card => card.innerText.includes('Student Portal'));
      if (ourCard) {
        const buttons = Array.from(ourCard.querySelectorAll('button'));
        const uploadBtn = buttons.find(b => b.textContent && (b.textContent.includes('Upload Data') || b.textContent.includes('Map Spreadsheet')));
        if (uploadBtn) {
          uploadBtn.click();
        } else {
          console.error('Upload Data button not found inside flow card!');
        }
      } else {
        console.error('Student Portal card not found!');
      }
    });

    await popupPage.waitForSelector('input[type="file"]');
    console.log('Mapping screen loaded.');

    // Upload excel data sheet
    const fileInput = await popupPage.$('input[type="file"]');
    await fileInput.uploadFile('d:\\SACHIN RAWAL FILES\\FormPilot\\student_sample_data.xlsx');
    console.log('student_sample_data.xlsx uploaded. Waiting for columns to load...');

    await new Promise(resolve => setTimeout(resolve, 3000));
    await popupPage.screenshot({ path: path.join(screenshotsDir, 'student_mapping_screen_preview.png') });

    // Click Run Automation
    console.log('Clicking "Confirm & Run Automation"...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => b.textContent && (b.textContent.includes('Confirm & Run Automation') || b.textContent.includes('Execute Auto-Fill Pipeline')));
      if (runBtn) runBtn.click();
    });

    console.log('Waiting for execution to begin on the student portal tab...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Monitor first 5 rows
    for (let row = 1; row <= 5; row++) {
      console.log(`Monitoring excel row ${row}...`);

      // Wait for step-5 to become active on the portal
      await executionTab.bringToFront();
      await executionTab.waitForSelector('#step-5.active', { timeout: 60000 });
      console.log(`Row ${row}: Step 5 active! Waiting 3s for values to fill...`);

      // Sleep for values to fill (7 steps * 250ms = 1750ms)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Capture screenshot of portal
      const ssPath = path.join(screenshotsDir, `student_row_${row}_checkboxes.png`);
      await executionTab.screenshot({ path: ssPath });
      console.log(`Captured portal screenshot for row ${row}: ${ssPath}`);

      if (row < 5) {
        console.log(`Waiting for row ${row} to complete and form to reset (Step 1 active)...`);
        await executionTab.waitForSelector('#step-1.active', { timeout: 60000 });
        console.log(`Row ${row} completed, form reset detected.`);
      } else {
        console.log(`Waiting for final row ${row} submission completed state...`);
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }

    console.log('=== VERIFICATION SUCCESSFULLY COMPLETED ===');

  } catch (err) {
    console.error('ERROR OCCURRED:', err);
    try {
      if (executionTab) {
        const errorPortalSS = path.join(screenshotsDir, 'error_portal_state.png');
        await executionTab.screenshot({ path: errorPortalSS });
        console.log(`Saved error portal screenshot to: ${errorPortalSS}`);
      }
      if (popupPage) {
        const errorPopupSS = path.join(screenshotsDir, 'error_popup_state.png');
        await popupPage.screenshot({ path: errorPopupSS });
        console.log(`Saved error popup screenshot to: ${errorPopupSS}`);
      }
      // Fetch and dump the execution logs
      const dbLogs = await popupPage.evaluate(async () => {
        return new Promise((resolve) => {
          const req = indexedDB.open('FormPilotDB');
          req.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('logs')) {
              resolve([]);
              return;
            }
            const tx = db.transaction(['logs'], 'readonly');
            const store = tx.objectStore('logs');
            const getReq = store.getAll();
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => resolve([]);
          };
          req.onerror = () => resolve([]);
        });
      });
      console.log('=== INDEXEDDB EXECUTION LOGS ===');
      console.log(JSON.stringify(dbLogs, null, 2));
      console.log('=================================');
    } catch (diagErr) {
      console.error('Failed to capture diagnostics:', diagErr);
    }
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
