import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8094;
const distDir = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');

const fp32ModelBytes = fs.readFileSync(path.join(__dirname, '..', 'models', 'manga109_yolo11n_seg_1024.onnx'));
const fp16ModelBytes = fs.readFileSync(path.join(__dirname, '..', 'models', 'manga109_yolo11n_seg_1024_fp16.onnx'));
const testImgBytes = fs.readFileSync(path.join(__dirname, '..', 'src', 'test', 'test-img', 'image4.jpg'));

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/model-fp32.onnx') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(fp32ModelBytes);
    return;
  }
  if (urlPath === '/model-fp16.onnx') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(fp16ModelBytes);
    return;
  }
  if (urlPath === '/image4.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(testImgBytes);
    return;
  }

  // Check in distDir
  const distFile = path.join(distDir, path.basename(urlPath));
  if (fs.existsSync(distFile) && fs.statSync(distFile).isFile()) {
    const ext = path.extname(distFile);
    let contentType = 'application/octet-stream';
    if (ext === '.mjs' || ext === '.js') contentType = 'application/javascript';
    else if (ext === '.wasm') contentType = 'application/wasm';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(distFile));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html>
<html>
<body>
  <h2>WebGPU YOLO FP32 vs FP16 Benchmark</h2>
  <img id="img" src="/image4.jpg" />
</body>
</html>`);
});

server.listen(PORT, async () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1024, height: 768 },
    args: [
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--use-webgpu-power-preference=high-performance'
    ]
  });

  const page = await browser.newPage();
  page.on('console', (msg) => console.log(`[Browser Console] ${msg.text()}`));
  page.on('pageerror', (err) => console.error(`[Browser PageError]`, err));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });

  const result = await page.evaluate(async () => {
    const logs = [];
    const log = (msg) => {
      console.log(msg);
      logs.push(msg);
    };

    // 1. Check WebGPU adapter & features
    if (!navigator.gpu) {
      return { error: 'navigator.gpu not available' };
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return { error: 'No WebGPU adapter' };
    }
    log(`[GPU] Adapter info: vendor=${adapter.info?.vendor || 'unknown'}, architecture=${adapter.info?.architecture || 'unknown'}`);
    log(`[GPU] Has shader-f16: ${adapter.features.has('shader-f16')}`);
    log(`[GPU] Has subgroups: ${adapter.features.has('subgroups')}`);

    // Load ORT bundle
    const ortModule = await import('/ort.all.bundle.min.mjs');
    const ort = ortModule.default || ortModule;
    ort.env.wasm.wasmPaths = '/';

    // Helper to get image tensor
    const imgEl = document.getElementById('img');
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 1024, 1024);
    const imgData = ctx.getImageData(0, 0, 1024, 1024).data;

    const floatData = new Float32Array(3 * 1024 * 1024);
    const planeSize = 1024 * 1024;
    for (let i = 0; i < planeSize; i++) {
      floatData[i] = imgData[i * 4] / 255.0;
      floatData[planeSize + i] = imgData[i * 4 + 1] / 255.0;
      floatData[planeSize * 2 + i] = imgData[i * 4 + 2] / 255.0;
    }

    const parseBoxes = (raw, origW, origH) => {
      const cx = raw.subarray(0, 21504);
      const cy = raw.subarray(21504, 43008);
      const w = raw.subarray(43008, 64512);
      const h = raw.subarray(64512, 86016);
      const conf = raw.subarray(86016, 107520);
      const scaleX = origW / 1024;
      const scaleY = origH / 1024;
      const boxes = [];
      for (let i = 0; i < 21504; i++) {
        if (conf[i] >= 0.35) {
          boxes.push({
            x: (cx[i] - w[i] / 2) * scaleX,
            y: (cy[i] - h[i] / 2) * scaleY,
            w: w[i] * scaleX,
            h: h[i] * scaleY,
            score: conf[i]
          });
        }
      }
      return boxes;
    };

    const runBenchmark = async (modelUrl, name) => {
      log(`\n--- Testing ${name} on WebGPU ---`);
      const resp = await fetch(modelUrl);
      const modelBuffer = await resp.arrayBuffer();
      log(`[${name}] Downloaded size: ${(modelBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

      const tCreate0 = performance.now();
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: [{ name: 'webgpu' }]
      });
      const tCreate = performance.now() - tCreate0;
      log(`[${name}] Session creation time: ${tCreate.toFixed(1)}ms`);

      // Warmup
      const tensorWarmup = new ort.Tensor('float32', floatData, [1, 3, 1024, 1024]);
      await session.run({ images: tensorWarmup });

      // Benchmark 5 runs
      const runs = [];
      let lastOutput = null;
      for (let r = 0; r < 5; r++) {
        const tensor = new ort.Tensor('float32', floatData, [1, 3, 1024, 1024]);
        const t0 = performance.now();
        lastOutput = await session.run({ images: tensor });
        const dt = performance.now() - t0;
        runs.push(dt);
      }

      const meanRun = runs.reduce((a, b) => a + b, 0) / runs.length;
      const minRun = Math.min(...runs);
      log(`[${name}] 5 Inferences: mean=${meanRun.toFixed(1)}ms, min=${minRun.toFixed(1)}ms (runs: ${runs.map(r => r.toFixed(1)).join(', ')}ms)`);

      const rawOutput0 = lastOutput.output0.data;
      const boxes = parseBoxes(rawOutput0, 920, 1322);
      log(`[${name}] Candidates detected (conf >= 0.35): ${boxes.length}`);
      return { name, tCreate, meanRun, minRun, boxesCount: boxes.length, topBoxes: boxes.slice(0, 4) };
    };

    let fp32Res = null;
    let fp16Res = null;
    let fp16Error = null;

    try {
      fp32Res = await runBenchmark('/model-fp32.onnx', 'YOLO11 FP32');
    } catch (e) {
      log(`[FP32 Error]: ${e.message}`);
    }

    try {
      fp16Res = await runBenchmark('/model-fp16.onnx', 'YOLO11 FP16 (shader-f16)');
    } catch (e) {
      log(`[FP16 Error]: ${e.message}`);
      fp16Error = e.message;
    }

    return { fp32Res, fp16Res, fp16Error, logs };
  });

  console.log('\n================ BENCHMARK SUMMARY ================');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
  server.close();
  process.exit(0);
});
