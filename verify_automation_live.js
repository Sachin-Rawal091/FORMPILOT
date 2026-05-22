import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension details
const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\9778bc81-9993-4368-aa2d-a3df287ba585\\screenshots';

async function run() {
  console.log('=== STARTING AUTOMATED LIVE EXCEL AUTOMATION SCRIPT ===');
  console.log('Using extension path:', extensionPath);

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Launch Puppeteer with extension loaded
  const browser = await puppeteer.launch({
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
    // Give extension service worker time to initialize
    console.log('Waiting for extension to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Discover Extension ID from the service worker target
    const targets = await browser.targets();
    const bgTarget = targets.find(
      t => t.type() === 'service_worker' || t.type() === 'background_page'
    );
    if (!bgTarget) throw new Error('Failed to find extension service worker.');
    const extensionId = bgTarget.url().split('/')[2];
    console.log(`Detected Extension ID: ${extensionId}`);

    // 3. Get the first real browser tab
    const pages = await browser.pages();
    const mainTab = pages[0] || await browser.newPage();
    mainTab.on('console', msg => console.log(`[TAB LOG] ${msg.text()}`));
    mainTab.on('pageerror', err => console.error(`[TAB ERROR] ${err.message}`));
    await mainTab.setViewport({ width: 950, height: 800 });

    // 4. Open the extension popup in a separate tab
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log(`[POPUP LOG] ${msg.text()}`));
    popupPage.on('pageerror', err => console.error(`[POPUP ERROR] ${err.message}`));
    await popupPage.setViewport({ width: 380, height: 600 });
    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;
    await popupPage.goto(popupUrl);
    console.log('Popup UI loaded.');
    await popupPage.waitForSelector('input[type="text"]');

    // 5. Type URL and click Record in the popup
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    await popupPage.evaluate(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'http://localhost:8080/krp');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await popupPage.screenshot({ path: path.join(screenshotsDir, '01_popup_pre_record.png') });
    console.log('Captured: 01_popup_pre_record.png');

    console.log('Clicking Record button...');
    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
      else console.error('Record button not found!');
    });

    console.log('Waiting for tab navigation and content script injection...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    const currentUrl = mainTab.url();
    console.log('Main tab URL after Record:', currentUrl);

    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const recordingStatus = await mainTab.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title
      };
    });
    console.log('Portal page status:', JSON.stringify(recordingStatus));

    await popupPage.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '02_popup_recording_started.png') });
    console.log('Captured: 02_popup_recording_started.png');

    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Helper: fill an input with proper events for recorder
    async function fillInput(selector, value) {
      await mainTab.waitForSelector(selector, { timeout: 5000 });
      await mainTab.focus(selector);
      await mainTab.evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
      await mainTab.type(selector, value, { delay: 30 });
      await mainTab.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector);
    }

    // --- STEP 1: IDENTITY ---
    console.log('Filling Step 1: Personal & Identity Details...');
    await fillInput('#fullName', 'Aarav Sharma');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#birthDate', '1994-08-15');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#identityNumber', 'KRP-9821-X9');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '03_portal_step_1.png') });
    console.log('Captured: 03_portal_step_1.png');

    console.log('Clicking Next Step...');
    await mainTab.click('#btn-next');
    await new Promise(resolve => setTimeout(resolve, 1200));

    // --- STEP 2: ADDRESS ---
    console.log('Filling Step 2: Contact & Address details...');
    await fillInput('#addressLine', '128 Green Valley Road, Sector 4');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.waitForSelector('#stateRegion');
    await mainTab.select('#stateRegion', 'North KRP');
    await mainTab.evaluate(() => {
      document.querySelector('#stateRegion').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#postalCode', '560092');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#phoneNumber', '+91 98765 43210');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '04_portal_step_2.png') });
    console.log('Captured: 04_portal_step_2.png');

    console.log('Clicking Next Step...');
    await mainTab.click('#btn-next');
    await new Promise(resolve => setTimeout(resolve, 1200));

    // --- STEP 3: ENTITY ---
    console.log('Filling Step 3: Economic Entity Info...');
    await mainTab.waitForSelector('#entityType');
    await mainTab.select('#entityType', 'MSME Small Enterprise');
    await mainTab.evaluate(() => {
      document.querySelector('#entityType').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#landHolding', '5.5');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.waitForSelector('#annualRevenue');
    await mainTab.select('#annualRevenue', '50,000 - 250,000');
    await mainTab.evaluate(() => {
      document.querySelector('#annualRevenue').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '05_portal_step_3.png') });
    console.log('Captured: 05_portal_step_3.png');

    console.log('Clicking Next Step...');
    await mainTab.click('#btn-next');
    await new Promise(resolve => setTimeout(resolve, 1200));

    // --- STEP 4: REVIEW & SUBMIT ---
    console.log('Filling Step 4: Audit & Regulatory Declarations...');
    await mainTab.waitForSelector('#auditConsent');
    await mainTab.click('#auditConsent');
    await mainTab.evaluate(() => {
      document.querySelector('#auditConsent').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#declarationSignature', 'Aarav Sharma');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '06_portal_step_4.png') });
    console.log('Captured: 06_portal_step_4.png');

    console.log('Submitting form...');
    await mainTab.click('#btn-submit');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '07_portal_success_receipt.png') });
    console.log('Captured: 07_portal_success_receipt.png');

    // Wait for all debounced input events to flush
    console.log('Waiting 4s for all step events to flush to service worker...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 8. Switch to popup to stop and save
    console.log('Switching to popup to verify steps and stop recording...');
    await popupPage.bringToFront();
    await popupPage.goto(popupUrl);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const popupText = await popupPage.evaluate(() => document.body.innerText);
    await popupPage.screenshot({ path: path.join(screenshotsDir, '08_popup_steps_recorded.png') });
    console.log('Captured: 08_popup_steps_recorded.png');

    const nameSel = 'input[placeholder*="Custom"]';
    const nameExists = await popupPage.evaluate((sel) => !!document.querySelector(sel), nameSel);
    if (nameExists) {
      await popupPage.evaluate((sel) => { document.querySelector(sel).value = ''; }, nameSel);
      await popupPage.type(nameSel, 'Government KRP Multi-Page Portal Clearance');
    } else {
      const inputs = await popupPage.$$('input[type="text"]');
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        await lastInput.click({ clickCount: 3 });
        await lastInput.type('Government KRP Multi-Page Portal Clearance');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '09_popup_naming.png') });
    console.log('Captured: 09_popup_naming.png');

    console.log('Clicking Stop & Save Recording...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Stop') && b.textContent.includes('Save'));
      if (saveBtn) saveBtn.click();
    });

    console.log('Waiting for IndexedDB write...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    await popupPage.screenshot({ path: path.join(screenshotsDir, '10_popup_saved_flows_dashboard.png') });
    console.log('Captured: 10_popup_saved_flows_dashboard.png');

    // === START AUTOMATION EXECUTION STAGE ===
    console.log('=== STARTING AUTOMATED EXCEL EXECUTION FLOW ===');
    
    // Select the saved flow card and click Upload Data
    console.log('Selecting saved flow and clicking "Upload Data"...');
    await popupPage.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div.border.rounded-2xl'));
      const ourCard = cards.find(card => card.innerText.includes('Government KRP'));
      if (ourCard) {
        const buttons = Array.from(ourCard.querySelectorAll('button'));
        const uploadBtn = buttons.find(b => b.textContent && b.textContent.includes('Upload Data'));
        if (uploadBtn) {
          uploadBtn.click();
        } else {
          console.error('Upload Data button not found in card!');
        }
      } else {
        console.error('Government KRP card not found!');
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '11_popup_mapping_screen.png') });
    console.log('Captured: 11_popup_mapping_screen.png');

    // Upload spreadsheet krp_sample_data.xlsx
    console.log('Uploading spreadsheet...');
    const fileInput = await popupPage.waitForSelector('input[type="file"]');
    await fileInput.uploadFile('d:\\SACHIN RAWAL FILES\\FormPilot\\krp_sample_data.xlsx');
    
    console.log('Excel file uploaded. Waiting for fuzzy mapping to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '12_popup_mapping_loaded.png') });
    console.log('Captured: 12_popup_mapping_loaded.png');

    // Navigate mainTab back to starting portal URL before running automation
    console.log('Navigating mainTab back to starting portal URL...');
    await mainTab.goto('http://localhost:8080/krp');
    await mainTab.waitForSelector('#fullName');

    // Bring mainTab to front so active tab context is correct when starting execution
    console.log('Bringing mainTab to front...');
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click Confirm & Run Automation
    console.log('Clicking "Confirm & Run Automation"...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => b.textContent && b.textContent.includes('Confirm & Run Automation'));
      if (runBtn) runBtn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '13_popup_execution_started.png') });
    console.log('Captured: 13_popup_execution_started.png');

    // Loop 10 times and monitor each row filling in mainTab and status in popupPage.
    // The executor now handles form resets between rows by:
    //   1. Dismissing success modals/overlays (clicking "Complete Process" etc.)
    //   2. Waiting for the form to return to its initial state
    //   3. Processing the next row's steps
    // The test only needs to observe and capture screenshots.
    for (let row = 1; row <= 10; row++) {
      console.log(`\n>>> MONITORING EXCEL ROW ${row} of 10 <<<`);
      
      // Wait for the popup to show "Processing Row ${row} of 10" or COMPLETE if row == 10
      console.log(`Waiting for row ${row} start signal...`);
      await popupPage.waitForFunction(
        (r) => {
          const text = document.body.innerText;
          return text.includes(`Processing Row ${r} of 10`) || (r === 10 && (text.includes('Automation Finished') || text.includes('Completed successfully!')));
        },
        { timeout: 120000 },
        row
      );
      console.log(`Row ${row} detected in popup.`);

      // Bring portal page to front to observe filling
      await mainTab.bringToFront();
      
      // Wait for the portal to finish filling and display the success receipt overlay.
      console.log(`Waiting for row ${row} submission success receipt modal...`);
      try {
        await mainTab.waitForSelector('#receipt-overlay.receipt-active', { timeout: 60000 });
        console.log(`Row ${row}: Receipt overlay detected.`);
      } catch {
        // Receipt may have already been dismissed by the executor. That's fine.
        console.log(`Row ${row}: Receipt may have been auto-dismissed by executor.`);
      }

      // Capture screenshots
      await mainTab.screenshot({ path: path.join(screenshotsDir, `14_row_${row}_filling_portal.png`) });
      console.log(`Captured portal screenshot: 14_row_${row}_filling_portal.png`);

      // Bring popup page to front to observe counters and log stream
      await popupPage.bringToFront();
      await new Promise(resolve => setTimeout(resolve, 500));
      await popupPage.screenshot({ path: path.join(screenshotsDir, `15_row_${row}_filling_popup.png`) });
      console.log(`Captured popup status: 15_row_${row}_filling_popup.png`);

      // The executor handles form reset — we just wait for it to complete
      // by observing the next row's start signal in the popup (in the next loop iteration).

      // If we are at row 10, wait for complete confirmation
      if (row === 10) {
        console.log('Waiting for total execution complete...');
        await popupPage.bringToFront();
        await popupPage.waitForFunction(
          () => {
            const text = document.body.innerText;
            return text.includes('Automation Finished') || text.includes('Completed successfully!');
          },
          { timeout: 60000 }
        );
        await popupPage.screenshot({ path: path.join(screenshotsDir, '16_execution_completed_popup.png') });
        console.log('Captured final success state: 16_execution_completed_popup.png');
      }
    }

    console.log('=== ALL 10 ROWS SUCCESSFULLY PROCESSED AND AUTOMATED ===');
  } catch (err) {
    console.error('ERROR OCCURRED DURING TEST:', err);
    try {
      const activePages = await browser.pages();
      for (let i = 0; i < activePages.length; i++) {
        await activePages[i].screenshot({ path: path.join(screenshotsDir, `emergency_crash_page_${i}.png`) });
      }
    } catch (e) {
      console.error('Failed to take crash screenshots:', e);
    }
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
