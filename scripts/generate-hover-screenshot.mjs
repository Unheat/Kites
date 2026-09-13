import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'store_screenshots');

function getBase64(relPath) {
  const absPath = path.resolve(rootDir, relPath);
  const data = fs.readFileSync(absPath);
  const ext = path.extname(relPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

const hoverImg = getBase64('README_images/UI-feature/auto-detect.jpg');

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  await page.setContent(`
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
          background: rgba(255, 45, 117, 0.15);
          border: 1px solid rgba(255, 45, 117, 0.4);
          color: #ff759f;
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
          margin-bottom: 32px;
          max-width: 800px;
        }
        .content-layout {
          width: 100%;
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          gap: 44px;
          align-items: center;
        }
        
        /* Left Column: Visual Mockup */
        .mockup-container {
          position: relative;
          background: rgba(19, 27, 46, 0.85);
          border: 1px solid rgba(255, 45, 117, 0.35);
          border-radius: 20px;
          padding: 16px;
          box-shadow: 0 25px 50px -10px rgba(0, 0, 0, 0.85), 0 0 35px rgba(255, 45, 117, 0.2);
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

        /* Highlight Ring around Button */
        .hover-target-ring {
          position: absolute;
          top: 46px;
          left: 91px;
          width: 88px;
          height: 88px;
          border-radius: 50%;
          border: 2px solid rgba(255, 45, 117, 0.8);
          box-shadow: 0 0 25px rgba(255, 45, 117, 0.9), inset 0 0 15px rgba(255, 45, 117, 0.4);
          pointer-events: none;
          z-index: 8;
        }
        
        /* Floating Pointer & Callout */
        .cursor-pointer {
          position: absolute;
          top: 76px;
          left: 128px;
          z-index: 10;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          pointer-events: none;
        }
        .cursor-icon {
          width: 28px;
          height: 28px;
          filter: drop-shadow(0 3px 12px rgba(0, 0, 0, 0.95));
          transform: rotate(-5deg);
        }
        .tooltip-tag {
          background: #ff2d75;
          color: #fff;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          padding: 6px 14px;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(255, 45, 117, 0.7);
          white-space: nowrap;
          border: 1px solid rgba(255, 255, 255, 0.35);
          margin-top: 10px;
        }

        .preview-footer {
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          font-size: 12px;
          color: #94a3b8;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #38bdf8;
          font-weight: 600;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #38bdf8;
          box-shadow: 0 0 8px #38bdf8;
        }

        /* Right Column: Features */
        .features-col {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .feat-card {
          background: rgba(19, 27, 46, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 16px 20px;
          display: flex;
          gap: 16px;
          align-items: center;
        }
        .feat-card.active-feat {
          border-color: rgba(255, 45, 117, 0.45);
          background: linear-gradient(135deg, rgba(255, 45, 117, 0.12) 0%, rgba(19, 27, 46, 0.85) 100%);
          box-shadow: 0 10px 25px -5px rgba(255, 45, 117, 0.15);
        }
        .feat-icon-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .icon-hover { background: rgba(255, 45, 117, 0.2); border: 1px solid rgba(255, 45, 117, 0.4); color: #ff759f; }
        .icon-pin { background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #7dd3fc; }
        .icon-auto { background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7; }
        .icon-menu { background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #d8b4fe; }

        .feat-content h4 {
          font-size: 16px;
          font-weight: 700;
          color: #f1f5f9;
          margin-bottom: 4px;
        }
        .feat-content p {
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.45;
        }
      </style>
    </head>
    <body>
      <div class="badge">⚡ ZERO POPUPS • IN-PAGE READING</div>
      <h1>Instant In-Place Comic Translation</h1>
      <p class="subtitle">Read manga seamlessly on X (Twitter), Pixiv, or comic sites without leaving the page or copy-pasting text</p>

      <div class="content-layout">
        <div class="mockup-container">
          <div class="browser-bar">
            <span class="dot dot-red"></span>
            <span class="dot dot-yellow"></span>
            <span class="dot dot-green"></span>
            <div class="address-box">
              🔒 https://x.com/manga_artist/status/18320491...
            </div>
          </div>

          <div class="image-stage">
            <img src="${hoverImg}" />
            
            <div class="hover-target-ring"></div>

            <div class="cursor-pointer">
              <svg class="cursor-icon" viewBox="0 0 24 24" fill="#ffffff" stroke="#000000" stroke-width="1.8">
                <path d="M3 3l7 18 3-7 7-3L3 3z"/>
              </svg>
              <div class="tooltip-tag">1-Click Translate</div>
            </div>
          </div>

          <div class="preview-footer">
            <div class="status-badge">
              <span class="status-dot"></span>
              <span>CSS Anchor Floating Badge</span>
            </div>
            <span>No page shift or DOM distortion</span>
          </div>
        </div>

        <div class="features-col">
          <div class="feat-card active-feat">
            <div class="feat-icon-box icon-hover">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 3 7 18 3-7 7-3L3 3z"/><path d="m13 13 6 6"/></svg>
            </div>
            <div class="feat-content">
              <h4>Hover Button Mode</h4>
              <p>Hover over any comic panel to reveal the sleek floating translation button. One click replaces text in-place.</p>
            </div>
          </div>

          <div class="feat-card">
            <div class="feat-icon-box icon-pin">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            </div>
            <div class="feat-content">
              <h4>Persistent Action Pins</h4>
              <p>Keep action badges visible on all detected comic images across the page for fast, continuous reading.</p>
            </div>
          </div>

          <div class="feat-card">
            <div class="feat-icon-box icon-auto">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
            </div>
            <div class="feat-content">
              <h4>Continuous Auto-Translate</h4>
              <p>Intersection observer queues and translates upcoming panels automatically as you scroll down chapters.</p>
            </div>
          </div>

          <div class="feat-card">
            <div class="feat-icon-box icon-menu">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>
            </div>
            <div class="feat-content">
              <h4>Right-Click Context Menu</h4>
              <p>Right-click any web image and choose "Translate Image" for instant on-demand processing.</p>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `, { waitUntil: 'networkidle0' });

  const targetPath = path.join(outDir, 'inplace_hover_translate.jpg');
  await page.screenshot({ path: targetPath, type: 'jpeg', quality: 95 });
  console.log(`Created: ${targetPath}`);

  await browser.close();
}

run().catch(console.error);
