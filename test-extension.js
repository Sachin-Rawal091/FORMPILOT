import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const extensionPath = path.join(__dirname, 'dist');
  console.log(`Loading extension from: ${extensionPath}`);

  try {
    const browser = await puppeteer.launch({
      // Headless Chrome doesn't support extensions natively in the old headless mode.
      // We must use the new headless mode or non-headless.
      headless: "new",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    console.log("Browser launched. Checking for extension target...");
    
    // Give it a moment to initialize the extension
    await new Promise(resolve => setTimeout(resolve, 2000));

    const targets = await browser.targets();
    let extensionLoaded = false;

    for (const target of targets) {
      if (target.type() === 'service_worker' || target.type() === 'background_page') {
        const url = target.url();
        if (url.startsWith('chrome-extension://')) {
          console.log(`✅ Extension loaded successfully! Found target: ${url}`);
          extensionLoaded = true;
          break;
        }
      }
    }

    if (!extensionLoaded) {
      console.log("❌ Extension failed to load or no service worker was found.");
    }

    await browser.close();
  } catch (error) {
    console.error("❌ Failed to launch browser or extension:", error.message);
  }
})();
