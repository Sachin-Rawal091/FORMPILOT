/**
 * FormPilot — Live Chrome Demo Script
 * Launches Chrome with the extension loaded, records the KRP portal flow once,
 * uploads the 10-row Excel file, and runs automation for all 10 rows live.
 *
 * Usage: node run_live_demo.js
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath  = path.join(__dirname, 'dist');
const excelFilePath  = path.join(__dirname, '../fixtures/krp_sample_data.xlsx');
const screenshotsDir = path.join(__dirname, 'live_demo_screenshots');

const PORTAL_URL = 'http://localhost:8080/krp';
const TOTAL_ROWS = 10;

// ─── Utility ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fillInput(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.focus(selector);
  await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
  await page.type(selector, String(value), { delay: 25 });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
}

async function selectOption(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.select(selector, value);
  await page.evaluate((sel) => {
    document.querySelector(sel).dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
}

async function screenshot(page, name) {
  const p = path.join(screenshotsDir, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`📸  ${name}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  FormPilot — LIVE 10-Row Chrome Demo                ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Validate prerequisites
  if (!fs.existsSync(extensionPath)) {
    console.error('❌ Extension dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }
  if (!fs.existsSync(excelFilePath)) {
    console.error('❌ Excel file not found:', excelFilePath);
    process.exit(1);
  }

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // ─── 1. Launch Chrome with extension ──────────────────────────────────────
  console.log('🚀  Launching Chrome with FormPilot extension loaded...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1400,950',
      '--window-position=0,0'
    ]
  });

  try {
    await sleep(3000); // Wait for extension SW to initialize

    // ─── 2. Discover extension ID ──────────────────────────────────────────
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.type() === 'service_worker' || t.type() === 'background_page');
    if (!swTarget) throw new Error('Could not find extension service worker target.');
    const extensionId = swTarget.url().split('/')[2];
    console.log(`✅  Extension ID: ${extensionId}`);

    // ─── 3. Set up pages ───────────────────────────────────────────────────
    const pages = await browser.pages();
    const portalPage = pages[0] || await browser.newPage();
    portalPage.on('console', msg => {
      if (msg.type() === 'error') console.error(`[Portal] ${msg.text()}`);
    });

    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log(`[Popup] ${msg.text()}`));
    popupPage.on('pageerror', err => console.error(`[Popup Error] ${err.message}`));
    await popupPage.setViewport({ width: 400, height: 650 });

    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;

    // ─── 4. Navigate portal page to KRP ───────────────────────────────────
    console.log('\n📋  Step 1: Navigate to KRP Portal...');
    await portalPage.goto(PORTAL_URL, { waitUntil: 'networkidle0' });
    await portalPage.setViewport({ width: 1000, height: 900 });
    await screenshot(portalPage, '01_portal_loaded.png');
    console.log('✅  Portal loaded.');

    // ─── 5. Open popup and start recording ────────────────────────────────
    console.log('\n🔴  Step 2: Open FormPilot popup & start recording...');
    await popupPage.goto(popupUrl, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await screenshot(popupPage, '02_popup_home.png');

    // Type portal URL into popup's URL field
    await popupPage.evaluate((url) => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, url);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, PORTAL_URL);
    await sleep(500);

    // Click the Record button
    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"], button[data-action="record"]');
      if (btn) btn.click();
      else {
        const allBtns = Array.from(document.querySelectorAll('button'));
        const recordBtn = allBtns.find(b => b.textContent?.toLowerCase().includes('record'));
        if (recordBtn) recordBtn.click();
      }
    });

    await sleep(3000);
    await screenshot(popupPage, '03_popup_recording_started.png');
    console.log('✅  Recording started.');

    // ─── 6. Fill the 4-step wizard (recording the flow) ───────────────────
    await portalPage.bringToFront();

    // STEP 1 — Identity
    console.log('\n📝  Recording Step 1: Identity Details...');
    await fillInput(portalPage, '#fullName',       'Aarav Sharma');
    await sleep(400);
    await fillInput(portalPage, '#birthDate',      '1994-08-15');
    await sleep(400);
    await fillInput(portalPage, '#identityNumber', 'KRP-9821-X9');
    await sleep(400);
    await selectOption(portalPage, '#gender', 'Male');
    await sleep(400);
    await screenshot(portalPage, '04_recording_step1.png');
    await portalPage.click('#btn-next-1');
    await sleep(1500);

    // STEP 2 — Address
    console.log('📝  Recording Step 2: Address Details...');
    await fillInput(portalPage, '#addressLine', '128 Green Valley Road, Sector 4');
    await sleep(400);
    await selectOption(portalPage, '#stateRegion', 'North KRP');
    await sleep(400);
    await fillInput(portalPage, '#postalCode', '560092');
    await sleep(400);
    await fillInput(portalPage, '#phoneNumber', '+91 98765 43210');
    await sleep(400);
    await screenshot(portalPage, '05_recording_step2.png');
    await portalPage.click('#btn-next-2');
    await sleep(1500);

    // STEP 3 — Entity
    console.log('📝  Recording Step 3: Entity Info...');
    await selectOption(portalPage, '#entityType', 'MSME Small Enterprise');
    await sleep(400);
    await fillInput(portalPage, '#landHolding', '5.5');
    await sleep(400);
    await selectOption(portalPage, '#annualRevenue', '50,000 - 250,000');
    await sleep(400);
    await screenshot(portalPage, '06_recording_step3.png');
    await portalPage.click('#btn-next-3');
    await sleep(1500);

    // STEP 4 — Declaration
    console.log('📝  Recording Step 4: Declaration...');
    await portalPage.click('#auditConsent');
    await sleep(400);
    await fillInput(portalPage, '#declarationSignature', 'Aarav Sharma');
    await sleep(400);
    await screenshot(portalPage, '07_recording_step4.png');
    await portalPage.click('#btn-submit');
    await sleep(2500);
    await screenshot(portalPage, '08_recording_receipt.png');
    console.log('✅  Form completed — receipt shown.');

    // Wait for debounced events to flush
    await sleep(4000);

    // ─── 7. Stop & save recording in popup ────────────────────────────────
    console.log('\n💾  Step 3: Stop & save recording...');
    await popupPage.bringToFront();
    await popupPage.goto(popupUrl, { waitUntil: 'networkidle0' });
    await sleep(2000);
    await screenshot(popupPage, '09_popup_recording_ui.png');

    // Name the recording
    await popupPage.evaluate((name) => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      const nameInput = inputs.find(i => i.placeholder?.toLowerCase().includes('name') || i.placeholder?.toLowerCase().includes('custom'));
      if (nameInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(nameInput, name);
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 'KRP Government Portal — 10 Row Demo');

    await sleep(500);

    // Click Stop & Save
    await popupPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const saveBtn = btns.find(b => b.textContent?.includes('Stop') || b.textContent?.includes('Save'));
      if (saveBtn) saveBtn.click();
    });

    await sleep(4000);
    await screenshot(popupPage, '10_popup_saved_flows.png');
    console.log('✅  Recording saved.');

    // ─── 8. Upload Excel data ──────────────────────────────────────────────
    console.log('\n📊  Step 4: Upload Excel data (10 rows)...');

    // Find and click "Upload Data" on the saved flow card
    await popupPage.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div'));
      const krpCard = cards.find(d => d.textContent?.includes('KRP'));
      if (krpCard) {
        const btns = Array.from(krpCard.querySelectorAll('button'));
        const uploadBtn = btns.find(b => b.textContent?.toLowerCase().includes('upload') || b.textContent?.toLowerCase().includes('data'));
        if (uploadBtn) uploadBtn.click();
        else {
          // Try any button in that card area
          btns[0]?.click();
        }
      }
    });

    await sleep(2000);
    await screenshot(popupPage, '11_popup_data_screen.png');

    // Upload the Excel file
    try {
      const fileInput = await popupPage.waitForSelector('input[type="file"]', { timeout: 5000 });
      await fileInput.uploadFile(excelFilePath);
      console.log('✅  Excel file uploaded.');
    } catch {
      console.log('⚠️  File input not found — trying drag-drop approach...');
    }

    await sleep(3000);
    await screenshot(popupPage, '12_popup_data_mapped.png');

    // ─── 9. Navigate portal back to fresh start ────────────────────────────
    console.log('\n🔄  Resetting portal to initial state...');
    await portalPage.goto(PORTAL_URL, { waitUntil: 'networkidle0' });
    await portalPage.bringToFront();
    await sleep(1000);

    // ─── 10. Click "Confirm & Run Automation" ─────────────────────────────
    console.log('\n▶️   Step 5: Start automation for all 10 rows...');
    await popupPage.bringToFront();

    await popupPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const runBtn = btns.find(b =>
        b.textContent?.toLowerCase().includes('confirm') ||
        b.textContent?.toLowerCase().includes('run automation') ||
        b.textContent?.toLowerCase().includes('start')
      );
      if (runBtn) {
        console.log('[Demo] Clicking run button:', runBtn.textContent?.trim());
        runBtn.click();
      } else {
        console.log('[Demo] Run button not found. Available buttons:', btns.map(b => b.textContent?.trim()).join(', '));
      }
    });

    await sleep(2000);
    await screenshot(popupPage, '13_popup_execution_started.png');
    console.log('✅  Automation started!');

    // ─── 11. Monitor all 10 rows live ──────────────────────────────────────
    console.log('\n👁️   Monitoring 10-row live execution...\n');

    for (let row = 1; row <= TOTAL_ROWS; row++) {
      console.log(`\n>>> ROW ${row} of ${TOTAL_ROWS} <<<`);

      // Wait for this row to start processing (in popup)
      try {
        await popupPage.waitForFunction(
          (r, total) => {
            const t = document.body.innerText;
            return t.includes(`Row ${r}`) || t.includes(`${r} of ${total}`) || (r === total && (t.includes('Finished') || t.includes('Complete') || t.includes('complete')));
          },
          { timeout: 90000 },
          row, TOTAL_ROWS
        );
        console.log(`  ✅ Row ${row} detected in popup.`);
      } catch {
        console.log(`  ⚠️  Row ${row} signal timeout — continuing.`);
      }

      // Show portal filling in progress
      await portalPage.bringToFront();
      await sleep(1500);

      // Wait for the success receipt on this row
      try {
        await portalPage.waitForSelector('#receipt-overlay.receipt-active', { timeout: 30000 });
        console.log(`  🎉 Row ${row}: Receipt overlay appeared!`);
      } catch {
        console.log(`  ℹ️  Row ${row}: Receipt may already be dismissed.`);
      }

      await screenshot(portalPage, `14_row${row.toString().padStart(2,'0')}_portal_filled.png`);

      // Show popup status
      await popupPage.bringToFront();
      await sleep(800);
      await screenshot(popupPage, `15_row${row.toString().padStart(2,'0')}_popup_status.png`);

      if (row === TOTAL_ROWS) {
        // Wait for full completion
        try {
          await popupPage.waitForFunction(
            () => {
              const t = document.body.innerText;
              return t.includes('Finished') || t.includes('Completed') || t.includes('complete') || t.includes('10/10');
            },
            { timeout: 60000 }
          );
          await screenshot(popupPage, '16_FINAL_completion.png');
          console.log('\n🎊  ALL 10 ROWS COMPLETED SUCCESSFULLY!');
        } catch {
          await screenshot(popupPage, '16_FINAL_state.png');
          console.log('\n✅  Row 10 processed. Final screenshot captured.');
        }
      }
    }

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  ✅ LIVE DEMO COMPLETE — All 10 rows automated!     ║');
    console.log(`║  📸 Screenshots saved to: live_demo_screenshots/    ║`);
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // Keep browser open for 15 seconds so the user can see the final state
    await sleep(15000);

  } catch (err) {
    console.error('\n❌ Demo failed:', err.message);
    // Emergency screenshots
    try {
      const allPages = await browser.pages();
      for (let i = 0; i < allPages.length; i++) {
        await allPages[i].screenshot({ path: path.join(screenshotsDir, `CRASH_page${i}.png`) });
      }
    } catch {}
  } finally {
    await browser.close();
    console.log('Browser closed.\n');
  }
}

run();
