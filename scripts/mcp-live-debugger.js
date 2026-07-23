import puppeteer from 'puppeteer';

(async () => {
  console.log('[MCP Debugger] Connecting to existing Chrome instance on port 9222...');
  
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });
  } catch (err) {
    console.error('Failed to connect to Chrome on port 9222:', err.message);
    process.exit(1);
  }

  console.log('✅ Connected to Chrome!');

  // Attach console loggers to all targets
  const targets = await browser.targets();
  console.log(`[MCP Debugger] Found ${targets.length} active targets in Chrome.`);

  for (const target of targets) {
    const type = target.type();
    const url = target.url();
    console.log(`  - Target [${type}]: ${url.substring(0, 70)}`);
  }

  // Find extension targets or offscreen pages
  const swTarget = targets.find(t => t.type() === 'service_worker');
  if (swTarget) {
    console.log(`[MCP Debugger] Found Service Worker: ${swTarget.url()}`);
    try {
      const worker = await swTarget.worker();
      if (worker) {
        worker.on('console', msg => console.log(`\x1b[36m[SERVICE_WORKER]\x1b[0m ${msg.text()}`));
        worker.on('error', err => console.error(`\x1b[31m[SERVICE_WORKER ERROR]\x1b[0m`, err));
      }
    } catch (e) {
      console.warn('Could not attach worker console:', e.message);
    }
  }

  // Find or open Wikipedia tab
  let page = (await browser.pages()).find(p => p.url().includes('wikipedia.org'));
  if (!page) {
    page = await browser.newPage();
    await page.goto('https://en.wikipedia.org/wiki/Manga', { waitUntil: 'networkidle0' });
  }

  page.on('console', msg => console.log(`\x1b[32m[PAGE CONSOLE]\x1b[0m ${msg.text()}`));
  page.on('pageerror', err => console.error(`\x1b[31m[PAGE ERROR]\x1b[0m`, err));

  const runTestTier = async (name, activeEngineId, activeInpaintId) => {
    console.log(`\n======================================================`);
    console.log(`🚀 REAL BROWSER TEST: ${name}`);
    console.log(`   Engine: ${activeEngineId}`);
    console.log(`   Inpaint: ${activeInpaintId}`);
    console.log(`======================================================`);

    // Set storage state via page context (content script passes state or messaging)
    const success = await page.evaluate((state) => {
      window.postMessage({ type: 'KITES_SET_STATE', payload: state }, '*');
      return true;
    }, { activeEngineId, activeInpaintId, sourceLang: 'auto', targetLang: 'en' });

    console.log(`[MCP Debugger] State update dispatched. Waiting 5s...`);
    await new Promise(r => setTimeout(r, 5000));
  };

  // Run tests for inpainting tiers & translation engines
  await runTestTier('Task 2: Chrome Native Translate + LaMa Base', 'gg-translate', 'lama-base');
  await runTestTier('Task 2: Chrome Native Translate + LaMa Manga', 'gg-translate', 'lama-manga');
  await runTestTier('Task 2: Chrome Native Translate + AOT-GAN', 'gg-translate', 'aotgan');

  await runTestTier('Task 3: Transformers Model + Simple Inpaint', 'Xenova/opus-mt-ja-en', 'simple');
  await runTestTier('Task 3: WebLLM Model + Simple Inpaint', 'SmolLM2-135M-Instruct-q0f16-MLC', 'simple');

  console.log('\n======================================================');
  console.log('✅ Real browser test sequence initiated. Monitoring logs...');
  console.log('======================================================');
})();
