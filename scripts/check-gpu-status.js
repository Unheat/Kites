import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..', 'dist');

/**
 * Diagnostic script to verify whether Puppeteer Chrome initializes native Hardware WebGPU (Metal)
 * or falls back to Virtual GPU (SwiftShader / Software).
 */
(async () => {
  console.log('================================================================');
  console.log('🔍 VERIFYING CHROME GPU & WEBGPU HARDWARE ACCELERATION STATUS');
  console.log('================================================================');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=metal',
      '--enable-gpu-rasterization',
      '--enable-features=Vulkan,UseSkiaRenderer,WebGPU'
    ]
  });

  const page = await browser.newPage();
  await page.goto('chrome://gpu', { waitUntil: 'networkidle2' });

  // Extract GPU Feature Status table text
  const gpuStatus = await page.evaluate(() => {
    const featureTable = document.querySelector('.feature-status-list');
    if (!featureTable) return 'Feature table not found';
    return featureTable.innerText;
  });

  console.log('\n📊 Chrome GPU Feature Status:');
  console.log(gpuStatus);

  // Test navigator.gpu.requestAdapter() on a web page
  const page2 = await browser.newPage();
  await page2.goto('https://example.com', { waitUntil: 'load' });
  const adapterInfo = await page2.evaluate(async () => {
    if (!navigator.gpu) return { error: 'navigator.gpu not available' };
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { error: 'requestAdapter returned null' };
    
    let info = {};
    if (typeof adapter.requestAdapterInfo === 'function') {
      info = await adapter.requestAdapterInfo();
    }
    return {
      isHardware: !adapter.isFallbackAdapter,
      vendor: info.vendor || 'N/A',
      architecture: info.architecture || 'N/A',
      device: info.device || 'N/A',
      description: info.description || 'N/A',
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
    };
  });

  console.log('\n🎮 navigator.gpu WebGPU Adapter Info:');
  console.log(JSON.stringify(adapterInfo, null, 2));

  await browser.close();
})();
