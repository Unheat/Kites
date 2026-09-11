import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'store_screenshots');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function getBase64(relPath) {
  const absPath = path.resolve(rootDir, relPath);
  const data = fs.readFileSync(absPath);
  const ext = path.extname(relPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

const demo2Input = getBase64('README_images/input/demo2.jpeg');
const demo2Result = getBase64('README_images/result/demo2_result.png');
const demo7Input = getBase64('README_images/input/demo7.jpg');
const demo7Result = getBase64('README_images/result/demo7_result.png');
const studioImg = getBase64('README_images/UI-feature/kite_studio_editing.jpg');
const mainPanel = getBase64('README_images/UI-feature/main-panel.jpg');
const settingPanel = getBase64('README_images/UI-feature/setting-panel.jpg');

const slides = [
  {
    name: '1_translate_english.jpg',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
          body {
            width: 1280px;
            height: 800px;
            background: radial-gradient(circle at 50% 10%, #1e1b4b 0%, #0f172a 60%, #020617 100%);
            color: #fff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding: 36px 48px;
            position: relative;
          }
          .header {
            text-align: center;
            margin-bottom: 24px;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(99, 102, 241, 0.15);
            border: 1px solid rgba(129, 140, 248, 0.35);
            color: #a5b4fc;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 10px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #c7d2fe 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
          }
          p.subtitle {
            color: #94a3b8;
            font-size: 16px;
            font-weight: 400;
          }
          .content {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 40px;
          }
          .card {
            position: relative;
            background: rgba(15, 23, 42, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            padding: 10px;
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.7);
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .card-tag {
            position: absolute;
            top: -12px;
            padding: 4px 14px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          }
          .tag-orig {
            background: #334155;
            color: #cbd5e1;
            border: 1px solid #475569;
          }
          .tag-kites {
            background: linear-gradient(135deg, #4f46e5, #06b6d4);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.25);
          }
          .card img {
            height: 560px;
            width: auto;
            border-radius: 10px;
            object-fit: contain;
            display: block;
          }
          .arrow-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
          }
          .arrow-circle {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: rgba(99, 102, 241, 0.25);
            border: 1px solid rgba(129, 140, 248, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: #818cf8;
            box-shadow: 0 0 20px rgba(99, 102, 241, 0.4);
          }
          .arrow-label {
            font-size: 12px;
            color: #818cf8;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="badge">⚡ Zero Servers • 100% In-Browser AI</div>
          <h1>Read Any Manga Seamlessly in English</h1>
          <p class="subtitle">Real-time Japanese text detection, clean neural inpainting, and authentic comic lettering</p>
        </div>
        <div class="content">
          <div class="card">
            <div class="card-tag tag-orig">ORIGINAL RAW SCAN</div>
            <img src="${demo2Input}" />
          </div>
          <div class="arrow-box">
            <div class="arrow-circle">➔</div>
            <div class="arrow-label">Kites AI</div>
          </div>
          <div class="card" style="border-color: rgba(99, 102, 241, 0.4); box-shadow: 0 20px 45px -10px rgba(79, 70, 229, 0.4);">
            <div class="card-tag tag-kites">TRANSLATED IN-PAGE</div>
            <img src="${demo2Result}" />
          </div>
        </div>
      </body>
      </html>
    `
  },
  {
    name: '2_translate_vietnamese.jpg',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
          body {
            width: 1280px;
            height: 800px;
            background: radial-gradient(circle at 50% 10%, #064e3b 0%, #0f172a 60%, #020617 100%);
            color: #fff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding: 36px 48px;
            position: relative;
          }
          .header {
            text-align: center;
            margin-bottom: 24px;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(52, 211, 153, 0.35);
            color: #6ee7b7;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 10px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #a7f3d0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
          }
          p.subtitle {
            color: #94a3b8;
            font-size: 16px;
            font-weight: 400;
          }
          .content {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 40px;
          }
          .card {
            position: relative;
            background: rgba(15, 23, 42, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            padding: 10px;
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.7);
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .card-tag {
            position: absolute;
            top: -12px;
            padding: 4px 14px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          }
          .tag-orig {
            background: #334155;
            color: #cbd5e1;
            border: 1px solid #475569;
          }
          .tag-kites {
            background: linear-gradient(135deg, #059669, #10b981);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.25);
          }
          .card img {
            height: 560px;
            width: auto;
            border-radius: 10px;
            object-fit: contain;
            display: block;
          }
          .arrow-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
          }
          .arrow-circle {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.25);
            border: 1px solid rgba(52, 211, 153, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: #34d399;
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
          }
          .arrow-label {
            font-size: 12px;
            color: #34d399;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="badge">🎨 AI Inpainting • No Ugly White Boxes</div>
          <h1>Preserve Comic Art & Linework</h1>
          <p class="subtitle">Erases text strictly inside character boundaries while reconstructing backgrounds cleanly</p>
        </div>
        <div class="content">
          <div class="card">
            <div class="card-tag tag-orig">ORIGINAL RAW SCAN</div>
            <img src="${demo7Input}" />
          </div>
          <div class="arrow-box">
            <div class="arrow-circle">➔</div>
            <div class="arrow-label">Clean Inpaint</div>
          </div>
          <div class="card" style="border-color: rgba(16, 185, 129, 0.4); box-shadow: 0 20px 45px -10px rgba(16, 185, 129, 0.35);">
            <div class="card-tag tag-kites">VIETNAMESE TYPESET</div>
            <img src="${demo7Result}" />
          </div>
        </div>
      </body>
      </html>
    `
  },
  {
    name: '3_kites_studio.jpg',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
          body {
            width: 1280px;
            height: 800px;
            background: radial-gradient(circle at 50% 10%, #311042 0%, #0f172a 60%, #020617 100%);
            color: #fff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding: 30px 48px;
            position: relative;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(217, 70, 239, 0.15);
            border: 1px solid rgba(232, 121, 249, 0.35);
            color: #f0abfc;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #f5d0fe 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
          }
          p.subtitle {
            color: #94a3b8;
            font-size: 16px;
            font-weight: 400;
          }
          .studio-frame {
            flex: 1;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(192, 38, 211, 0.2);
            display: flex;
            flex-direction: column;
          }
          .window-bar {
            height: 32px;
            background: #1e293b;
            border-bottom: 1px solid #334155;
            display: flex;
            align-items: center;
            padding: 0 14px;
            gap: 8px;
          }
          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red { background: #ef4444; }
          .dot-yellow { background: #f59e0b; }
          .dot-green { background: #10b981; }
          .window-title {
            margin-left: 12px;
            font-size: 12px;
            color: #94a3b8;
            font-weight: 500;
          }
          .pills-bar {
            margin-left: auto;
            display: flex;
            gap: 10px;
          }
          .pill {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 10px;
            border-radius: 9999px;
            background: rgba(217, 70, 239, 0.2);
            color: #f5d0fe;
            border: 1px solid rgba(217, 70, 239, 0.4);
          }
          .studio-body {
            flex: 1;
            overflow: hidden;
            position: relative;
          }
          .studio-body img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: top;
            display: block;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="badge">🛠️ Built-in Kites Studio</div>
          <h1>Full Editing & Typesetting Control</h1>
          <p class="subtitle">Inspect clean backgrounds, adjust speech bubbles with 8-point handles, and export 1:1 PNGs</p>
        </div>
        <div class="studio-frame">
          <div class="window-bar">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
            <span class="window-title">Kites Studio Editor — Interactive Canvas</span>
            <div class="pills-bar">
              <span class="pill">Triple-View Inspection</span>
              <span class="pill">Interactive Box Resize</span>
              <span class="pill">Lossless PNG Export</span>
            </div>
          </div>
          <div class="studio-body">
            <img src="${studioImg}" />
          </div>
        </div>
      </body>
      </html>
    `
  },
  {
    name: '4_extension_ui_settings.jpg',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
          body {
            width: 1280px;
            height: 800px;
            background: radial-gradient(circle at 50% 10%, #1e293b 0%, #0f172a 60%, #020617 100%);
            color: #fff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding: 30px 48px;
            position: relative;
          }
          .header {
            text-align: center;
            margin-bottom: 24px;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(56, 189, 248, 0.15);
            border: 1px solid rgba(56, 189, 248, 0.35);
            color: #7dd3fc;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #bae6fd 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
          }
          p.subtitle {
            color: #94a3b8;
            font-size: 16px;
            font-weight: 400;
          }
          .content {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 60px;
          }
          .mockup-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .mockup-wrapper {
            position: relative;
            background: rgba(15, 23, 42, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 16px;
            padding: 8px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .mockup-wrapper img {
            height: 520px;
            width: auto;
            border-radius: 12px;
            display: block;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          }
          .card-caption {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
          }
          .card-title {
            font-size: 16px;
            font-weight: 700;
            color: #f1f5f9;
          }
          .card-desc {
            font-size: 13px;
            color: #94a3b8;
          }
          .features-col {
            display: flex;
            flex-direction: column;
            gap: 14px;
            max-width: 240px;
          }
          .feat-box {
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 12px 14px;
          }
          .feat-title {
            font-size: 13px;
            font-weight: 700;
            color: #38bdf8;
            margin-bottom: 3px;
          }
          .feat-desc {
            font-size: 12px;
            color: #94a3b8;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="badge">⚙️ Lightweight & Highly Configurable</div>
          <h1>Intuitive Controls & Deep Customization</h1>
          <p class="subtitle">Instant reading mode toggles, WebGPU acceleration, and customizable AI waterfall engines</p>
        </div>
        <div class="content">
          <div class="mockup-card">
            <div class="mockup-wrapper">
              <img src="${mainPanel}" />
            </div>
            <div class="card-caption">
              <span class="card-title">Quick Control Popup</span>
              <span class="card-desc">Target language & reading modes</span>
            </div>
          </div>

          <div class="features-col">
            <div class="feat-box">
              <div class="feat-title">🖱️ 4 Reading Modes</div>
              <div class="feat-desc">Hover button, persistent pins, continuous auto-scroll, or right-click.</div>
            </div>
            <div class="feat-box">
              <div class="feat-title">⚡ WebGPU Accelerated</div>
              <div class="feat-desc">Local neural inference with seamless WASM fallback.</div>
            </div>
            <div class="feat-box">
              <div class="feat-title">🔀 Smart Fallback</div>
              <div class="feat-desc">WebLLM, Free Cloud Pool, Google Translate, or Custom APIs.</div>
            </div>
          </div>

          <div class="mockup-card">
            <div class="mockup-wrapper">
              <img src="${settingPanel}" />
            </div>
            <div class="card-caption">
              <span class="card-title">Engine Presets & Settings</span>
              <span class="card-desc">OCR models & inpainting algorithms</span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  }
];

async function run() {
  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const slide of slides) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setContent(slide.html, { waitUntil: 'networkidle0' });
    const targetFile = path.join(outDir, slide.name);
    await page.screenshot({
      path: targetFile,
      type: 'jpeg',
      quality: 95
    });
    console.log(`Generated: ${targetFile}`);
    await page.close();
  }

  await browser.close();
  console.log('All store screenshots created successfully in store_screenshots/ !');
}

run().catch(err => {
  console.error('Error generating screenshots:', err);
  process.exit(1);
});
