import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

(async () => {
  console.log('================================================================');
  console.log('🚀 LIVE BROWSER E2E MODEL TEST RUNNER');
  console.log('================================================================');
  console.log(`[Setup] Unpacked extension path: ${extensionPath}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-web-security'
    ]
  });

  // Attach target loggers for Service Worker & Offscreen
  browser.on('targetcreated', async (target) => {
    const type = target.type();
    const url = target.url();
    if (type === 'service_worker' || type === 'page' || type === 'other') {
      try {
        const client = await target.createCDPSession();
        await client.send('Runtime.enable');
        client.on('Runtime.consoleAPICalled', e => {
          const text = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
          if (text.includes('[ChromeTranslatorEngine]') || text.includes('[InpaintCacheManager]') || text.includes('[PipelineOrchestrator]') || text.includes('[TranslationManager]')) {
            console.log(`\x1b[36m[BROWSER LOG]\x1b[0m ${text}`);
          }
        });
      } catch (e) {}
    }
  });

  // Wait 3s for extension background/service worker initialization
  await new Promise(r => setTimeout(r, 3000));

  // Find extension ID
  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
  if (!extTarget) {
    console.error('❌ Failed: Extension not loaded in Chrome.');
    await browser.close();
    process.exit(1);
  }
  const extId = extTarget.url().split('/')[2];
  console.log(`✅ Extension ID: ${extId}`);

  // Create helper to configure extension state
  const setPopupState = async (state) => {
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
    await extPage.evaluate((s) => {
      return new Promise(resolve => chrome.storage.local.set({ popupState: s }, resolve));
    }, state);
    await extPage.close();
  };

  // Create local HTML page with the user's exact Imgur manga image
  const testHtmlPath = path.join(__dirname, '..', 'scratches', 'test-manga-page.html');
  fs.writeFileSync(testHtmlPath, `
<!DOCTYPE html>
<html>
<head>
  <title>Manga Test Page</title>
  <style>
    body { background: #121212; color: #fff; font-family: sans-serif; padding: 20px; text-align: center; }
    img { max-width: 700px; border: 2px solid #333; border-radius: 8px; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>Kites Manga Test Page</h1>
  <p>Target Image (Japanese Text Manga):</p>
  <img id="test-manga-img" src="https://i.imgur.com/DvQce3b_d.webp?maxwidth=760&fidelity=grand" crossorigin="anonymous" />
</body>
</html>
  `);

  const page = await browser.newPage();
  await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle0' });

  // Test Runner function
  const runTestPass = async (stepName, engineId, inpaintId) => {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`▶️ RUNNING: ${stepName}`);
    console.log(`   Translation Engine: ${engineId}`);
    console.log(`   Inpaint Engine: ${inpaintId}`);
    console.log(`----------------------------------------------------------------`);

    await setPopupState({
      activeEngineId: engineId,
      activeInpaintId: inpaintId,
      fallbackChain: [],
      sourceLang: 'auto',
      targetLang: 'en',
      concurrency: 1,
      isAuto: false,
      manualMode: 'hover'
    });

    // Trigger download if model requires explicit fetching
    if (inpaintId !== 'simple' && inpaintId !== 'none') {
      console.log(`[Download] Triggering download for inpaint model: ${inpaintId}...`);
      const extPage = await browser.newPage();
      await extPage.goto(`chrome-extension://${extId}/popup.html`);
      await extPage.evaluate((id) => {
        return new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: id, category: 'inpaint' } }, resolve);
        });
      }, inpaintId);
      await extPage.close();
    }

    if (engineId !== 'gg-translate' && engineId !== 'chrome-translator') {
      console.log(`[Download] Triggering download for translation model: ${engineId}...`);
      const extPage = await browser.newPage();
      await extPage.goto(`chrome-extension://${extId}/popup.html`);
      await extPage.evaluate((id) => {
        return new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: id } }, resolve);
        });
      }, engineId);
      await extPage.close();
    }

    // Trigger hover and translate button click on the test page
    console.log(`[Execute] Triggering image translation...`);
    await page.evaluate(() => {
      const img = document.querySelector('#test-manga-img');
      if (img) img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      const btn = document.querySelector('#kites-translate-btn');
      if (btn) btn.click();
    });

    // Poll for updated base64 image src
    console.log(`[Verify] Waiting for inpainting and translation completion (up to 120s)...`);
    const startTime = Date.now();
    let completed = false;

    for (let i = 0; i < 240; i++) {
      const currentSrc = await page.evaluate(() => {
        const img = document.querySelector('#test-manga-img');
        return img ? img.src : '';
      });

      if (currentSrc.startsWith('data:image')) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [${stepName}] PASSED in ${elapsed}s! Output base64: ${currentSrc.substring(0, 60)}...`);
        completed = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!completed) {
      console.error(`❌ [${stepName}] FAILED or timed out!`);
    }
  };

  // STEP 1 & STEP 2: Test Chrome Native Translate ("Google Translate (Native)") with all 3 Inpainting Tiers
  await runTestPass('Task 2: Inpaint Tier 1 (LaMa Base)', 'gg-translate', 'lama-base');
  await runTestPass('Task 2: Inpaint Tier 2 (LaMa Manga)', 'gg-translate', 'lama-manga');
  await runTestPass('Task 2: Inpaint Tier 3 (AOT-GAN)', 'gg-translate', 'aotgan');

  // STEP 3: Test HuggingFace Transformers & WebLLM MLC Models
  await runTestPass('Task 3: WebLLM (SmolLM2-135M-Instruct-q0f16-MLC)', 'SmolLM2-135M-Instruct-q0f16-MLC', 'simple');

  console.log('\n================================================================');
  console.log('🎉 ALL LIVE BROWSER E2E TESTS COMPLETED!');
  console.log('================================================================');

  await browser.close();
})();
