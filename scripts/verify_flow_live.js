import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension details
const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\1f7796a1-2f00-4d59-97a6-226f75c67972\\screenshots';

async function run() {
  console.log('=== STARTING AUTOMATED LIVE VERIFICATION SCRIPT ===');
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
      '--window-size=1200,900'
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

    // Attach to the service worker to see its console logs
    try {
      const swPage = await bgTarget.worker();
      if (swPage) {
        swPage.on('console', msg => console.log(`[SW LOG] ${msg.text()}`));
      }
    } catch (e) {
      console.log('Could not attach to service worker console (non-fatal).');
    }

    // 3. Get the first real browser tab (the one the user would interact with)
    const pages = await browser.pages();
    // Use the first tab (about:blank) — this simulates the user's active tab
    const mainTab = pages[0] || await browser.newPage();
    mainTab.on('console', msg => console.log(`[TAB LOG] ${msg.text()}`));
    mainTab.on('pageerror', err => console.error(`[TAB ERROR] ${err.message}`));
    await mainTab.setViewport({ width: 900, height: 750 });

    // 4. Open the extension popup in a separate tab (since we can't truly open the popup action)
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log(`[POPUP LOG] ${msg.text()}`));
    popupPage.on('pageerror', err => console.error(`[POPUP ERROR] ${err.message}`));
    await popupPage.setViewport({ width: 380, height: 600 });
    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;
    await popupPage.goto(popupUrl);
    console.log('Popup UI loaded.');
    await popupPage.waitForSelector('input[type="text"]');

    // 5. Type URL and click Record in the popup
    //    IMPORTANT: We focus the MAIN TAB first so it is the "active tab" 
    //    when the popup queries chrome.tabs.query({active:true})
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now type URL into the popup (in background using evaluate)
    await popupPage.evaluate(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        // Use React-compatible setter
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'http://localhost:8080/krp');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await popupPage.screenshot({ path: path.join(screenshotsDir, '01_popup_pre_record.png') });
    console.log('Captured: 01_popup_pre_record.png');

    // Click Record — this will navigate mainTab to the KRP URL
    console.log('Clicking Record button...');
    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
      else console.error('Record button not found!');
    });

    // Wait for mainTab to navigate to the KRP portal and content script to load
    console.log('Waiting for tab navigation and content script injection...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // mainTab should now be at the KRP portal
    const currentUrl = mainTab.url();
    console.log('Main tab URL after Record:', currentUrl);

    // Bring mainTab to front to interact with the KRP form
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify content script is loaded and recording
    const recordingStatus = await mainTab.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title
      };
    });
    console.log('Portal page status:', JSON.stringify(recordingStatus));

    // Check popup state — open popup again to see recording screen
    await popupPage.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '02_popup_recording_started.png') });
    console.log('Captured: 02_popup_recording_started.png');

    // Back to the main tab to perform form filling
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Helper: fill an input with proper events for recorder to capture
    async function fillInput(selector, value) {
      await mainTab.waitForSelector(selector, { timeout: 5000 });
      await mainTab.focus(selector);
      // Clear existing value
      await mainTab.evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
      // Type with delay to trigger input events
      await mainTab.type(selector, value, { delay: 40 });
      // Explicit event dispatch for the recorder
      await mainTab.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector);
    }

    // --- STEP 1: IDENTITY ---
    console.log('Filling Step 1: Personal & Identity Details...');
    await fillInput('#fullName', 'Aarav Sharma');
    await new Promise(resolve => setTimeout(resolve, 600));
    await fillInput('#birthDate', '1994-08-15');
    await new Promise(resolve => setTimeout(resolve, 600));
    await fillInput('#identityNumber', 'KRP-9821-X9');
    await new Promise(resolve => setTimeout(resolve, 600));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '03_portal_step_1.png') });
    console.log('Captured: 03_portal_step_1.png');

    console.log('Clicking Next Step 1...');
    await mainTab.click('#btn-next-1');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 2: ADDRESS ---
    console.log('Filling Step 2: Contact & Address details...');
    await fillInput('#addressLine', '128 Green Valley Road, Sector 4');
    await new Promise(resolve => setTimeout(resolve, 600));

    await mainTab.waitForSelector('#stateRegion');
    await mainTab.select('#stateRegion', 'North KRP');
    await mainTab.evaluate(() => {
      document.querySelector('#stateRegion').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 600));

    await fillInput('#postalCode', '560092');
    await new Promise(resolve => setTimeout(resolve, 600));
    await fillInput('#phoneNumber', '+91 98765 43210');
    await new Promise(resolve => setTimeout(resolve, 600));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '04_portal_step_2.png') });
    console.log('Captured: 04_portal_step_2.png');

    console.log('Clicking Next Step 2...');
    await mainTab.click('#btn-next-2');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 3: ENTITY ---
    console.log('Filling Step 3: Economic Entity Info...');
    await mainTab.waitForSelector('#entityType');
    await mainTab.select('#entityType', 'MSME Small Enterprise');
    await mainTab.evaluate(() => {
      document.querySelector('#entityType').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 600));

    await fillInput('#landHolding', '5.5');
    await new Promise(resolve => setTimeout(resolve, 600));

    await mainTab.waitForSelector('#annualRevenue');
    await mainTab.select('#annualRevenue', '50,000 - 250,000');
    await mainTab.evaluate(() => {
      document.querySelector('#annualRevenue').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 600));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '05_portal_step_3.png') });
    console.log('Captured: 05_portal_step_3.png');

    console.log('Clicking Next Step 3...');
    await mainTab.click('#btn-next-3');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 4: REVIEW & SUBMIT ---
    console.log('Filling Step 4: Audit & Regulatory Declarations...');
    await mainTab.waitForSelector('#auditConsent');
    await mainTab.click('#auditConsent');
    await mainTab.evaluate(() => {
      document.querySelector('#auditConsent').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 600));

    await fillInput('#declarationSignature', 'Aarav Sharma');
    await new Promise(resolve => setTimeout(resolve, 600));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '06_portal_step_4.png') });
    console.log('Captured: 06_portal_step_4.png');

    console.log('Submitting form...');
    await mainTab.click('#btn-submit');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await mainTab.screenshot({ path: path.join(screenshotsDir, '07_portal_success_receipt.png') });
    console.log('Captured: 07_portal_success_receipt.png');

    // Wait for all debounced input events to flush (300ms debounce + network)
    console.log('Waiting 4s for all step events to flush to service worker...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 8. Switch to popup to verify captured steps and stop recording
    console.log('Switching to popup to verify steps and stop recording...');
    await popupPage.bringToFront();
    // Re-navigate to force fresh hydration from session storage
    await popupPage.goto(popupUrl);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Dump popup state to see step count
    const popupText = await popupPage.evaluate(() => document.body.innerText);
    console.log('Popup text after reload:', popupText.substring(0, 500));

    await popupPage.screenshot({ path: path.join(screenshotsDir, '08_popup_steps_recorded.png') });
    console.log('Captured: 08_popup_steps_recorded.png');

    // Check step count
    const stepCountMatch = popupText.match(/(\d+)\s*Steps?/);
    console.log('Step count from popup:', stepCountMatch ? stepCountMatch[0] : 'NOT FOUND');

    // Type a name for the recording
    const nameInputExists = await popupPage.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      return inputs.map(i => ({ placeholder: i.getAttribute('placeholder') || 'none', value: i.value }));
    });
    console.log('Text inputs in popup:', JSON.stringify(nameInputExists));

    // Find the naming input by checking for the recording screen's input
    const nameSel = 'input[placeholder*="Custom"]';
    const nameExists = await popupPage.evaluate((sel) => !!document.querySelector(sel), nameSel);
    if (nameExists) {
      await popupPage.evaluate((sel) => { document.querySelector(sel).value = ''; }, nameSel);
      await popupPage.type(nameSel, 'Government KRP Multi-Page Portal Clearance');
    } else {
      // Fallback: type into whichever text input is available
      const inputs = await popupPage.$$('input[type="text"]');
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        await lastInput.click({ clickCount: 3 }); // select all
        await lastInput.type('Government KRP Multi-Page Portal Clearance');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, '09_popup_naming.png') });
    console.log('Captured: 09_popup_naming.png');

    // Click Stop & Save
    console.log('Clicking Stop & Save Recording...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Stop') && b.textContent.includes('Save'));
      if (saveBtn) {
        console.log('Clicking save button:', saveBtn.textContent.trim());
        saveBtn.click();
      } else {
        console.error('Save button not found! Available buttons:', buttons.map(b => b.textContent?.trim()));
      }
    });

    console.log('Waiting for IndexedDB write...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Final dashboard screenshot
    await popupPage.screenshot({ path: path.join(screenshotsDir, '10_popup_saved_flows_dashboard.png') });
    console.log('Captured: 10_popup_saved_flows_dashboard.png');

    // CRITICAL VALIDATION
    const dashboardCheck = await popupPage.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasFlowName: bodyText.includes('Government KRP') || bodyText.includes('Portal Clearance'),
        hasSavedFlows: bodyText.includes('Saved Automation Flows'),
        hasNoFlows: bodyText.includes('No recorded flows'),
        bodySnippet: bodyText.substring(0, 600)
      };
    });
    console.log('=== DASHBOARD VALIDATION ===');
    console.log(JSON.stringify(dashboardCheck, null, 2));

    if (dashboardCheck.hasNoFlows) {
      console.error('❌ FAILURE: Dashboard shows "No recorded flows" — recording was NOT saved!');
    } else if (dashboardCheck.hasFlowName) {
      console.log('✅ SUCCESS: Saved flow "Government KRP" appears on the dashboard!');
    } else {
      console.log('⚠️  PARTIAL: Dashboard has flows but name not found. Check screenshot.');
    }

    console.log('=== AUTOMATED LIVE VERIFICATION COMPLETED ===');
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
