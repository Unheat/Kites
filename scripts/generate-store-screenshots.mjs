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
const chapterReaderImg = getBase64('README_images/UI-feature/chapter-reader.jpg');
const readerPanelImg = getBase64('README_images/UI-feature/reader-panel.jpg');
const hoverImg = getBase64('README_images/UI-feature/hover-inplace-preview.png');
const mainPanel = getBase64('README_images/UI-feature/main-panel.jpg');
const settingPanel = getBase64('README_images/UI-feature/setting-panel.jpg');
const studioImg = getBase64('README_images/UI-feature/kite_studio_editing.jpg');

const slides = [
  // 1. In-Place Manga Translation Before/After
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
            background: radial-gradient(circle at 50% 10%, #2a0b18 0%, #0f172a 60%, #020617 100%);
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
            background: rgba(255, 42, 109, 0.15);
            border: 1px solid rgba(255, 42, 109, 0.35);
            color: #ff6584;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 10px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #ffc1d6 100%);
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
            background: linear-gradient(135deg, #e11d48, #ff2a6d);
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
            background: rgba(255, 42, 109, 0.2);
            border: 1px solid rgba(255, 42, 109, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: #ff6584;
            box-shadow: 0 0 20px rgba(255, 42, 109, 0.4);
          }
          .arrow-label {
            font-size: 12px;
            color: #ff6584;
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
          <div class="card" style="border-color: rgba(255, 42, 109, 0.4); box-shadow: 0 20px 45px -10px rgba(255, 42, 109, 0.35);">
            <div class="card-tag tag-kites">TRANSLATED IN-PAGE</div>
            <img src="${demo2Result}" />
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 2. NEW: Chapter Reader & Auto Fast-Scan Mode
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
            background: radial-gradient(circle at 50% 10%, #1e1138 0%, #0f172a 60%, #020617 100%);
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
            background: rgba(168, 85, 247, 0.15);
            border: 1px solid rgba(192, 132, 252, 0.35);
            color: #d8b4fe;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #e9d5ff 100%);
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
            display: grid;
            grid-template-columns: 1fr 310px;
            gap: 28px;
            align-items: center;
          }
          .reader-frame {
            height: 560px;
            background: rgba(15, 23, 42, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85), 0 0 30px rgba(168, 85, 247, 0.2);
            display: flex;
            flex-direction: column;
          }
          .window-bar {
            height: 34px;
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
            margin-left: 8px;
            font-size: 12px;
            color: #94a3b8;
            font-weight: 500;
          }
          .window-controls {
            margin-left: auto;
            display: flex;
            gap: 6px;
          }
          .window-pill {
            font-size: 10px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            background: rgba(255, 42, 109, 0.2);
            color: #ff6584;
            border: 1px solid rgba(255, 42, 109, 0.35);
          }
          .reader-body {
            flex: 1;
            overflow: hidden;
            background: #000;
          }
          .reader-body img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: top center;
            display: block;
          }
          .side-col {
            display: flex;
            flex-direction: column;
            gap: 10px;
            align-items: center;
          }
          .panel-mockup {
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            padding: 4px;
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7);
            width: 215px;
          }
          .panel-mockup img {
            width: 100%;
            height: auto;
            border-radius: 9px;
            display: block;
          }
          .features-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
          }
          .feat-card {
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 8px 12px;
          }
          .feat-card-title {
            font-size: 12.5px;
            font-weight: 700;
            color: #d8b4fe;
            margin-bottom: 2px;
          }
          .feat-card-desc {
            font-size: 11.5px;
            color: #94a3b8;
            line-height: 1.35;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="badge">📖 Chapter Reader &amp; Auto Fast-Scan</div>
          <h1>Read &amp; Translate Entire Chapters</h1>
          <p class="subtitle">Auto-scroll to discover lazy-loaded panels, read in Webtoon mode, and batch translate</p>
        </div>
        <div class="content">
          <div class="reader-frame">
            <div class="window-bar">
              <div class="dot dot-red"></div>
              <div class="dot dot-yellow"></div>
              <div class="dot dot-green"></div>
              <span class="window-title">Kites Chapter Reader: Webtoon Mode</span>
              <div class="window-controls">
                <span class="window-pill">Webtoon View</span>
                <span class="window-pill">Auto-Scroll</span>
                <span class="window-pill">Translate All</span>
              </div>
            </div>
            <div class="reader-body">
              <img src="${chapterReaderImg}" />
            </div>
          </div>

          <div class="side-col">
            <div class="panel-mockup">
              <img src="${readerPanelImg}" />
            </div>
            <div class="features-list">
              <div class="feat-card">
                <div class="feat-card-title">⚡ Fast Scan</div>
                <div class="feat-card-desc">Auto-scrolls reader sites to capture lazy-loaded comic images.</div>
              </div>
              <div class="feat-card">
                <div class="feat-card-title">📖 Webtoon &amp; Spread Modes</div>
                <div class="feat-card-desc">Seamless vertical continuous reading with zero borders.</div>
              </div>
              <div class="feat-card">
                <div class="feat-card-title">📦 Batch Translation</div>
                <div class="feat-card-desc">Translate full chapters at once with offline history storage.</div>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 3. Instant In-Place Translation (Hover Button directly on artwork)
  {
    name: 'inplace_hover_translate.jpg',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body {
            width: 1280px;
            height: 800px;
            background: radial-gradient(circle at 50% 10%, #300829 0%, #0f172a 60%, #020617 100%);
            color: #fff;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 34px 56px;
            position: relative;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 42, 109, 0.15);
            border: 1px solid rgba(255, 42, 109, 0.4);
            color: #ff6584;
            padding: 6px 16px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 10px;
          }
          h1 {
            font-size: 38px;
            font-weight: 900;
            letter-spacing: -0.5px;
            text-align: center;
            background: linear-gradient(135deg, #ffffff 40%, #ffc1d6 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
          }
          p.subtitle {
            color: #94a3b8;
            font-size: 16px;
            font-weight: 400;
            text-align: center;
            margin-bottom: 28px;
            max-width: 800px;
          }
          .content-layout {
            width: 100%;
            display: grid;
            grid-template-columns: 1.15fr 1fr;
            gap: 44px;
            align-items: center;
          }
          .mockup-container {
            position: relative;
            background: rgba(19, 27, 46, 0.85);
            border: 1px solid rgba(255, 42, 109, 0.35);
            border-radius: 20px;
            padding: 16px;
            box-shadow: 0 25px 50px -10px rgba(0, 0, 0, 0.85), 0 0 35px rgba(255, 42, 109, 0.2);
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .browser-bar {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 8px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            margin-bottom: 14px;
          }
          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red { background: #ef4444; }
          .dot-yellow { background: #f59e0b; }
          .dot-green { background: #10b981; }
          .address-box {
            margin-left: 10px;
            flex: 1;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 4px 12px;
            font-size: 12px;
            color: #94a3b8;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .image-stage {
            position: relative;
            width: 100%;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          .image-stage img {
            width: 100%;
            height: auto;
            display: block;
          }
          .features-col {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .feature-item {
            display: flex;
            gap: 16px;
            align-items: flex-start;
            background: rgba(15, 23, 42, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 14px;
            padding: 16px 18px;
          }
          .feature-icon-wrap {
            width: 40px;
            height: 40px;
            border-radius: 10px;
            background: rgba(255, 42, 109, 0.15);
            border: 1px solid rgba(255, 42, 109, 0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            flex-shrink: 0;
            color: #ff6584;
          }
          .feature-text-title {
            font-size: 16px;
            font-weight: 700;
            color: #f1f5f9;
            margin-bottom: 4px;
          }
          .feature-text-desc {
            font-size: 13px;
            color: #94a3b8;
            line-height: 1.45;
          }
        </style>
      </head>
      <body>
        <div class="badge">⭐️ In-Page Hover Translation</div>
        <h1>Instant In-Place Comic Translation</h1>
        <p class="subtitle">Hover over any comic image on Twitter/X, Pixiv, or manga sites. An unobtrusive floating button appears directly on the artwork.</p>
        <div class="content-layout">
          <div class="mockup-container">
            <div class="browser-bar">
              <div class="dot dot-red"></div>
              <div class="dot dot-yellow"></div>
              <div class="dot dot-green"></div>
              <div class="address-box">
                <span>🔒</span>
                <span>https://x.com/manga_artist/status/18320491...</span>
              </div>
            </div>
            <div class="image-stage">
              <img src="${hoverImg}" />
            </div>
          </div>

          <div class="features-col">
            <div class="feature-item">
              <div class="feature-icon-wrap">🖱️</div>
              <div>
                <div class="feature-text-title">Hover Action Button</div>
                <div class="feature-text-desc">Unobtrusive floating badge appears on hovered images with zero layout shifting.</div>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-icon-wrap">📌</div>
              <div>
                <div class="feature-text-title">Persistent Action Pins</div>
                <div class="feature-text-desc">Keep actionable translate pins attached to comic panels for rapid reading.</div>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-icon-wrap">🚀</div>
              <div>
                <div class="feature-text-title">Continuous Auto-Translate</div>
                <div class="feature-text-desc">Viewport observer queues and translates subsequent panels automatically as you scroll.</div>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-icon-wrap">🎯</div>
              <div>
                <div class="feature-text-title">Right-Click Context Menu</div>
                <div class="feature-text-desc">Right-click any comic image on the web and select "Translate Image" instantly.</div>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 4. Intuitive Controls & Deep Customization (Main Popup, Reader, Settings)
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
            background: rgba(255, 42, 109, 0.15);
            border: 1px solid rgba(255, 42, 109, 0.35);
            color: #ff6584;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #ffc1d6 100%);
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
            gap: 50px;
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
            max-width: 250px;
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
            color: #ff6584;
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
          <div class="badge">⚙️ Lightweight &amp; Highly Configurable</div>
          <h1>Intuitive Controls &amp; Deep Customization</h1>
          <p class="subtitle">Instant reading mode toggles, WebGPU acceleration, and customizable AI waterfall engines</p>
        </div>
        <div class="content">
          <div class="mockup-card">
            <div class="mockup-wrapper">
              <img src="${mainPanel}" />
            </div>
            <div class="card-caption">
              <span class="card-title">Quick Control Popup</span>
              <span class="card-desc">Target language &amp; reading modes</span>
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
            <div class="feat-box">
              <div class="feat-title">🔒 100% Private</div>
              <div class="feat-desc">All clean backgrounds &amp; OCR kept locally in IndexedDB.</div>
            </div>
          </div>

          <div class="mockup-card">
            <div class="mockup-wrapper">
              <img src="${settingPanel}" />
            </div>
            <div class="card-caption">
              <span class="card-title">Engine Presets &amp; Settings</span>
              <span class="card-desc">OCR models &amp; inpainting algorithms</span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },

  // 5. Full Editing & Typesetting Control (Kites Studio)
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
            background: rgba(255, 42, 109, 0.15);
            border: 1px solid rgba(255, 42, 109, 0.35);
            color: #ff6584;
            padding: 5px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          h1 {
            font-size: 34px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 40%, #ffc1d6 100%);
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
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(255, 42, 109, 0.2);
            display: flex;
            flex-direction: column;
          }
          .window-bar {
            height: 34px;
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
            font-weight: 700;
            padding: 2px 10px;
            border-radius: 9999px;
            background: rgba(255, 42, 109, 0.2);
            color: #ff6584;
            border: 1px solid rgba(255, 42, 109, 0.4);
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
          <h1>Full Editing &amp; Typesetting Control</h1>
          <p class="subtitle">Inspect clean backgrounds, adjust speech bubbles with 8-point handles, and export 1:1 PNGs</p>
        </div>
        <div class="studio-frame">
          <div class="window-bar">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
            <span class="window-title">Kites Studio Editor: Interactive Canvas Workspace</span>
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
  }
];

async function run() {
  console.log('Launching headless browser to generate all 5 store screenshots...');
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
  console.log('All 5 store screenshots created successfully in store_screenshots/ !');
}

run().catch(err => {
  console.error('Error generating screenshots:', err);
  process.exit(1);
});
