import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths configuration
const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\c55ec8f6-2afb-4dfb-8d16-0d0ed6e8a4ff\\screenshots';

async function run() {
  console.log('=== STARTING AUTOMATED RMDP DATE PICKER EXCEL AUTOMATION SCRIPT ===');
  console.log('Using extension path:', extensionPath);

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  let browser;
  let logInterval;
  let popupPage;
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
        '--window-size=1400,980'
      ]
    });

    console.log('Waiting for extension to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Discover Extension ID
    const targets = await browser.targets();
    const bgTarget = targets.find(
      t => t.type() === 'service_worker' || t.type() === 'background_page'
    );
    if (!bgTarget) throw new Error('Failed to find extension service worker.');
    const extensionId = bgTarget.url().split('/')[2];
    console.log(`Detected Extension ID: ${extensionId}`);

    // 3. Setup tabs
    const pages = await browser.pages();
    const mainTab = pages[0] || await browser.newPage();
    mainTab.on('console', msg => console.log(`[TAB LOG] ${msg.text()}`));
    mainTab.on('pageerror', err => console.error(`[TAB ERROR] ${err.message}`));
    await mainTab.setViewport({ width: 950, height: 800 });

    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log(`[POPUP LOG] ${msg.text()}`));
    popupPage.on('pageerror', err => console.error(`[POPUP ERROR] ${err.message}`));
    await popupPage.setViewport({ width: 380, height: 600 });
    
    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;
    await popupPage.goto(popupUrl);
    console.log('Popup UI loaded.');
    await popupPage.waitForSelector('input[type="text"]');

    // 4. Input URL and start Recording
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    await popupPage.evaluate(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'http://localhost:8080/rmdp');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await popupPage.screenshot({ path: path.join(screenshotsDir, '01_rmdp_popup_pre_record.png') });
    console.log('Captured: 01_rmdp_popup_pre_record.png');

    console.log('Clicking Record button...');
    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
    });

    console.log('Waiting for recording tab to open...');
    let recordingTab;
    while (!recordingTab) {
      const targets = await browser.targets();
      const target = targets.find(t => t.type() === 'page' && t.url().includes('/rmdp'));
      if (target) {
        recordingTab = await target.page();
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    recordingTab.on('console', msg => console.log(`[RECORDING TAB LOG] ${msg.text()}`));
    recordingTab.on('pageerror', err => console.error(`[RECORDING TAB ERROR] ${err.message}`));
    await recordingTab.setViewport({ width: 950, height: 800 });

    console.log('Waiting for the Page object to load /rmdp...');
    while (!recordingTab.url().includes('/rmdp')) {
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('Recording tab open. Starting record simulation...');
    await recordingTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Helper to select date via simulated calendar clicks
    async function selectCalendarDay(inputSelector, day) {
      await recordingTab.waitForSelector(inputSelector);
      await recordingTab.click(inputSelector);
      await recordingTab.waitForSelector('.rmdp-wrapper');
      await recordingTab.evaluate((d) => {
        const cells = Array.from(document.querySelectorAll('.rmdp-wrapper .rmdp-day:not(.rmdp-deactive)'));
        const targetCell = cells.find(c => c.querySelector('span')?.textContent?.trim() === String(d));
        if (targetCell) {
          targetCell.click();
        }
      }, day);
      await new Promise(r => setTimeout(r, 600));
    }

    // Helper for Range selection
    async function selectCalendarRange(inputSelector, startDay, endDay) {
      await recordingTab.waitForSelector(inputSelector);
      await recordingTab.click(inputSelector);
      await recordingTab.waitForSelector('.rmdp-wrapper');
      
      // Click start date
      await recordingTab.evaluate((d) => {
        const cells = Array.from(document.querySelectorAll('.rmdp-wrapper .rmdp-day:not(.rmdp-deactive)'));
        const cell = cells.find(c => c.querySelector('span')?.textContent?.trim() === String(d));
        if (cell) cell.click();
      }, startDay);
      await new Promise(r => setTimeout(r, 400));

      // Click end date
      await recordingTab.evaluate((d) => {
        const cells = Array.from(document.querySelectorAll('.rmdp-wrapper .rmdp-day:not(.rmdp-deactive)'));
        const cell = cells.find(c => c.querySelector('span')?.textContent?.trim() === String(d));
        if (cell) cell.click();
      }, endDay);
      await new Promise(r => setTimeout(r, 600));
    }

    // Helper for Multi date selection
    async function selectCalendarMulti(inputSelector, days) {
      await recordingTab.waitForSelector(inputSelector);
      await recordingTab.click(inputSelector);
      await recordingTab.waitForSelector('.rmdp-wrapper');
      
      for (const d of days) {
        await recordingTab.evaluate((val) => {
          const cells = Array.from(document.querySelectorAll('.rmdp-wrapper .rmdp-day:not(.rmdp-deactive)'));
          const cell = cells.find(c => c.querySelector('span')?.textContent?.trim() === String(val));
          if (cell) cell.click();
        }, d);
        await new Promise(r => setTimeout(r, 300));
      }
      
      // Close calendar by clicking on body
      await recordingTab.click('body');
      await new Promise(r => setTimeout(r, 600));
    }

    // --- Fill all fields to record schema ---
    console.log('Simulating date selections to record flow template...');
    
    console.log('Selecting Application Date (15th)...');
    await selectCalendarDay('#application-date', 15);
    
    console.log('Selecting DOB (10th)...');
    await selectCalendarDay('#dob', 10);

    console.log('Selecting Loan Date (20th)...');
    await selectCalendarDay('#loan-date', 20);

    console.log('Selecting Claim Date (25th)...');
    await selectCalendarDay('#claim-date', 25);

    console.log('Selecting Insurance Date (5th)...');
    await selectCalendarDay('#insurance-date', 5);

    console.log('Selecting Range Dates (1st to 10th)...');
    await selectCalendarRange('#range-date', 1, 10);

    console.log('Selecting Multi Dates (1st, 3rd, 5th)...');
    await selectCalendarMulti('#multi-date', [1, 3, 5]);

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '02_rmdp_portal_form_recorded.png') });
    console.log('Captured: 02_rmdp_portal_form_recorded.png');

    console.log('Submitting Form...');
    await recordingTab.click('#btn-submit');
    await new Promise(resolve => setTimeout(resolve, 1500));

    await recordingTab.screenshot({ path: path.join(screenshotsDir, '03_rmdp_portal_submitted.png') });
    console.log('Captured: 03_rmdp_portal_submitted.png');

    // Click modal close to reset form
    await recordingTab.click('#btn-close-modal');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5. Save Recording
    console.log('Saving flow template in popup...');
    await popupPage.bringToFront();
    await popupPage.goto(popupUrl);
    await new Promise(resolve => setTimeout(resolve, 1500));

    const nameSel = 'input[placeholder*="Custom"]';
    const nameExists = await popupPage.evaluate((sel) => !!document.querySelector(sel), nameSel);
    if (nameExists) {
      await popupPage.evaluate((sel) => { document.querySelector(sel).value = ''; }, nameSel);
      await popupPage.type(nameSel, 'RMDP Date Picker Automation Playpen');
    } else {
      const inputs = await popupPage.$$('input[type="text"]');
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        await lastInput.click({ clickCount: 3 });
        await lastInput.type('RMDP Date Picker Automation Playpen');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));

    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Stop') && b.textContent.includes('Save'));
      if (saveBtn) saveBtn.click();
    });

    console.log('Saving flow to DB...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    await popupPage.screenshot({ path: path.join(screenshotsDir, '04_rmdp_flow_saved.png') });
    console.log('Captured: 04_rmdp_flow_saved.png');

    // 6. Map spreadsheet
    console.log('Initiating Spreadsheet mapping...');
    await popupPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Map Spreadsheet'));
      if (btn) btn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '05_rmdp_mapping_screen.png') });
    console.log('Captured: 05_rmdp_mapping_screen.png');

    // Upload excel
    const excelPath = path.join(__dirname, '../fixtures/rmdp_sample_data.xlsx');
    console.log('Uploading Excel sheet:', excelPath);
    const fileInput = await popupPage.waitForSelector('input[type="file"]');
    await fileInput.uploadFile(excelPath);

    console.log('Spreadsheet uploaded. Waiting for auto-mapping...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '06_rmdp_mapping_configured.png') });
    console.log('Captured: 06_rmdp_mapping_configured.png');

    // Adjust step delay to 400ms for clean visualization
    await popupPage.evaluate(() => {
      chrome.storage.local.set({
        settings: {
          stepDelay: 400,
          maxStepRetries: 3,
          waitElementTimeout: 10000,
          autoSubmit: true,
          headlessMode: false,
        }
      });
    });

    // 7. Run Automation!
    console.log('Executing automation pipeline...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => b.textContent && (b.textContent.includes('Confirm & Run') || b.textContent.includes('Execute Auto-Fill')));
      if (runBtn) runBtn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '07_rmdp_pipeline_started.png') });
    console.log('Captured: 07_rmdp_pipeline_started.png');

    // 8. Monitor Pipeline (10 rows)
    const executionTab = recordingTab;
    logInterval = setInterval(async () => {
      try {
        const text = await popupPage.evaluate(() => document.body.innerText);
        console.log(`[MONITOR] Status:\n${text.slice(0, 200)}...\n`);
      } catch (e) {}
    }, 4000);

    for (let r = 1; r <= 10; r++) {
      console.log(`\n--- WAITING FOR ROW ${r} OF 10 ---`);
      
      let matched = false;
      const syncTimeout = 180000;
      const startSyncTime = Date.now();
      
      while (!matched && (Date.now() - startSyncTime < syncTimeout)) {
        const text = await popupPage.evaluate(() => document.body.innerText);
        if (
          text.includes(`Processing Row ${r} of 10`) ||
          text.includes(`Row ${r}/10`) ||
          text.includes(`ROW ${r}`) ||
          (r === 10 && (
            text.includes('Finished') ||
            text.includes('Completed successfully!')
          ))
        ) {
          matched = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (!matched) {
        throw new Error(`Timeout waiting for Row ${r} to start in popup UI`);
      }

      console.log(`Row ${r} execution started.`);
      await executionTab.bringToFront();
      
      // Wait for success receipt modal to popup (indicating current row completed)
      await executionTab.waitForSelector('#success-modal.show', { timeout: 30000 });
      console.log(`Row ${r} form filled and submitted successfully!`);
      
      await executionTab.screenshot({ path: path.join(screenshotsDir, `08_rmdp_row_${r}_success.png`) });
      console.log(`Captured: 08_rmdp_row_${r}_success.png`);

      // Dismiss modal is handled by executor. Let's wait for it to be dismissed.
      console.log('Waiting for modal to be dismissed by executor...');
      await executionTab.waitForSelector('#success-modal:not(.show)', { timeout: 15000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log('\n=== PIPELINE COMPLETED SUCCESSFULLY ===');
    clearInterval(logInterval);

    await popupPage.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '09_rmdp_pipeline_finished.png') });
    console.log('Captured: 09_rmdp_pipeline_finished.png');

    console.log('E2E automation run verified cleanly!');

  } catch (err) {
    console.error('ERROR OCCURRED DURING EXECUTING PIPELINE:', err);
  } finally {
    if (logInterval) clearInterval(logInterval);
    if (popupPage) {
      try {
        const logs = await popupPage.evaluate(async () => {
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
        console.log(`\n=== DUMPING INDEXEDDB LOGS (${logs.length} entries) ===`);
        console.log(JSON.stringify(logs, null, 2));
        console.log('=== END OF INDEXEDDB LOGS ===\n');
      } catch (e) {
        console.error('Failed to dump IndexedDB logs:', e);
      }
    }
    if (browser) await browser.close();
  }
}

run();
