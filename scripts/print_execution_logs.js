import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.join(__dirname, 'dist');

async function run() {
  console.log('=== READING INDEXEDDB LOGS ===');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
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
    await popupPage.waitForSelector('body');

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
          getReq.onsuccess = () => {
            resolve(getReq.result);
          };
          getReq.onerror = () => {
            resolve([]);
          };
        };
        req.onerror = () => resolve([]);
      });
    });

    console.log(`Retrieved ${logs.length} log entries from IndexedDB:`);
    console.log(JSON.stringify(logs, null, 2));

  } catch (err) {
    console.error('Error reading logs:', err);
  } finally {
    await browser.close();
  }
}

run();
