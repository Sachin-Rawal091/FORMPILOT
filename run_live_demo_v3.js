/**
 * FormPilot — Live Demo v3 (Final, Robust)
 * 
 * Strategy:
 *   1. Launch Chrome with the extension loaded.
 *   2. Inject a pre-built KRP recording + 10-row data into IndexedDB.
 *   3. Navigate the portal to http://localhost:8080/krp.
 *   4. Send START_EXECUTION via chrome.runtime → content script executor begins.
 *   5. Monitor by listening to the portal's console output for "[Executor]" logs.
 *   6. Capture timed screenshots every ~8s to show live progress.
 *   7. Wait for EXECUTION_COMPLETE broadcast, then show final state.
 *
 * Usage: node run_live_demo_v3.js
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const extensionPath  = path.join(__dirname, 'dist');
const screenshotsDir = path.join(__dirname, 'live_demo_screenshots');
const PORTAL_URL     = 'http://localhost:8080/krp';
const TOTAL_ROWS     = 10;

// ─── Action enum (must match src/types/index.ts exactly) ─────────────────────
const A = {
  FILL: 0, CLICK: 1, SELECT: 2, SELECT_RADIO: 3, TOGGLE_CHECKBOX: 4,
  WAIT: 5, SCROLL: 6, SUBMIT: 7, FILE_UPLOAD: 8, RICH_TEXT: 9,
  NAVIGATE_NEXT: 10, MANUAL_IFRAME: 11, DATEPICKER: 12,
};

const RECORDING_ID = 'krp-demo-v3-001';

// ─── Pre-built 17-step recording for the KRP 4-step portal wizard ─────────────
const KRP_RECORDING = {
  id: RECORDING_ID,
  name: 'KRP Government Portal — Live 10 Row Demo',
  siteUrl: PORTAL_URL,
  siteId: 'localhost',
  pageCount: 4,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: 1,
  pages: [
    { id: 'page-1', urlPattern: 'localhost:8080/krp' },
    { id: 'page-2', urlPattern: 'localhost:8080/krp' },
    { id: 'page-3', urlPattern: 'localhost:8080/krp' },
    { id: 'page-4', urlPattern: 'localhost:8080/krp' },
  ],
  steps: [
    // ── Page 1: Identity ─────────────────────────────────────────────────────
    { id: 's01', action: A.FILL,            pageId: 'page-1', selector: '#fullName',           selectorMeta: { id: 'fullName', name: 'fullName' },             columnName: 'Full Legal Name',                         required: true  },
    { id: 's02', action: A.FILL,            pageId: 'page-1', selector: '#birthDate',          selectorMeta: { id: 'birthDate', name: 'birthDate' },           columnName: 'Date of Birth',                           required: true  },
    { id: 's03', action: A.FILL,            pageId: 'page-1', selector: '#identityNumber',     selectorMeta: { id: 'identityNumber', name: 'identityNumber' }, columnName: 'National ID Number',                      required: true  },
    { id: 's04', action: A.SELECT,          pageId: 'page-1', selector: '#gender',             selectorMeta: { id: 'gender', name: 'gender' },                 columnName: 'Gender',                                  required: false },
    { id: 's05', action: A.NAVIGATE_NEXT,   pageId: 'page-1', selector: '#btn-next-1',         selectorMeta: { id: 'btn-next-1' } },
    // ── Page 2: Address ──────────────────────────────────────────────────────
    { id: 's06', action: A.FILL,            pageId: 'page-2', selector: '#addressLine',        selectorMeta: { id: 'addressLine', name: 'addressLine' },       columnName: 'Street Address',                          required: true  },
    { id: 's07', action: A.SELECT,          pageId: 'page-2', selector: '#stateRegion',        selectorMeta: { id: 'stateRegion', name: 'stateRegion' },       columnName: 'State / Province',                        required: true  },
    { id: 's08', action: A.FILL,            pageId: 'page-2', selector: '#postalCode',         selectorMeta: { id: 'postalCode', name: 'postalCode' },         columnName: 'Postal Code / Zip',                       required: true  },
    { id: 's09', action: A.FILL,            pageId: 'page-2', selector: '#phoneNumber',        selectorMeta: { id: 'phoneNumber', name: 'phoneNumber' },       columnName: 'Primary Contact Number',                  required: true  },
    { id: 's10', action: A.NAVIGATE_NEXT,   pageId: 'page-2', selector: '#btn-next-2',         selectorMeta: { id: 'btn-next-2' } },
    // ── Page 3: Entity ───────────────────────────────────────────────────────
    { id: 's11', action: A.SELECT,          pageId: 'page-3', selector: '#entityType',         selectorMeta: { id: 'entityType', name: 'entityType' },         columnName: 'Registration Entity Type',                required: true  },
    { id: 's12', action: A.FILL,            pageId: 'page-3', selector: '#landHolding',        selectorMeta: { id: 'landHolding', name: 'landHolding' },       columnName: 'Land Holding (Acres)',                     required: false },
    { id: 's13', action: A.SELECT,          pageId: 'page-3', selector: '#annualRevenue',      selectorMeta: { id: 'annualRevenue', name: 'annualRevenue' },   columnName: 'Annual Revenue (KRP)',                     required: false },
    { id: 's14', action: A.NAVIGATE_NEXT,   pageId: 'page-3', selector: '#btn-next-3',         selectorMeta: { id: 'btn-next-3' } },
    // ── Page 4: Declaration ──────────────────────────────────────────────────
    { id: 's15', action: A.TOGGLE_CHECKBOX, pageId: 'page-4', selector: '#auditConsent',       selectorMeta: { id: 'auditConsent', name: 'auditConsent' },     checked: true },
    { id: 's16', action: A.FILL,            pageId: 'page-4', selector: '#declarationSignature',selectorMeta: { id: 'declarationSignature' },                  columnName: 'Signature',                               required: true  },
    { id: 's17', action: A.SUBMIT,          pageId: 'page-4', selector: '#btn-submit',         selectorMeta: { id: 'btn-submit' } },
  ],
};

// ─── 10 Rows — real Indian names, KRP-consistent data ────────────────────────
const EXCEL_ROWS = [
  { rowIndex: 0, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Aarav Sharma',    'Date of Birth': '1994-08-15', 'National ID Number': 'KRP-9821-X9', 'Gender': 'Male',   'Street Address': '128 Green Valley Road, Sector 4',            'State / Province': 'North KRP',        'Postal Code / Zip': '560092', 'Primary Contact Number': '+91 98765 43210', 'Registration Entity Type': 'MSME Small Enterprise',    'Land Holding (Acres)': '5.5',  'Annual Revenue (KRP)': '50,000 - 250,000', 'Signature': 'Aarav Sharma'    } },
  { rowIndex: 1, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Priya Patel',     'Date of Birth': '1991-03-24', 'National ID Number': 'KRP-1049-P2', 'Gender': 'Female', 'Street Address': '45 Blue Ridge Colony',                        'State / Province': 'South KRP',        'Postal Code / Zip': '600028', 'Primary Contact Number': '+91 91234 56789', 'Registration Entity Type': 'Independent Professional', 'Land Holding (Acres)': '1.2',  'Annual Revenue (KRP)': 'Above 250,000',    'Signature': 'Priya Patel'     } },
  { rowIndex: 2, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Rajesh Kumar',    'Date of Birth': '1985-11-02', 'National ID Number': 'KRP-4820-K7', 'Gender': 'Male',   'Street Address': 'Farm 12, West Valley Outskirts',              'State / Province': 'West Valley',      'Postal Code / Zip': '411005', 'Primary Contact Number': '+91 94455 66778', 'Registration Entity Type': 'Agricultural Farmer',      'Land Holding (Acres)': '12.4', 'Annual Revenue (KRP)': 'Under 50,000',     'Signature': 'Rajesh Kumar'    } },
  { rowIndex: 3, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Ananya Sen',      'Date of Birth': '1996-05-19', 'National ID Number': 'KRP-7712-S3', 'Gender': 'Female', 'Street Address': 'Flat 4B, Heritage Apartments, Capital Road',  'State / Province': 'Capital District', 'Postal Code / Zip': '700019', 'Primary Contact Number': '+91 98300 12345', 'Registration Entity Type': 'MSME Small Enterprise',    'Land Holding (Acres)': '0.5',  'Annual Revenue (KRP)': '50,000 - 250,000', 'Signature': 'Ananya Sen'      } },
  { rowIndex: 4, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Vikram Singh',    'Date of Birth': '1988-09-09', 'National ID Number': 'KRP-3091-V5', 'Gender': 'Male',   'Street Address': '88 North Gate Boulevard',                    'State / Province': 'North KRP',        'Postal Code / Zip': '560098', 'Primary Contact Number': '+91 98800 55443', 'Registration Entity Type': 'Independent Professional', 'Land Holding (Acres)': '2.8',  'Annual Revenue (KRP)': 'Above 250,000',    'Signature': 'Vikram Singh'    } },
  { rowIndex: 5, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Meera Nair',      'Date of Birth': '1993-12-12', 'National ID Number': 'KRP-2983-N4', 'Gender': 'Female', 'Street Address': '15 Coconut Grove Road',                       'State / Province': 'South KRP',        'Postal Code / Zip': '682011', 'Primary Contact Number': '+91 99470 11223', 'Registration Entity Type': 'MSME Small Enterprise',    'Land Holding (Acres)': '4.2',  'Annual Revenue (KRP)': '50,000 - 250,000', 'Signature': 'Meera Nair'      } },
  { rowIndex: 6, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Amit Hegde',      'Date of Birth': '1982-02-28', 'National ID Number': 'KRP-9304-H1', 'Gender': 'Male',   'Street Address': 'Greenacres Farmstead, Valley Area',           'State / Province': 'West Valley',      'Postal Code / Zip': '411038', 'Primary Contact Number': '+91 94220 88990', 'Registration Entity Type': 'Agricultural Farmer',      'Land Holding (Acres)': '25.0', 'Annual Revenue (KRP)': 'Above 250,000',    'Signature': 'Amit Hegde'      } },
  { rowIndex: 7, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Siddharth Roy',   'Date of Birth': '1990-07-07', 'National ID Number': 'KRP-6184-R9', 'Gender': 'Male',   'Street Address': '304 Crescent Heights, District Core',         'State / Province': 'Capital District', 'Postal Code / Zip': '700091', 'Primary Contact Number': '+91 98311 99887', 'Registration Entity Type': 'Independent Professional', 'Land Holding (Acres)': '1.5',  'Annual Revenue (KRP)': '50,000 - 250,000', 'Signature': 'Siddharth Roy'   } },
  { rowIndex: 8, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Kavitha Rao',     'Date of Birth': '1995-10-31', 'National ID Number': 'KRP-5290-R2', 'Gender': 'Female', 'Street Address': 'Sector 3, Main Market Area',                  'State / Province': 'North KRP',        'Postal Code / Zip': '560012', 'Primary Contact Number': '+91 98450 98450', 'Registration Entity Type': 'MSME Small Enterprise',    'Land Holding (Acres)': '3.0',  'Annual Revenue (KRP)': 'Under 50,000',     'Signature': 'Kavitha Rao'     } },
  { rowIndex: 9, status: 0, isValid: true, validationErrors: [], data: { 'Full Legal Name': 'Suresh Pillai',   'Date of Birth': '1978-04-05', 'National ID Number': 'KRP-8120-P8', 'Gender': 'Male',   'Street Address': '104 Temple View Lane',                        'State / Province': 'South KRP',        'Postal Code / Zip': '600004', 'Primary Contact Number': '+91 98401 23456', 'Registration Entity Type': 'Agricultural Farmer',      'Land Holding (Acres)': '8.5',  'Annual Revenue (KRP)': '50,000 - 250,000', 'Signature': 'Suresh Pillai'   } },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ssIndex = 0;
async function shot(page, label) {
  ssIndex++;
  const name = `${String(ssIndex).padStart(2,'0')}_${label}.png`;
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: false }).catch(() => {});
  console.log(`  📸  ${name}`);
  return name;
}

// ─── Inject recording + Excel rows directly into the extension's IDB ──────────
async function seedDatabase(page, recording, rows) {
  return await page.evaluate(async (rec, excelRows) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('FormPilotDB', 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        ['recordings','excelData','logs','sessions','files'].forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            const kp = name === 'excelData' ? 'rowIndex' : name === 'sessions' ? 'sessionId' : name === 'files' ? 'alias' : 'id';
            db.createObjectStore(name, { keyPath: kp });
          }
        });
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        try {
          const tx = db.transaction(['recordings', 'excelData'], 'readwrite');
          tx.objectStore('recordings').put(rec);
          tx.objectStore('excelData').clear();
          excelRows.forEach(r => tx.objectStore('excelData').put(r));
          tx.oncomplete = () => resolve({ ok: true, rows: excelRows.length });
          tx.onerror   = () => resolve({ ok: false, err: String(tx.error) });
        } catch(ex) { resolve({ ok: false, err: String(ex) }); }
      };
      req.onerror   = () => resolve({ ok: false, err: String(req.error) });
      req.onblocked = () => resolve({ ok: false, err: 'IDB blocked' });
    });
  }, recording, rows);
}

// ─── Save recording index to chrome.storage.local ─────────────────────────────
async function saveIndex(page, rec) {
  return await page.evaluate(async (r) => {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage) { resolve({ ok: false }); return; }
      const entry = { id: r.id, name: r.name, siteUrl: r.siteUrl, siteId: r.siteId, pageCount: r.pageCount, createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version };
      chrome.storage.local.get(['recordings_index'], (res) => {
        const idx = (res.recordings_index || []).filter(x => x.id !== r.id);
        chrome.storage.local.set({ recordings_index: [entry, ...idx] }, () => resolve({ ok: true }));
      });
    });
  }, rec);
}

// ─── Trigger START_EXECUTION from popup → SW → content script ─────────────────
async function triggerExecution(popupPage, recordingId, sessionId, totalRows) {
  return await popupPage.evaluate(async (recId, sessId, total) => {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined') { resolve({ ok: false, err: 'no chrome' }); return; }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const tabId = tab?.id ?? -1;
        // MessageType.START_EXECUTION = 2 (from src/types/index.ts enum MessageType)
        chrome.runtime.sendMessage(
          { type: 2, payload: { recordingId: recId, sessionId: sessId, totalRows: total }, sessionId: sessId, tabId, timestamp: Date.now() },
          (response) => resolve({ ok: true, tabId, response: response ?? chrome.runtime.lastError?.message })
        );
      });
    });
  }, recordingId, sessionId, totalRows);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FormPilot — LIVE 10-Row Demo  v3  (Direct Injection Mode)  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(extensionPath)) { console.error('❌  Build first: npm run build'); process.exit(1); }
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // ── 1. Launch Chrome ──────────────────────────────────────────────────────
  console.log('🚀  Launching Chrome with FormPilot loaded...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox', '--disable-setuid-sandbox',
      '--window-size=1440,900',
    ]
  });

  // Track portal console for executor progress
  const portalLogs = [];
  let completionDetected = false;

  try {
    await sleep(3000);

    // ── 2. Get extension ID from SW target ───────────────────────────────────
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.type() === 'service_worker' || t.type() === 'background_page');
    if (!swTarget) throw new Error('Extension SW target not found.');
    const extId = swTarget.url().split('/')[2];
    const popupUrl = `chrome-extension://${extId}/public/popup.html`;
    console.log(`✅  Extension ID: ${extId}`);

    // ── 3. Open popup page for chrome API access ──────────────────────────────
    const popupPage = await browser.newPage();
    await popupPage.setViewport({ width: 420, height: 680 });
    await popupPage.goto(popupUrl, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await shot(popupPage, 'popup_home');

    // ── 4. Seed IDB with recording + 10 rows ─────────────────────────────────
    console.log('\n📦  Injecting recording & 10-row data into FormPilot IndexedDB...');
    const seedResult = await seedDatabase(popupPage, KRP_RECORDING, EXCEL_ROWS);
    console.log(`  IDB seed: ${JSON.stringify(seedResult)}`);
    if (!seedResult.ok) throw new Error(`IDB seed failed: ${seedResult.err}`);

    const idxResult  = await saveIndex(popupPage, KRP_RECORDING);
    console.log(`  Index:    ${JSON.stringify(idxResult)}`);

    await popupPage.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    await shot(popupPage, 'popup_recording_loaded');
    console.log('  ✅  Recording visible in popup — 17 steps, 10 rows ready.');

    // ── 5. Open portal tab ───────────────────────────────────────────────────
    console.log('\n🌐  Loading KRP Government Portal...');
    const portalPages = await browser.pages();
    const portalPage  = portalPages[0] || await browser.newPage();
    await portalPage.setViewport({ width: 1000, height: 900 });

    // Capture content script console logs (executor progress)
    portalPage.on('console', async (msg) => {
      const text = msg.text();
      portalLogs.push({ time: Date.now(), text });
      if (text.includes('[Executor]') || text.includes('FormPilot') || text.includes('Processing row')) {
        console.log(`  [Portal CS] ${text}`);
      }
      if (text.includes('EXECUTION_COMPLETE') || text.includes('completeExecution') || text.includes('ExecutionStatus.COMPLETE')) {
        completionDetected = true;
      }
    });

    await portalPage.goto(PORTAL_URL, { waitUntil: 'networkidle0' });
    await sleep(1000);
    await shot(portalPage, 'portal_step1_empty');
    console.log('  ✅  Portal loaded. Content script injected.');

    // ── 6. Trigger execution ──────────────────────────────────────────────────
    console.log('\n▶️   Triggering FormPilot execution for ALL 10 rows...');
    const sessionId = `live-demo-${Date.now()}`;

    // Focus portal tab first so chrome.tabs.query returns it as active
    await portalPage.bringToFront();
    await sleep(500);

    const execResult = await triggerExecution(popupPage, RECORDING_ID, sessionId, TOTAL_ROWS);
    console.log(`  ✅  START_EXECUTION sent: tabId=${execResult.tabId}, response=${JSON.stringify(execResult.response)}`);

    // ── 7. Live monitoring — timed screenshots + console watching ─────────────
    console.log('\n👁️   Watching live execution (10 rows × 4 pages each)...\n');

    const startTime = Date.now();
    // Estimated time: ~55s per row (4 wizard pages × ~5-7 steps × ~1s delay + nav waits)
    const estimatedTotalMs = TOTAL_ROWS * 55000;
    let screenshotCount = 0;
    let lastRowSeen = -1;

    // Take screenshots every 8 seconds and monitor progress
    const monitorInterval = setInterval(async () => {
      try {
        screenshotCount++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

        // Detect which row we're on from portal console logs
        const recentLogs = portalLogs.filter(l => l.time > Date.now() - 5000);
        const rowMatches = recentLogs.map(l => l.text.match(/(\d+) of (\d+)/)).filter(Boolean);
        const latestRowMatch = rowMatches[rowMatches.length - 1];
        const currentRow = latestRowMatch ? parseInt(latestRowMatch[1]) : lastRowSeen + 1;
        if (currentRow > lastRowSeen) {
          lastRowSeen = currentRow;
          console.log(`\n  ═══ ROW ${currentRow} of ${TOTAL_ROWS} — ${EXCEL_ROWS[currentRow-1]?.data['Full Legal Name'] || '?'} ═══`);
        }

        // Alternate between portal and popup screenshots
        if (screenshotCount % 2 === 0) {
          await portalPage.bringToFront();
          await shot(portalPage, `portal_row${String(currentRow || screenshotCount).padStart(2,'0')}_t${elapsed}s`);
        } else {
          await popupPage.bringToFront();
          await shot(popupPage, `popup_row${String(currentRow || screenshotCount).padStart(2,'0')}_t${elapsed}s`);
        }

        console.log(`  ⏱️  ${elapsed}s elapsed`);
      } catch (e) {
        // Page may be navigating
      }
    }, 8000);

    // Wait for completion: either console signal or time limit
    const timeoutMs = estimatedTotalMs + 60000; // buffer
    const deadline   = Date.now() + timeoutMs;

    while (!completionDetected && Date.now() < deadline) {
      // Also check via IDB — count SUCCESS rows
      try {
        const successCount = await popupPage.evaluate(async () => {
          return new Promise((resolve) => {
            const req = indexedDB.open('FormPilotDB', 2);
            req.onsuccess = (e) => {
              const db = e.target.result;
              if (!db.objectStoreNames.contains('excelData')) { resolve(0); return; }
              const tx = db.transaction(['excelData'], 'readonly');
              tx.objectStore('excelData').getAll().onsuccess = (ev) => {
                const rows = ev.target.result;
                resolve(rows.filter(r => r.status === 1).length); // RowStatus.SUCCESS = 1
              };
            };
            req.onerror = () => resolve(-1);
          });
        }).catch(() => -1);

        if (successCount >= TOTAL_ROWS) {
          console.log(`\n  🎊  All ${TOTAL_ROWS} rows marked SUCCESS in IDB!`);
          completionDetected = true;
          break;
        }
        if (successCount > 0) {
          console.log(`  📊  Progress: ${successCount}/${TOTAL_ROWS} rows completed in IDB.`);
        }
      } catch {}

      await sleep(5000);
    }

    clearInterval(monitorInterval);

    // ── 8. Final screenshots ──────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Total time: ${elapsed}s`);

    await portalPage.bringToFront();
    await shot(portalPage, 'FINAL_portal_state');

    await popupPage.bringToFront();
    await shot(popupPage, 'FINAL_popup_state');

    // Final IDB count
    const finalCount = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('FormPilotDB', 2);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['excelData'], 'readonly');
          tx.objectStore('excelData').getAll().onsuccess = (ev) => {
            const rows = ev.target.result;
            resolve({ total: rows.length, success: rows.filter(r => r.status === 1).length, failed: rows.filter(r => r.status === 2).length, skipped: rows.filter(r => r.status === 3).length });
          };
        };
        req.onerror = () => resolve({ total: 0, success: 0 });
      });
    }).catch(() => ({ total: 0, success: 0 }));

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  ✅  DEMO COMPLETE!                                          ║`);
    console.log(`║  📊  Results: ${JSON.stringify(finalCount).padEnd(43)}║`);
    console.log(`║  ⏱️   Total time: ${elapsed}s${' '.repeat(Math.max(0, 43 - elapsed.length - 2))}║`);
    console.log(`║  📸  Screenshots: live_demo_screenshots/                     ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Stay open 20s for live inspection
    console.log('🔍  Keeping browser open 20s for live inspection...');
    await sleep(20000);

  } catch (err) {
    console.error('\n❌  Demo error:', err.message);
    try {
      for (const [i, p] of (await browser.pages()).entries()) {
        await p.screenshot({ path: path.join(screenshotsDir, `CRASH_page${i}.png`) }).catch(() => {});
      }
    } catch {}
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
