import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension details
const extensionPath = path.join(__dirname, 'dist');
const screenshotsDir = 'C:\\Users\\rawal\\.gemini\\antigravity-ide\\brain\\74c58e56-87ab-4a28-88b1-70cb24ea2540\\screenshots';

async function run() {
  console.log('=== STARTING AUTOMATED LIVE VERIFICATION SCRIPT FOR JOB PORTAL ===');
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
    const mainTab = pages[0] || await browser.newPage();
    mainTab.on('console', msg => console.log(`[TAB LOG] ${msg.text()}`));
    mainTab.on('pageerror', err => console.error(`[TAB ERROR] ${err.message}`));
    await mainTab.setViewport({ width: 900, height: 750 });

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

    // Type job portal URL into the popup
    await popupPage.evaluate(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'http://localhost:8080/jobs');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await popupPage.screenshot({ path: path.join(screenshotsDir, 'job_01_popup_pre_record.png') });
    console.log('Captured: job_01_popup_pre_record.png');

    // Click Record
    console.log('Clicking Record button...');
    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
      else console.error('Record button not found!');
    });

    // Wait for mainTab to navigate to the job portal
    console.log('Waiting for tab navigation and content script injection...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    const currentUrl = mainTab.url();
    console.log('Main tab URL after Record:', currentUrl);

    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify popup state
    await popupPage.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, 'job_02_popup_recording_started.png') });
    console.log('Captured: job_02_popup_recording_started.png');

    // Back to main tab
    await mainTab.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Helper: fill an input with proper events for recorder
    async function fillInput(selector, value) {
      await mainTab.waitForSelector(selector, { timeout: 5000 });
      await mainTab.focus(selector);
      await mainTab.evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
      await mainTab.type(selector, value, { delay: 40 });
      await mainTab.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector);
    }

    // --- STEP 1: PERSONAL ---
    console.log('Filling Step 1: Personal Details...');
    await fillInput('#firstName', 'Jane');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#lastName', 'Doe');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#email', 'jane.doe@example.com');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#phone', '+1 (555) 019-2834');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#portfolioUrl', 'https://linkedin.com/in/janedoe');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, 'job_03_portal_step_1.png') });
    console.log('Captured: job_03_portal_step_1.png');

    console.log('Clicking Next Step 1...');
    await mainTab.click('#btn-next-1');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 2: EDUCATION ---
    console.log('Filling Step 2: Education History...');
    await mainTab.waitForSelector('#degreeLevel');
    await mainTab.select('#degreeLevel', "Bachelor's Degree");
    await mainTab.evaluate(() => {
      document.querySelector('#degreeLevel').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#fieldOfStudy', 'Computer Science');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#institution', 'Stanford University');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#gradYear', '2022');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#gpa', '3.85');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, 'job_04_portal_step_2.png') });
    console.log('Captured: job_04_portal_step_2.png');

    console.log('Clicking Next Step 2...');
    await mainTab.click('#btn-next-2');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 3: EXPERIENCE ---
    console.log('Filling Step 3: Work Experience...');
    await fillInput('#jobTitle', 'Software Engineer I');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#company', 'Acme Corp');
    await new Promise(resolve => setTimeout(resolve, 500));
    await fillInput('#experienceYears', '2');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.waitForSelector('#skills');
    await mainTab.select('#skills', 'Frontend');
    await mainTab.evaluate(() => {
      document.querySelector('#skills').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click currentlyEmployed checkbox
    await mainTab.waitForSelector('#currentlyEmployed');
    await mainTab.evaluate(() => {
      const el = document.querySelector('#currentlyEmployed');
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, 'job_05_portal_step_3.png') });
    console.log('Captured: job_05_portal_step_3.png');

    console.log('Clicking Next Step 3...');
    await mainTab.click('#btn-next-3');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 4: PREFERENCES ---
    console.log('Filling Step 4: Role Preferences...');
    await mainTab.waitForSelector('#desiredRole');
    await mainTab.select('#desiredRole', 'Mid Developer');
    await mainTab.evaluate(() => {
      document.querySelector('#desiredRole').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#expectedSalary', '115000');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.waitForSelector('#noticePeriod');
    await mainTab.select('#noticePeriod', '1 Month');
    await mainTab.evaluate(() => {
      document.querySelector('#noticePeriod').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.waitForSelector('#workPreference');
    await mainTab.select('#workPreference', 'Remote');
    await mainTab.evaluate(() => {
      document.querySelector('#workPreference').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, 'job_06_portal_step_4.png') });
    console.log('Captured: job_06_portal_step_4.png');

    console.log('Clicking Next Step 4...');
    await mainTab.click('#btn-next-4');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 5: REVIEW & SUBMIT ---
    console.log('Filling Step 5: Review & Submit...');
    await mainTab.waitForSelector('#agreeTerms');
    await mainTab.evaluate(() => {
      const el = document.querySelector('#agreeTerms');
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await fillInput('#digitalSignature', 'Jane Doe');
    await new Promise(resolve => setTimeout(resolve, 500));

    await mainTab.screenshot({ path: path.join(screenshotsDir, 'job_07_portal_step_5.png') });
    console.log('Captured: job_07_portal_step_5.png');

    console.log('Submitting application...');
    await mainTab.click('#btn-submit');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await mainTab.screenshot({ path: path.join(screenshotsDir, 'job_08_portal_success_receipt.png') });
    console.log('Captured: job_08_portal_success_receipt.png');

    console.log('Waiting 4s for all step events to flush to service worker...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 8. Switch to popup to verify steps and save
    console.log('Switching to popup to verify steps and stop recording...');
    await popupPage.bringToFront();
    await popupPage.goto(popupUrl);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const popupText = await popupPage.evaluate(() => document.body.innerText);
    console.log('Popup text after reload:', popupText.substring(0, 500));

    await popupPage.screenshot({ path: path.join(screenshotsDir, 'job_09_popup_steps_recorded.png') });
    console.log('Captured: job_09_popup_steps_recorded.png');

    // Naming input
    const nameSel = 'input[placeholder*="Custom"]';
    const nameExists = await popupPage.evaluate((sel) => !!document.querySelector(sel), nameSel);
    if (nameExists) {
      await popupPage.evaluate((sel) => { document.querySelector(sel).value = ''; }, nameSel);
      await popupPage.type(nameSel, 'Global Careers Job Application');
    } else {
      const inputs = await popupPage.$$('input[type="text"]');
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        await lastInput.click({ clickCount: 3 });
        await lastInput.type('Global Careers Job Application');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await popupPage.screenshot({ path: path.join(screenshotsDir, 'job_10_popup_naming.png') });
    console.log('Captured: job_10_popup_naming.png');

    console.log('Clicking Stop & Save Recording...');
    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Stop') && b.textContent.includes('Save'));
      if (saveBtn) {
        console.log('Clicking save button:', saveBtn.textContent.trim());
        saveBtn.click();
      } else {
        console.error('Save button not found!');
      }
    });

    console.log('Waiting for IndexedDB write...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await popupPage.screenshot({ path: path.join(screenshotsDir, 'job_11_popup_saved_flows_dashboard.png') });
    console.log('Captured: job_11_popup_saved_flows_dashboard.png');

    const dashboardCheck = await popupPage.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasFlowName: bodyText.includes('Global Careers') || bodyText.includes('Job Application'),
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
      console.log('✅ SUCCESS: Saved flow "Global Careers Job Application" appears on the dashboard!');
    } else {
      console.log('⚠️  PARTIAL: Check screenshot.');
    }

    console.log('=== AUTOMATED LIVE VERIFICATION COMPLETED ===');
  } catch (err) {
    console.error('ERROR OCCURRED DURING TEST:', err);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
