/**
 * Probes which WebGPU adapter Chrome actually hands out under different launch switches.
 *
 * Context: navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) is
 * currently IGNORED on Windows (crbug.com/369219127), so on a hybrid-graphics laptop
 * Chrome may hand back the integrated GPU even though a faster discrete one exists.
 * Launch switches are not subject to that bug, so this measures which one actually works.
 *
 * Note: WebGPU is only exposed in a secure context, so we must navigate to
 * http://localhost (a secure origin) -- about:blank has no navigator.gpu.
 *
 * Usage: node scripts/probe-gpu-adapter.mjs
 */
import puppeteer from 'puppeteer';
import http from 'http';

const PORT = 8099;
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><html><body><h1>gpu probe</h1></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

async function probe(label, extraArgs) {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...extraArgs],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    const info = await page.evaluate(async () => {
      if (!navigator.gpu) return { error: 'no navigator.gpu' };
      const out = {};
      for (const pref of ['high-performance', 'low-power', 'default']) {
        const adapter = await navigator.gpu.requestAdapter(
          pref === 'default' ? {} : { powerPreference: pref }
        );
        const i = adapter?.info;
        out[pref] = adapter
          ? `vendor=${i?.vendor} arch=${i?.architecture} device=${i?.device || '-'} desc=${i?.description || '-'}`
          : 'null';
      }
      return out;
    });
    console.log(`\n=== ${label} ===`);
    if (info.error) {
      console.log('  ' + info.error);
    } else {
      for (const [pref, v] of Object.entries(info)) {
        console.log(`  powerPreference=${pref.padEnd(16)} -> ${v}`);
      }
    }
  } catch (e) {
    console.log(`\n=== ${label} ===\n  PROBE ERROR: ${e.message}`);
  } finally {
    await browser.close();
  }
}

try {
  await probe('baseline (no switch)', []);
  await probe('--force_high_performance_gpu (underscores)', ['--force_high_performance_gpu']);
  await probe('--force-high-performance-gpu (hyphens)', ['--force-high-performance-gpu']);
} finally {
  server.close();
}
