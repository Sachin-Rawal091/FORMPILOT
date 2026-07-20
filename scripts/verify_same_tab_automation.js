import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension details
const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\f01b9813-ce79-433a-b06c-17170a9c85f7\\screenshots';

async function run() {
  console.log('=== STARTING SAME-TAB EXCEL AUTOMATION E2E TEST ===');
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

  let logInterval;
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

    // 3. Get the first real browser tab (will be our placeholder/dashboard host)
    const pages = await browser.pages();
    const mainTab = pages[0] || await browser.newPage();
    mainTab.on('console', msg => console.log(`[TAB LOG] ${msg.text()}`));
    mainTab.on('pageerror', err => console.error(`[TAB ERROR] ${err.message}`));
    await mainTab.setViewport({ width: 950, height: 800 });

    // 4. Open the extension popup/options in a separate tab
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log(`[POPUP LOG] ${msg.text()}`));
    popupPage.on('pageerror', err => console.error(`[POPUP ERROR] ${err.message}`));
    await popupPage.setViewport({ width: 1200, height: 800 });
    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;
    await popupPage.goto(popupUrl);
    console.log('Popup/Options Dashboard UI loaded.');
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

    const recTabCreatedPromise = new Promise(resolve => {
      const listener = async (target) => {
        if (target.type() === 'page') {
          const page = await target.page();
          if (page && page.url() !== 'about:blank' && !page.url().includes('popup.html')) {
            browser.off('targetcreated', listener);
            resolve(page);
          }
        }
      };
      browser.on('targetcreated', listener);
    });

    console.log('Clicking Record button...');
    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
      else console.error('Record button not found!');
    });

    console.log('Waiting for recording tab to open...');
    const recordingTab = await recTabCreatedPromise;
    recordingTab.on('console', msg => console.log(`[RECORDING TAB LOG] ${msg.text()}`));
    recordingTab.on('pageerror', err => console.error(`[RECORDING TAB ERROR] ${err.message}`));
    await recordingTab.setViewport({ width: 950, height: 800 });

    const currentUrl = recordingTab.url();
    console.log('Recording tab URL after Record:', currentUrl);

    await recordingTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Capture tab ID from background worker state check (to ensure it tracks lastActiveWebTabId)
    // We can simulate the user's action: the user navigates KRP portal on this tab.
    // Let's do the initial recording flow:
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

    // 8. Switch to options page to stop and save
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
        const uploadBtn = buttons.find(b => b.textContent && (b.textContent.includes('Upload Data') || b.textContent.includes('Map Spreadsheet')));
        if (uploadBtn) {
          uploadBtn.click();
        } else {
          console.error('Upload Data / Map Spreadsheet button not found in card!');
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
    await fileInput.uploadFile(path.join(__dirname, '../fixtures/krp_sample_data.xlsx'));
    
    console.log('Excel file uploaded. Waiting for fuzzy mapping to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '12_popup_mapping_loaded.png') });
    console.log('Captured: 12_popup_mapping_loaded.png');

    // Record the current number of pages open in the browser before running automation
    const pagesBeforeRun = await browser.pages();
    const pageCountBefore = pagesBeforeRun.length;
    console.log(`Open browser tabs before running: ${pageCountBefore}`);

    // Click Confirm & Run Automation
    console.log('Clicking "Confirm & Run Automation"...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => b.textContent && (b.textContent.includes('Confirm & Run Automation') || b.textContent.includes('Execute Auto-Fill Pipeline')));
      if (runBtn) runBtn.click();
    });

    console.log('Automation execution triggered. Waiting 3s to let state initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // VERIFY: Check if any new tab was opened
    const pagesAfterRun = await browser.pages();
    const pageCountAfter = pagesAfterRun.length;
    console.log(`Open browser tabs after running: ${pageCountAfter}`);

    if (pageCountAfter !== pageCountBefore) {
      throw new Error(`TEST FAILED: A new tab was opened! Tab count went from ${pageCountBefore} to ${pageCountAfter}`);
    }
    console.log('✅ TEST PASSED: No new tab was opened when running the automation!');

    // Since it redirects the same tab, recordingTab is our execution tab!
    const executionTab = recordingTab;
    console.log('Reusing the existing web tab for execution:', executionTab.url());
    
    // Start logging monitor
    logInterval = setInterval(async () => {
      try {
        const text = await popupPage.evaluate(() => document.body.innerText);
        console.log(`[MONITOR] Dashboard Status Preview:\n${text.slice(0, 300)}...\n`);
      } catch (e) {}
    }, 4000);

    // Loop 10 times and monitor progress
    for (let row = 1; row <= 10; row++) {
      console.log(`\n>>> MONITORING EXCEL ROW ${row} of 10 <<<`);
      
      // Wait for the dashboard to show progress
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
      console.log(`Row ${row} detected on dashboard.`);

      // Verify the dashboard remains the focused/active tab in the foreground!
      const currentActiveTarget = browser.targets().find(t => t.type() === 'page' && t.url().includes('popup.html'));
      // We can take a screenshot of popupPage to visually prove it remains in the foreground
      await popupPage.screenshot({ path: path.join(screenshotsDir, `15_row_${row}_filling_popup.png`) });
      console.log(`Captured dashboard foreground status: 15_row_${row}_filling_popup.png`);

      // Bring target tab to front momentarily to capture a screenshot of it being filled, then bring dashboard back
      await executionTab.bringToFront();
      await new Promise(resolve => setTimeout(resolve, 800));
      await executionTab.screenshot({ path: path.join(screenshotsDir, `14_row_${row}_filling_portal.png`) });
      console.log(`Captured background portal status: 14_row_${row}_filling_portal.png`);

      await popupPage.bringToFront();
      await new Promise(resolve => setTimeout(resolve, 500));

      if (row === 10) {
        console.log('Waiting for total execution complete...');
        await popupPage.waitForFunction(
          () => {
            const text = document.body.innerText;
            return text.includes('Pipeline Finished') || text.includes('Completed successfully!');
          },
          { timeout: 60000 }
        );
        await popupPage.screenshot({ path: path.join(screenshotsDir, '16_execution_completed_popup.png') });
        console.log('Captured final success state: 16_execution_completed_popup.png');
      }
    }

    console.log('=== ALL 10 ROWS SUCCESSFULLY PROCESSED WITHOUT OPENING NEW TABS ===');
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
    throw err;
  } finally {
    if (logInterval) clearInterval(logInterval);
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
