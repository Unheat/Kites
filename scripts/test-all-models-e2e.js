import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, '..', 'dist');

async function testModelConfig(browser, configName, popupState) {
  console.log(`\n==================================================`);
  console.log(`🧪 Testing Config: [${configName}]`);
  console.log(`   Engine: ${popupState.activeEngineId}`);
  console.log(`   Inpaint: ${popupState.activeInpaintId}`);
  console.log(`==================================================`);

  // Wait briefly for targets to register
  await new Promise(r => setTimeout(r, 1500));
  const targets = await browser.targets();
  const swTarget = targets.find(t => t.url().includes('chrome-extension://'));
  if (!swTarget) throw new Error('Extension target not found');
  const extId = swTarget.url().split('/')[2];


  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });

  await extPage.evaluate((state) => {
    return new Promise((resolve) => {
      // @ts-ignore
      chrome.storage.local.set({ popupState: state }, resolve);
    });
  }, popupState);



  // Trigger download explicitly if needed via messaging
  if (popupState.activeInpaintId !== 'simple' && popupState.activeInpaintId !== 'none') {
    console.log(`[E2E] Triggering download for inpaint model: ${popupState.activeInpaintId}...`);
    await extPage.evaluate((modelId) => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'START_MODEL_DOWNLOAD', payload: { modelId, category: 'inpaint' } },
          (res) => res?.status === 'success' ? resolve(true) : reject(new Error(res?.error || 'Download failed'))
        );
      });
    }, popupState.activeInpaintId).catch(err => console.warn(`[E2E] Download warning/notice:`, err.message));
  }

  if (popupState.activeEngineId !== 'gg-translate') {
    console.log(`[E2E] Triggering download for translation model: ${popupState.activeEngineId}...`);
    await extPage.evaluate((modelId) => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'START_MODEL_DOWNLOAD', payload: { modelId } },
          (res) => res?.status === 'success' ? resolve(true) : reject(new Error(res?.error || 'Download failed'))
        );
      });
    }, popupState.activeEngineId).catch(err => console.warn(`[E2E] Download warning/notice:`, err.message));
  }


  // 2. Open test page
  const page = await browser.newPage();
  
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[PipelineOrchestrator]') || text.includes('[InpaintManager]') || text.includes('[TranslationManager]')) {
      console.log(`   [Logs] ${text}`);
    }
  });

  try {
    await page.goto('https://en.wikipedia.org/wiki/Manga', { waitUntil: 'networkidle0' });

    const imageSrc = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const validImg = imgs.find(img => img.getBoundingClientRect().width > 150);
      return validImg ? validImg.src : null;
    });

    if (!imageSrc) {
      throw new Error('No test image found on page.');
    }

    // Trigger translation by sending message directly or clicking button
    console.log(`[E2E] Triggering process translation for image...`);
    const success = await page.evaluate((targetSrc) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const img = imgs.find(i => i.src === targetSrc);
      if (img) {
        img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return true;
      }
      return false;
    }, imageSrc);

    await new Promise(r => setTimeout(r, 500));

    await page.evaluate(() => {
      // @ts-ignore
      const btn = document.querySelector('#kites-translate-btn');
      if (btn) btn.click();
    });

    // Poll for base64 output image on page
    console.log(`[E2E] Waiting for translated image result (up to 120s)...`);
    const resultSrc = await page.evaluate(async (targetSrc) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const img = imgs.find(i => i.src === targetSrc || i.src.startsWith('data:image'));
      
      for (let i = 0; i < 240; i++) {
        if (img && img.src.startsWith('data:image/png;base64')) {
          return img.src.substring(0, 60) + '...';
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return null;
    }, imageSrc);

    if (resultSrc) {
      console.log(`✅ [${configName}] PASSED! Output: ${resultSrc}`);
    } else {
      console.error(`❌ [${configName}] FAILED! Translation timed out.`);
    }

  } finally {
    await page.close();
  }
}

(async () => {
  console.log('[E2E Test Suite] Launching Chrome with unpacked extension...');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox'
    ]
  });

  try {
    // 1. Inpainting Tier 1: LaMa Base
    await testModelConfig(browser, 'Task 2: Inpaint LaMa Base', {
      activeEngineId: 'gg-translate',
      activeInpaintId: 'lama-base',
      sourceLang: 'auto',
      targetLang: 'en',
      concurrency: 2,
      isAuto: false,
      manualMode: 'hover'
    });

    // 2. Inpainting Tier 2: LaMa Manga
    await testModelConfig(browser, 'Task 2: Inpaint LaMa Manga', {
      activeEngineId: 'gg-translate',
      activeInpaintId: 'lama-manga',
      sourceLang: 'auto',
      targetLang: 'en',
      concurrency: 2,
      isAuto: false,
      manualMode: 'hover'
    });

    // 3. Inpainting Tier 3: AOT-GAN
    await testModelConfig(browser, 'Task 2: Inpaint AOT-GAN', {
      activeEngineId: 'gg-translate',
      activeInpaintId: 'aotgan',
      sourceLang: 'auto',
      targetLang: 'en',
      concurrency: 2,
      isAuto: false,
      manualMode: 'hover'
    });

      targetLang: 'en',
      concurrency: 1,
      isAuto: false,
      manualMode: 'hover'
    });

    // 5. Task 3: WebLLM Model (SmolLM2-135M-Instruct-q0f16-MLC) + Simple Fill
    await testModelConfig(browser, 'Task 3: MLC WebLLM Model', {
      activeEngineId: 'SmolLM2-135M-Instruct-q0f16-MLC',
      activeInpaintId: 'simple',
      sourceLang: 'ja',
      targetLang: 'en',
      concurrency: 1,
      isAuto: false,
      manualMode: 'hover'
    });

    console.log(`\n🎉 All End-to-End Model Tests Completed!`);

  } catch (err) {
    console.error('E2E Test suite error:', err);
  } finally {
    await browser.close();
  }
})();
