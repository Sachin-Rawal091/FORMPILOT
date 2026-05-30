/**
 * FormPilot — DIRECT INJECTION Live Demo
 * 
 * Strategy: Instead of trying to record via DOM events (which Puppeteer synthetic
 * events bypass), we directly inject a pre-built recording into the extension's
 * IndexedDB and pre-seeded Excel data, then trigger execution via the popup UI.
 * 
 * This demonstrates the EXECUTION phase live — exactly what the product does
 * in production when a user has already recorded a flow and uploaded data.
 *
 * Usage: node run_live_demo_v2.js
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath  = path.join(__dirname, 'dist');
const screenshotsDir = path.join(__dirname, 'live_demo_screenshots');
const PORTAL_URL     = 'http://localhost:8080/krp';
const TOTAL_ROWS     = 10;

// ─── Action enum values (must match src/types/index.ts) ──────────────────────
const Action = {
  FILL:            0,
  CLICK:           1,
  SELECT:          2,
  SELECT_RADIO:    3,
  TOGGLE_CHECKBOX: 4,
  WAIT:            5,
  SCROLL:          6,
  SUBMIT:          7,
  FILE_UPLOAD:     8,
  RICH_TEXT:       9,
  NAVIGATE_NEXT:   10,
  MANUAL_IFRAME:   11,
  DATEPICKER:      12,
};

// ─── Pre-built KRP portal recording steps ────────────────────────────────────
const RECORDING_ID = 'krp-demo-recording-001';

const KRP_STEPS = [
  // ── Step 1: Identity ─────────────────────────────────────────────────────
  {
    id: 'step-001', action: Action.FILL, pageId: 'page-1',
    selector: '#fullName',
    selectorMeta: { id: 'fullName', name: 'fullName', placeholder: 'As per national ID document' },
    columnName: 'Full Legal Name', required: true,
  },
  {
    id: 'step-002', action: Action.FILL, pageId: 'page-1',
    selector: '#birthDate',
    selectorMeta: { id: 'birthDate', name: 'birthDate' },
    columnName: 'Date of Birth', required: true,
  },
  {
    id: 'step-003', action: Action.FILL, pageId: 'page-1',
    selector: '#identityNumber',
    selectorMeta: { id: 'identityNumber', name: 'identityNumber', placeholder: 'KRP-XXXX-XX' },
    columnName: 'National ID Number', required: true,
  },
  {
    id: 'step-004', action: Action.SELECT, pageId: 'page-1',
    selector: '#gender',
    selectorMeta: { id: 'gender', name: 'gender' },
    columnName: 'Gender', required: false,
  },
  {
    id: 'step-005', action: Action.NAVIGATE_NEXT, pageId: 'page-1',
    selector: '#btn-next-1',
    selectorMeta: { id: 'btn-next-1' },
  },
  // ── Step 2: Address ──────────────────────────────────────────────────────
  {
    id: 'step-006', action: Action.FILL, pageId: 'page-2',
    selector: '#addressLine',
    selectorMeta: { id: 'addressLine', name: 'addressLine', placeholder: 'House No., Street, Colony / Area' },
    columnName: 'Street Address', required: true,
  },
  {
    id: 'step-007', action: Action.SELECT, pageId: 'page-2',
    selector: '#stateRegion',
    selectorMeta: { id: 'stateRegion', name: 'stateRegion' },
    columnName: 'State / Province', required: true,
  },
  {
    id: 'step-008', action: Action.FILL, pageId: 'page-2',
    selector: '#postalCode',
    selectorMeta: { id: 'postalCode', name: 'postalCode', placeholder: '6-digit PIN' },
    columnName: 'Postal Code / Zip', required: true,
  },
  {
    id: 'step-009', action: Action.FILL, pageId: 'page-2',
    selector: '#phoneNumber',
    selectorMeta: { id: 'phoneNumber', name: 'phoneNumber', placeholder: '+91 XXXXX XXXXX' },
    columnName: 'Primary Contact Number', required: true,
  },
  {
    id: 'step-010', action: Action.NAVIGATE_NEXT, pageId: 'page-2',
    selector: '#btn-next-2',
    selectorMeta: { id: 'btn-next-2' },
  },
  // ── Step 3: Entity ───────────────────────────────────────────────────────
  {
    id: 'step-011', action: Action.SELECT, pageId: 'page-3',
    selector: '#entityType',
    selectorMeta: { id: 'entityType', name: 'entityType' },
    columnName: 'Registration Entity Type', required: true,
  },
  {
    id: 'step-012', action: Action.FILL, pageId: 'page-3',
    selector: '#landHolding',
    selectorMeta: { id: 'landHolding', name: 'landHolding', placeholder: 'e.g., 5.5' },
    columnName: 'Land Holding / Office Size (Acres)', required: false,
  },
  {
    id: 'step-013', action: Action.SELECT, pageId: 'page-3',
    selector: '#annualRevenue',
    selectorMeta: { id: 'annualRevenue', name: 'annualRevenue' },
    columnName: 'Estimated Annual Revenue (KRP Credit)', required: false,
  },
  {
    id: 'step-014', action: Action.NAVIGATE_NEXT, pageId: 'page-3',
    selector: '#btn-next-3',
    selectorMeta: { id: 'btn-next-3' },
  },
  // ── Step 4: Declaration ──────────────────────────────────────────────────
  {
    id: 'step-015', action: Action.TOGGLE_CHECKBOX, pageId: 'page-4',
    selector: '#auditConsent',
    selectorMeta: { id: 'auditConsent', name: 'auditConsent' },
    checked: true,
  },
  {
    id: 'step-016', action: Action.FILL, pageId: 'page-4',
    selector: '#declarationSignature',
    selectorMeta: { id: 'declarationSignature', name: 'declarationSignature', placeholder: 'Type your full legal name to sign' },
    columnName: 'Signature Acknowledgment', required: true,
  },
  {
    id: 'step-017', action: Action.SUBMIT, pageId: 'page-4',
    selector: '#btn-submit',
    selectorMeta: { id: 'btn-submit' },
  },
];

const KRP_RECORDING = {
  id: RECORDING_ID,
  name: 'KRP Government Portal — 10 Row Demo',
  siteUrl: PORTAL_URL,
  siteId: 'localhost',
  steps: KRP_STEPS,
  pages: [
    { id: 'page-1', urlPattern: 'localhost:8080/krp' },
    { id: 'page-2', urlPattern: 'localhost:8080/krp' },
    { id: 'page-3', urlPattern: 'localhost:8080/krp' },
    { id: 'page-4', urlPattern: 'localhost:8080/krp' },
  ],
  pageCount: 4,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: 1,
};

// ─── 10-row Excel data matching KRP field columns ─────────────────────────────
const KRP_EXCEL_ROWS = [
  { rowIndex: 0, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Aarav Sharma',   'Date of Birth': '1994-08-15', 'National ID Number': 'KRP-9821-X9', 'Gender': 'Male',   'Street Address': '128 Green Valley Road, Sector 4',           'State / Province': 'North KRP',       'Postal Code / Zip': '560092', 'Primary Contact Number': '+91 98765 43210', 'Registration Entity Type': 'MSME Small Enterprise',     'Land Holding / Office Size (Acres)': 5.5,  'Estimated Annual Revenue (KRP Credit)': '50,000 - 250,000', 'Audit Consent': 'true', 'Signature Acknowledgment': 'Aarav Sharma'   } },
  { rowIndex: 1, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Priya Patel',    'Date of Birth': '1991-03-24', 'National ID Number': 'KRP-1049-P2', 'Gender': 'Female', 'Street Address': '45 Blue Ridge Colony',                        'State / Province': 'South KRP',       'Postal Code / Zip': '600028', 'Primary Contact Number': '+91 91234 56789', 'Registration Entity Type': 'Independent Professional',  'Land Holding / Office Size (Acres)': 1.2,  'Estimated Annual Revenue (KRP Credit)': 'Above 250,000',    'Audit Consent': 'true', 'Signature Acknowledgment': 'Priya Patel'    } },
  { rowIndex: 2, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Rajesh Kumar',   'Date of Birth': '1985-11-02', 'National ID Number': 'KRP-4820-K7', 'Gender': 'Male',   'Street Address': 'Farm 12, West Valley Outskirts',             'State / Province': 'West Valley',     'Postal Code / Zip': '411005', 'Primary Contact Number': '+91 94455 66778', 'Registration Entity Type': 'Agricultural Farmer',       'Land Holding / Office Size (Acres)': 12.4, 'Estimated Annual Revenue (KRP Credit)': 'Under 50,000',     'Audit Consent': 'true', 'Signature Acknowledgment': 'Rajesh Kumar'   } },
  { rowIndex: 3, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Ananya Sen',     'Date of Birth': '1996-05-19', 'National ID Number': 'KRP-7712-S3', 'Gender': 'Female', 'Street Address': 'Flat 4B, Heritage Apartments, Capital Road',  'State / Province': 'Capital District','Postal Code / Zip': '700019', 'Primary Contact Number': '+91 98300 12345', 'Registration Entity Type': 'MSME Small Enterprise',     'Land Holding / Office Size (Acres)': 0.5,  'Estimated Annual Revenue (KRP Credit)': '50,000 - 250,000', 'Audit Consent': 'true', 'Signature Acknowledgment': 'Ananya Sen'     } },
  { rowIndex: 4, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Vikram Singh',   'Date of Birth': '1988-09-09', 'National ID Number': 'KRP-3091-V5', 'Gender': 'Male',   'Street Address': '88 North Gate Boulevard',                    'State / Province': 'North KRP',       'Postal Code / Zip': '560098', 'Primary Contact Number': '+91 98800 55443', 'Registration Entity Type': 'Independent Professional',  'Land Holding / Office Size (Acres)': 2.8,  'Estimated Annual Revenue (KRP Credit)': 'Above 250,000',    'Audit Consent': 'true', 'Signature Acknowledgment': 'Vikram Singh'   } },
  { rowIndex: 5, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Meera Nair',     'Date of Birth': '1993-12-12', 'National ID Number': 'KRP-2983-N4', 'Gender': 'Female', 'Street Address': '15 Coconut Grove Road',                       'State / Province': 'South KRP',       'Postal Code / Zip': '682011', 'Primary Contact Number': '+91 99470 11223', 'Registration Entity Type': 'MSME Small Enterprise',     'Land Holding / Office Size (Acres)': 4.2,  'Estimated Annual Revenue (KRP Credit)': '50,000 - 250,000', 'Audit Consent': 'true', 'Signature Acknowledgment': 'Meera Nair'     } },
  { rowIndex: 6, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Amit Hegde',     'Date of Birth': '1982-02-28', 'National ID Number': 'KRP-9304-H1', 'Gender': 'Male',   'Street Address': 'Greenacres Farmstead, Valley Area',           'State / Province': 'West Valley',     'Postal Code / Zip': '411038', 'Primary Contact Number': '+91 94220 88990', 'Registration Entity Type': 'Agricultural Farmer',       'Land Holding / Office Size (Acres)': 25.0, 'Estimated Annual Revenue (KRP Credit)': 'Above 250,000',    'Audit Consent': 'true', 'Signature Acknowledgment': 'Amit Hegde'     } },
  { rowIndex: 7, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Siddharth Roy',  'Date of Birth': '1990-07-07', 'National ID Number': 'KRP-6184-R9', 'Gender': 'Male',   'Street Address': '304 Crescent Heights, District Core',         'State / Province': 'Capital District','Postal Code / Zip': '700091', 'Primary Contact Number': '+91 98311 99887', 'Registration Entity Type': 'Independent Professional',  'Land Holding / Office Size (Acres)': 1.5,  'Estimated Annual Revenue (KRP Credit)': '50,000 - 250,000', 'Audit Consent': 'true', 'Signature Acknowledgment': 'Siddharth Roy'  } },
  { rowIndex: 8, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Kavitha Rao',    'Date of Birth': '1995-10-31', 'National ID Number': 'KRP-5290-R2', 'Gender': 'Female', 'Street Address': 'Sector 3, Main Market Area',                  'State / Province': 'North KRP',       'Postal Code / Zip': '560012', 'Primary Contact Number': '+91 98450 98450', 'Registration Entity Type': 'MSME Small Enterprise',     'Land Holding / Office Size (Acres)': 3.0,  'Estimated Annual Revenue (KRP Credit)': 'Under 50,000',     'Audit Consent': 'true', 'Signature Acknowledgment': 'Kavitha Rao'    } },
  { rowIndex: 9, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Suresh Pillai',  'Date of Birth': '1978-04-05', 'National ID Number': 'KRP-8120-P8', 'Gender': 'Male',   'Street Address': '104 Temple View Lane',                        'State / Province': 'South KRP',       'Postal Code / Zip': '600004', 'Primary Contact Number': '+91 98401 23456', 'Registration Entity Type': 'Agricultural Farmer',       'Land Holding / Office Size (Acres)': 8.5,  'Estimated Annual Revenue (KRP Credit)': '50,000 - 250,000', 'Audit Consent': 'true', 'Signature Acknowledgment': 'Suresh Pillai'  } },
];

// ─── Utility ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function screenshot(page, name) {
  const p = path.join(screenshotsDir, name);
  await page.screenshot({ path: p });
  console.log(`  📸  ${name}`);
}

// ─── IndexedDB injection helpers ─────────────────────────────────────────────

async function injectRecordingIntoIDB(page, recording, excelRows) {
  return await page.evaluate(async (rec, rows) => {
    return new Promise((resolve) => {
      // Open at version 2 to match the extension's DB schema (db.ts DB_VERSION = 2)
      const request = indexedDB.open('FormPilotDB', 2);

      // Only fires if DB doesn't exist yet — extension's getDB() call normally handles this.
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('excelData'))  db.createObjectStore('excelData',  { keyPath: 'rowIndex' });
        if (!db.objectStoreNames.contains('logs'))       db.createObjectStore('logs',       { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sessions'))   db.createObjectStore('sessions',   { keyPath: 'sessionId' });
        if (!db.objectStoreNames.contains('files'))      db.createObjectStore('files',      { keyPath: 'alias' });
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        try {
          const tx = db.transaction(['recordings', 'excelData'], 'readwrite');
          tx.objectStore('recordings').put(rec);
          // Clear existing excel data first, then put all rows
          tx.objectStore('excelData').clear();
          for (const row of rows) {
            tx.objectStore('excelData').put(row);
          }
          tx.oncomplete = () => resolve({ success: true, recordingId: rec.id, rowCount: rows.length });
          tx.onerror   = () => resolve({ error: tx.error?.message || 'tx error' });
        } catch (e) {
          resolve({ error: String(e) });
        }
      };

      request.onerror   = () => resolve({ error: request.error?.message || 'open error' });
      request.onblocked = () => resolve({ error: 'IDB open blocked — close other tabs using this DB' });
    });
  }, recording, excelRows);
}

async function readIDBRecording(page, recordingId) {
  return await page.evaluate(async (id) => {
    return new Promise((resolve) => {
      const request = indexedDB.open('FormPilotDB', 2);
      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('recordings')) { resolve(null); return; }
        const tx = db.transaction(['recordings'], 'readonly');
        const store = tx.objectStore('recordings');
        const get = store.get(id);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  }, recordingId);
}

async function readIDBExcelCount(page) {
  return await page.evaluate(async () => {
    return new Promise((resolve) => {
      const request = indexedDB.open('FormPilotDB', 2);
      request.onsuccess = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('excelData')) { resolve(0); return; }
        const tx = db.transaction(['excelData'], 'readonly');
        const store = tx.objectStore('excelData');
        const count = store.count();
        count.onsuccess = () => resolve(count.result);
        count.onerror = () => resolve(0);
      };
      request.onerror = () => resolve(0);
    });
  });
}

// ─── Save recording index to chrome.storage.local via content script ──────────
async function saveRecordingIndex(page, extensionId, recording) {
  // The popup reads recordings from IndexedDB; we also need to save the index
  // to chrome.storage.local. We do this via the popup page's evaluate context
  // which has access to the chrome API.
  return await page.evaluate(async (rec) => {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        resolve({ error: 'chrome not available' });
        return;
      }
      
      const indexEntry = {
        id: rec.id,
        name: rec.name,
        siteUrl: rec.siteUrl,
        siteId: rec.siteId,
        pageCount: rec.pageCount,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        version: rec.version,
      };
      
      chrome.storage.local.get(['recordings_index'], (result) => {
        const existingIndex = result.recordings_index || [];
        const filtered = existingIndex.filter(r => r.id !== rec.id);
        const newIndex = [indexEntry, ...filtered];
        chrome.storage.local.set({ recordings_index: newIndex }, () => {
          resolve({ success: true, count: newIndex.length });
        });
      });
    });
  }, recording);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  FormPilot — LIVE 10-Row Chrome Demo (Direct Injection Mode) ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(extensionPath)) {
    console.error('❌  Extension dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // ── 1. Launch Chrome with extension ─────────────────────────────────────
  console.log('🚀  Launching Chrome with FormPilot extension...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1440,900',
    ]
  });

  try {
    await sleep(3000);

    // ── 2. Get extension ID ──────────────────────────────────────────────
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.type() === 'service_worker' || t.type() === 'background_page');
    if (!swTarget) throw new Error('Extension service worker not found.');
    const extensionId = swTarget.url().split('/')[2];
    console.log(`✅  Extension ID: ${extensionId}\n`);

    const popupUrl = `chrome-extension://${extensionId}/public/popup.html`;

    // ── 3. Open popup and inject recording + data ─────────────────────────
    console.log('📦  Step 1: Injecting recording & 10-row Excel data into FormPilot...');
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => {
      const text = msg.text();
      if (!text.includes('[vite]') && !text.includes('DevTools')) {
        console.log(`  [Popup] ${text}`);
      }
    });
    await popupPage.setViewport({ width: 420, height: 680 });
    await popupPage.goto(popupUrl, { waitUntil: 'networkidle0' });
    await sleep(2000);
    await screenshot(popupPage, '01_popup_home.png');

    // Inject recording into IndexedDB (from popup context — has access to FormPilotDB)
    const injectResult = await injectRecordingIntoIDB(popupPage, KRP_RECORDING, KRP_EXCEL_ROWS);
    console.log(`  ✅  IDB injection: ${JSON.stringify(injectResult)}`);

    // Save recording index to chrome.storage.local
    const indexResult = await saveRecordingIndex(popupPage, extensionId, KRP_RECORDING);
    console.log(`  ✅  Storage index: ${JSON.stringify(indexResult)}`);

    // Verify injection
    const storedRec = await readIDBRecording(popupPage, RECORDING_ID);
    const storedCount = await readIDBExcelCount(popupPage);
    console.log(`  ✅  Verified: Recording="${storedRec?.name}", Excel rows=${storedCount}`);

    // ── 4. Reload popup to load the injected recording ───────────────────
    console.log('\n🔄  Step 2: Reloading popup to display injected recording...');
    await popupPage.reload({ waitUntil: 'networkidle0' });
    await sleep(2000);
    await screenshot(popupPage, '02_popup_with_recording.png');

    // ── 5. Navigate portal to KRP ────────────────────────────────────────
    console.log('\n🌐  Step 3: Loading KRP Government Portal...');
    const pages = await browser.pages();
    const portalPage = pages[0] || await browser.newPage();
    portalPage.on('console', msg => {
      const text = msg.text();
      if (text.startsWith('[Executor]') || text.startsWith('FormPilot')) {
        console.log(`  [Portal] ${text}`);
      }
    });
    await portalPage.setViewport({ width: 1000, height: 900 });
    await portalPage.goto(PORTAL_URL, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await screenshot(portalPage, '03_portal_fresh.png');
    console.log('  ✅  Portal loaded — ready for automation.');

    // ── 6. Trigger execution via popup's chrome.runtime ─────────────────
    console.log('\n▶️   Step 4: Starting FormPilot automation for ALL 10 rows...');
    
    // Get the active tab ID (portal tab)
    const portalTargetId = portalPage.target()._targetId;

    // Trigger START_EXECUTION via popup's chrome.runtime.sendMessage
    const execResult = await popupPage.evaluate(async (recId, totalRows) => {
      return new Promise((resolve) => {
        if (typeof chrome === 'undefined') {
          resolve({ error: 'No chrome API' });
          return;
        }

        const sessionId = 'demo-session-' + Math.random().toString(36).substr(2, 9);
        
        // First get the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          const tabId = tab?.id || -1;
          
          console.log(`[Demo] Sending START_EXECUTION to tab ${tabId}, recording=${recId}, session=${sessionId}`);
          
          // MessageType.START_EXECUTION = 2
          chrome.runtime.sendMessage({
            type: 2, // START_EXECUTION
            payload: { recordingId: recId, sessionId, totalRows },
            sessionId: sessionId,
            tabId: tabId,
            timestamp: Date.now()
          }, (response) => {
            resolve({ 
              sessionId,
              tabId,
              response: response || chrome.runtime.lastError?.message || 'no response'
            });
          });
        });
      });
    }, RECORDING_ID, TOTAL_ROWS);

    console.log(`  ✅  Execution triggered: ${JSON.stringify(execResult)}`);
    await sleep(2000);
    await screenshot(popupPage, '04_popup_execution_started.png');

    // ── 7. Monitor all 10 rows live ──────────────────────────────────────
    console.log('\n👁️   Monitoring 10-row live execution...\n');

    let completed = 0;
    for (let row = 1; row <= TOTAL_ROWS; row++) {
      console.log(`\n  ═══ ROW ${row} of ${TOTAL_ROWS} — ${KRP_EXCEL_ROWS[row-1].data['Full Legal Name']} ═══`);

      // Wait for execution to show progress in popup (STATE_UPDATE messages)
      try {
        await popupPage.bringToFront();
        await popupPage.waitForFunction(
          (r, total) => {
            const t = document.body.innerText;
            return (
              t.includes(`${r} of ${total}`) ||
              t.includes(`Row ${r}`) ||
              t.includes(`row ${r}`) ||
              (r >= total && (t.includes('Complete') || t.includes('Finished') || t.includes('finished')))
            );
          },
          { timeout: 90000 },
          row, TOTAL_ROWS
        );
        console.log(`  ✅  Row ${row}: Progress detected in popup.`);
      } catch {
        console.log(`  ⚠️  Row ${row}: Popup signal timeout — capturing state anyway.`);
      }

      // Switch to portal to observe filling
      await portalPage.bringToFront();
      await sleep(1200);

      // Wait for receipt overlay (form completed)
      try {
        await portalPage.waitForSelector('#receipt-overlay.receipt-active', { timeout: 25000 });
        console.log(`  🎉  Row ${row}: Government Clearance Approved receipt shown!`);
        completed++;
      } catch {
        console.log(`  ℹ️  Row ${row}: Receipt may have been auto-dismissed.`);
      }

      await screenshot(portalPage, `05_row${String(row).padStart(2,'0')}_portal_filled.png`);
      
      // Switch to popup to capture status
      await popupPage.bringToFront();
      await sleep(600);
      await screenshot(popupPage, `06_row${String(row).padStart(2,'0')}_popup_status.png`);
    }

    // ── 8. Final completion screenshot ──────────────────────────────────
    console.log('\n⏳  Waiting for final completion signal...');
    try {
      await popupPage.bringToFront();
      await popupPage.waitForFunction(
        () => {
          const t = document.body.innerText;
          return t.includes('Complete') || t.includes('Finished') || t.includes('10/10') || t.includes('10 of 10');
        },
        { timeout: 45000 }
      );
    } catch { /* continue */ }

    await screenshot(popupPage, '07_FINAL_popup_complete.png');
    await screenshot(portalPage, '08_FINAL_portal_state.png');

    console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅  DEMO COMPLETE! ${completed}/${TOTAL_ROWS} rows automated in Chrome!       ║`);
    console.log(`║  📸  Screenshots → live_demo_screenshots/                     ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════╝\n`);

    // Keep browser open so user can see the result
    console.log('🔍  Browser staying open for 20 seconds for live inspection...');
    await sleep(20000);

  } catch (err) {
    console.error('\n❌  Demo failed:', err.message);
    console.error(err.stack);
    try {
      const allPages = await browser.pages();
      for (let i = 0; i < allPages.length; i++) {
        await allPages[i].screenshot({ path: path.join(screenshotsDir, `CRASH_page${i}.png`) }).catch(() => {});
      }
    } catch {}
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
