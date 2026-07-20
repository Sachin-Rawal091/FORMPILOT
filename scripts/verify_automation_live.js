import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension details
const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\fbab1ce1-25c2-4221-8d16-98e9ffadd2fa\\screenshots';

async function run() {
  console.log('=== STARTING AUTOMATED LIVE EXCEL AUTOMATION SCRIPT ===');
  console.log('Using extension path:', extensionPath);

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  let browser;
  let logInterval;
  try {
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

    console.log('Waiting for recording tab to open and navigate to KRP portal...');
    let recordingTab;
    while (!recordingTab) {
      const targets = await browser.targets();
      const target = targets.find(t => t.type() === 'page' && t.url().includes('/krp'));
      if (target) {
        recordingTab = await target.page();
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    recordingTab.on('console', msg => console.log(`[RECORDING TAB LOG] ${msg.text()}`));
    recordingTab.on('pageerror', err => console.error(`[RECORDING TAB ERROR] ${err.message}`));
    await recordingTab.setViewport({ width: 950, height: 800 });

    // Wait for the Page object to actually load the KRP portal page
    console.log('Waiting for the Page object to load /krp...');
    while (!recordingTab.url().includes('/krp')) {
      console.log(`Current page URL check: "${recordingTab.url()}"`);
      await new Promise(r => setTimeout(r, 500));
    }

    const currentUrl = recordingTab.url();
    console.log('Recording tab URL after Record:', currentUrl);

    await recordingTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const recordingStatus = await recordingTab.evaluate(() => {
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

    await recordingTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Helper: fill an input with proper events for recorder
    async function fillInput(selector, value) {
      await recordingTab.waitForSelector(selector, { timeout: 5000 });
      await recordingTab.focus(selector);
      await recordingTab.evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
      await recordingTab.type(selector, value, { delay: 30 });
      await recordingTab.evaluate((sel) => {
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

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '03_portal_step_1.png') });
    console.log('Captured: 03_portal_step_1.png');

    console.log('Clicking Next Step 1...');
    await recordingTab.click('#btn-next-1');
    await new Promise(resolve => setTimeout(resolve, 1200));

    // --- STEP 2: ADDRESS ---
    console.log('Filling Step 2: Contact & Address details...');
    await fillInput('#addressLine', '128 Green Valley Road, Sector 4');
    await new Promise(resolve => setTimeout(resolve, 500));

    await recordingTab.waitForSelector('#stateRegion');
    await recordingTab.select('#stateRegion', 'North KRP');
    await recordingTab.evaluate(() => {
      document.querySelector('#stateRegion').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#postalCode', '560092');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#phoneNumber', '+91 98765 43210');
    await new Promise(resolve => setTimeout(resolve, 500));

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '04_portal_step_2.png') });
    console.log('Captured: 04_portal_step_2.png');

    console.log('Clicking Next Step 2...');
    await recordingTab.click('#btn-next-2');
    await new Promise(resolve => setTimeout(resolve, 1200));

    // --- STEP 3: ENTITY ---
    console.log('Filling Step 3: Economic Entity Info...');
    await recordingTab.waitForSelector('#entityType');
    await recordingTab.select('#entityType', 'MSME Small Enterprise');
    await recordingTab.evaluate(() => {
      document.querySelector('#entityType').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#landHolding', '5.5');
    await new Promise(resolve => setTimeout(resolve, 500));

    await recordingTab.waitForSelector('#annualRevenue');
    await recordingTab.select('#annualRevenue', '50,000 - 250,000');
    await recordingTab.evaluate(() => {
      document.querySelector('#annualRevenue').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '05_portal_step_3.png') });
    console.log('Captured: 05_portal_step_3.png');

    console.log('Clicking Next Step 3...');
    await recordingTab.click('#btn-next-3');
    await new Promise(resolve => setTimeout(resolve, 1200));

    // --- STEP 4: REVIEW & SUBMIT ---
    console.log('Filling Step 4: Audit & Regulatory Declarations...');
    await recordingTab.waitForSelector('#auditConsent');
    await recordingTab.click('#auditConsent');
    await recordingTab.evaluate(() => {
      document.querySelector('#auditConsent').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#declarationSignature', 'Aarav Sharma');
    await new Promise(resolve => setTimeout(resolve, 500));

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '06_portal_step_4.png') });
    console.log('Captured: 06_portal_step_4.png');

    console.log('Submitting form...');
    await recordingTab.click('#btn-submit');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '07_portal_success_receipt.png') });
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
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Map Spreadsheet'));
      if (btn) {
        btn.click();
      } else {
        console.error('Map Spreadsheet button not found!');
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '11_popup_mapping_screen.png') });
    console.log('Captured: 11_popup_mapping_screen.png');

    // Upload spreadsheet krp_sample_data.xlsx
    console.log('Uploading spreadsheet...');
    const fileInput = await popupPage.waitForSelector('input[type="file"]');
    await fileInput.uploadFile(path.join(__dirname, '../fixtures/krp_sample_data.xlsx'));
    
    console.log('Excel file uploaded. Waiting for fuzzy mapping to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '12_popup_mapping_loaded.png') });
    console.log('Captured: 12_popup_mapping_loaded.png');

    // Inject Settings (Set stepDelay = 600ms for visible live filling)
    await popupPage.evaluate(() => {
      chrome.storage.local.set({
        settings: {
          stepDelay: 600,
          maxStepRetries: 3,
          waitElementTimeout: 10000,
          autoSubmit: true,
          headlessMode: false,
        }
      });
    });
    console.log('Set stepDelay to 600ms in extension settings.');

    // Click Confirm & Run Automation
    console.log('Clicking "Confirm & Run Automation"...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => b.textContent && (b.textContent.includes('Confirm & Run Automation') || b.textContent.includes('Execute Auto-Fill Pipeline')));
      if (runBtn) runBtn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '13_popup_execution_started.png') });
    console.log('Captured: 13_popup_execution_started.png');

    console.log('Reusing recording tab for execution...');
    const executionTab = recordingTab;
    executionTab.on('console', msg => console.log(`[EXECUTION TAB LOG] ${msg.text()}`));
    executionTab.on('pageerror', err => console.error(`[EXECUTION TAB ERROR] ${err.message}`));
    console.log('Execution tab URL:', executionTab.url());
    
    // Start logging interval to preview popup innerText every 3 seconds for debugging
    logInterval = setInterval(async () => {
      try {
        const text = await popupPage.evaluate(() => document.body.innerText);
        console.log(`[MONITOR] Popup Text Preview:\n${text.slice(0, 300)}...\n`);
      } catch (e) {}
    }, 3000);

    // Loop 10 times and monitor each row filling in executionTab and status in popupPage.
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
          return text.includes(`Processing Row ${r} of 10`) || 
                 text.includes(`Row ${r}/10`) || 
                 text.includes(`ROW ${r}`) || 
                 (r === 10 && (
                   text.includes('Automation Finished') || 
                   text.includes('Completed successfully!') || 
                   text.includes('Pipeline Finished')
                 ));
        },
        { timeout: 120000 },
        row
      );
      console.log(`Row ${row} detected in popup.`);

      // Bring portal page to front to observe filling
      await executionTab.bringToFront();
      
      // Wait for the portal to finish filling and display the success receipt overlay.
      console.log(`Waiting for row ${row} submission success receipt modal...`);
      try {
        await executionTab.waitForSelector('#receipt-overlay.receipt-active', { timeout: 60000 });
        console.log(`Row ${row}: Receipt overlay detected.`);
      } catch {
        // Receipt may have already been dismissed by the executor. That's fine.
        console.log(`Row ${row}: Receipt may have been auto-dismissed by executor.`);
      }

      // Capture screenshots
      await executionTab.screenshot({ path: path.join(screenshotsDir, `14_row_${row}_filling_portal.png`) });
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
            return text.includes('COMPLETED') || text.includes('COMPLETE') || text.includes('Pipeline Finished') || text.includes('Completed successfully!');
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
    if (logInterval) clearInterval(logInterval);
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
}

run();
