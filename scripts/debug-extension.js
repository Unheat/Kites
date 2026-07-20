import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../dist');

(async () => {
  console.log(`[Debugger] Launching Chrome with extension from: ${extensionPath}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null, // full size
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // Listen to all targets (Service Workers, Offscreen Documents, Web Pages)
  browser.on('targetcreated', attachLogger);
  
  // Attach to targets that are already running when the browser starts
  const targets = await browser.targets();
  for (const target of targets) {
    attachLogger(target);
  }

  async function attachLogger(target) {
    const type = target.type();
    const url = target.url();
    
    try {
      // 1. Handle Service Workers
      if (type === 'service_worker' || type === 'shared_worker') {
        const worker = await target.worker();
        if (worker) {
          console.log(`[DEBUG] Attached to Service Worker: ${url}`);
          worker.on('console', msg => console.log(`\x1b[36m[SERVICE_WORKER]\x1b[0m ${msg.text()}`));
          worker.on('error', err => console.error(`\x1b[31m[SERVICE_WORKER ERROR]\x1b[0m`, err));
        }
      }
      
      // 2. Handle Pages (Including Offscreen Document and Content Scripts)
      if (type === 'page' || type === 'background_page' || type === 'other') {
        const page = await target.page();
        if (page) {
          const title = await page.title().catch(() => '');
          const isOffscreen = url.includes('offscreen.html') || title.includes('Offscreen');
          const prefix = isOffscreen ? '\x1b[35m[OFFSCREEN]\x1b[0m' : `\x1b[32m[TAB]\x1b[0m`;
          
          if (isOffscreen) {
            console.log(`[DEBUG] Attached to Offscreen Document: ${url}`);
          }
          
          page.on('console', msg => {
            // Filter out React devtools spam if any
            if (msg.text().includes('Download the React DevTools')) return;
            console.log(`${prefix} ${msg.text()}`);
          });
          
          page.on('pageerror', err => console.error(`\x1b[31m${prefix} [ERROR]\x1b[0m`, err));
          page.on('requestfailed', request => {
            console.error(`\x1b[31m${prefix} [NETWORK ERROR]\x1b[0m ${request.url()} - ${request.failure()?.errorText}`);
          });
        }
      }
    } catch (e) {
      // Ignore attachment errors for targets that close instantly
    }
  }

  console.log("\n============================================================");
  console.log("🟢 Chrome is running! Go to a manga page and try translating.");
  console.log("🐛 All background errors, CSP blocks, and logs will appear here:");
  console.log("============================================================\n");
})();
