import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the unpacked extension (where vite builds to)
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('[Puppeteer] Launching Chrome with Kites extension...');
  const browser = await puppeteer.launch({
    headless: false, // Must be false to load extensions
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox'
    ]
  });

  // Attach console listeners to ALL targets (background worker, offscreen, popup, etc.)
  browser.on('targetcreated', async (target) => {
    try {
      const type = target.type();
      if (type === 'service_worker' || type === 'background_page' || type === 'page' || type === 'other') {
        const client = await target.createCDPSession();
        await client.send('Runtime.enable');
        client.on('Runtime.consoleAPICalled', e => {
          const args = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
          console.log(`[${type.toUpperCase()}] ${args}`);
        });
      }
    } catch (e) {
      // Ignore errors attaching to targets we can't attach to
    }
  });

  try {
    // 1. Wait a bit for the Service Worker to boot up
    console.log('[Puppeteer] Waiting for extension to boot (5s)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Open a test page that has images (e.g., Wikipedia)
    console.log('[Puppeteer] Navigating to test page...');
    const page = await browser.newPage();
    
    // Pipe page console to terminal
    page.on('console', msg => console.log(`[Browser Console] ${msg.type().toUpperCase()} ${msg.text()}`));
    page.on('pageerror', err => console.error('[Browser Error]', err));
    
    await page.goto('https://en.wikipedia.org/wiki/Manga', { waitUntil: 'networkidle0' });

    // 3. Find the first valid image
    console.log('[Puppeteer] Looking for images...');
    const imageSelectors = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      // Find an image large enough that the content script would have attached a button to
      const validImg = imgs.find(img => img.getBoundingClientRect().width > 150);
      return validImg ? validImg.src : null;
    });

    if (!imageSelectors) {
      console.error('[Puppeteer] Could not find a large enough image to test on this page.');
      process.exit(1);
    }
    
    console.log(`[Puppeteer] Found target image: ${imageSelectors}`);

    // Wait for the hover button to attach (the content script uses a MutationObserver)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Inject a script into the page context to programmatically click the kites button
    // because hovering via puppeteer on CSS Anchors can sometimes be tricky
    console.log('[Puppeteer] Simulating hover and click on translation button...');
    const success = await page.evaluate((targetSrc) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const img = imgs.find(i => i.src === targetSrc);
      if (img) {
        // Trigger hover event manually so global overlay registers it
        img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return true;
      }
      return false;
    }, imageSelectors);

    if (!success) {
      console.error('[Puppeteer] Failed to trigger image hover.');
      process.exit(1);
    }

    // Wait for the React component to render the button
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click the actual translation button
    await page.evaluate(() => {
      // @ts-ignore
      const btn = document.querySelector('#kites-translate-btn');
      if (btn) {
        btn.click();
      }
    });

    console.log('[Puppeteer] Clicked translate! Waiting for translation to finish (180s limit)...');
    
    // Check if the image SRC changes to a base64 string
    const finalSrc = await page.evaluate(async (targetSrc) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const img = imgs.find(i => i.src === targetSrc || i.src.startsWith('data:image'));
      
      // Poll every 500ms for up to 180 seconds (360 iterations)
      for (let i = 0; i < 360; i++) {
        if (img && img.src.startsWith('data:image/png;base64')) {
          return img.src.substring(0, 50) + '...';
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return null;
    }, imageSelectors);

    if (finalSrc) {
      console.log(`[Puppeteer] ✅ SUCCESS! Image translated successfully. New Src: ${finalSrc}`);
    } else {
      console.error('[Puppeteer] ❌ FAILED! Image translation timed out or threw an error.');
    }

  } catch (err) {
    console.error('[Puppeteer] Test failed with error:', err);
  } finally {
    console.log('[Puppeteer] Closing browser in 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
})();
