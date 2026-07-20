import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.join(__dirname, 'dist');

async function run() {
  console.log('=== RECORDING AND PRINTING STEPS ===');
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
    await new Promise(resolve => setTimeout(resolve, 3000));
    const targets = await browser.targets();
    const bgTarget = targets.find(
      t => t.type() === 'service_worker' || t.type() === 'background_page'
    );
    if (!bgTarget) throw new Error('Failed to find extension service worker.');
    const extensionId = bgTarget.url().split('/')[2];
    
    const popupPage = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;
    await popupPage.goto(popupUrl);
    await popupPage.waitForSelector('input[type="text"]');

    const mainTab = await browser.newPage();
    await mainTab.setViewport({ width: 900, height: 750 });

    // Start recording
    await popupPage.bringToFront();
    await popupPage.evaluate(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'http://localhost:8080/jobs');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await popupPage.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) btn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 4000));

    await mainTab.bringToFront();

    async function fillInput(selector, value) {
      await mainTab.waitForSelector(selector, { timeout: 5000 });
      await mainTab.focus(selector);
      await mainTab.evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
      await mainTab.type(selector, value, { delay: 20 });
      await mainTab.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector);
    }

    // Fill Step 1
    await fillInput('#firstName', 'Jane');
    await fillInput('#lastName', 'Doe');
    await fillInput('#email', 'jane.doe@example.com');
    await fillInput('#phone', '+1 (555) 019-2834');
    await fillInput('#portfolioUrl', 'https://linkedin.com/in/janedoe');
    await mainTab.click('#btn-next-1');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Fill Step 2
    await mainTab.waitForSelector('#degreeLevel');
    await mainTab.select('#degreeLevel', "Bachelor's Degree");
    await mainTab.evaluate(() => {
      document.querySelector('#degreeLevel').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fillInput('#fieldOfStudy', 'Computer Science');
    await fillInput('#institution', 'Stanford University');
    await fillInput('#gradYear', '2022');
    await fillInput('#gpa', '3.85');
    await mainTab.click('#btn-next-2');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Fill Step 3
    await fillInput('#jobTitle', 'Software Engineer I');
    await fillInput('#company', 'Acme Corp');
    await fillInput('#experienceYears', '2');
    await mainTab.waitForSelector('#skills');
    await mainTab.select('#skills', 'Frontend');
    await mainTab.evaluate(() => {
      document.querySelector('#skills').dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Click checkbox
    await mainTab.waitForSelector('#currentlyEmployed');
    await mainTab.evaluate(() => {
      const el = document.querySelector('#currentlyEmployed');
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    await mainTab.click('#btn-next-3');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Fill Step 4
    await mainTab.waitForSelector('#desiredRole');
    await mainTab.select('#desiredRole', 'Mid Developer');
    await mainTab.evaluate(() => {
      document.querySelector('#desiredRole').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fillInput('#expectedSalary', '115000');
    await mainTab.waitForSelector('#noticePeriod');
    await mainTab.select('#noticePeriod', '1 Month');
    await mainTab.evaluate(() => {
      document.querySelector('#noticePeriod').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await mainTab.waitForSelector('#workPreference');
    await mainTab.select('#workPreference', 'Remote');
    await mainTab.evaluate(() => {
      document.querySelector('#workPreference').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await mainTab.click('#btn-next-4');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Fill Step 5
    await mainTab.waitForSelector('#agreeTerms');
    await mainTab.evaluate(() => {
      const el = document.querySelector('#agreeTerms');
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fillInput('#digitalSignature', 'Jane Doe');
    await mainTab.click('#btn-submit');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Switch to popup and stop recording
    await popupPage.bringToFront();
    await popupPage.goto(popupUrl);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Type name
    const inputs = await popupPage.$$('input[type="text"]');
    if (inputs.length > 0) {
      const lastInput = inputs[inputs.length - 1];
      await lastInput.click({ clickCount: 3 });
      await lastInput.type('Job Portal Flow For Printing');
    }

    await popupPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Stop') && b.textContent.includes('Save'));
      if (saveBtn) saveBtn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 4000));

    // Retrieve steps from IndexedDB and print them
    const steps = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('FormPilotDB');
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['recordings'], 'readonly');
          const store = tx.objectStore('recordings');
          const getReq = store.getAll();
          getReq.onsuccess = () => {
            const flows = getReq.result;
            const flow = flows.find(f => f.name.includes('Job Portal Flow For Printing'));
            resolve(flow ? flow.steps : []);
          };
          getReq.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      });
    });

    console.log('=== RECORDED STEPS ===');
    steps.forEach((step, index) => {
      console.log(`${index + 1}. Action: ${step.action}, Selector: ${step.selector}, Value: ${step.value}, Checked: ${step.checked}`);
    });

  } catch (err) {
    console.error('Error during run:', err);
  } finally {
    await browser.close();
  }
}

run();
