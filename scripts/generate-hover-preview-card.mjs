import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const hoverImgData = fs.readFileSync(path.resolve(rootDir, 'README_images/UI-feature/auto-detect.jpg'));
const hoverImgB64 = `data:image/jpeg;base64,${hoverImgData.toString('base64')}`;

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  // Set 2x device scale for high-DPI retina display
  await page.setViewport({ width: 800, height: 700, deviceScaleFactor: 2 });

  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body {
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .mockup-container {
          position: relative;
          width: 620px;
          background: #0f172a;
          border: 1px solid rgba(255, 45, 117, 0.4);
          border-radius: 18px;
          padding: 16px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 35px rgba(255, 45, 117, 0.2);
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
          top: 48px;
          left: 95px;
          width: 92px;
          height: 92px;
          border-radius: 50%;
          border: 2px solid rgba(255, 45, 117, 0.85);
          box-shadow: 0 0 25px rgba(255, 45, 117, 0.9), inset 0 0 15px rgba(255, 45, 117, 0.4);
          pointer-events: none;
          z-index: 8;
        }
        
        /* Floating Pointer & Callout */
        .cursor-pointer {
          position: absolute;
          top: 80px;
          left: 133px;
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
      </style>
    </head>
    <body>
      <div class="mockup-container" id="target">
        <div class="browser-bar">
          <span class="dot dot-red"></span>
          <span class="dot dot-yellow"></span>
          <span class="dot dot-green"></span>
          <div class="address-box">
            🔒 https://x.com/manga_artist/status/18320491...
          </div>
        </div>

        <div class="image-stage">
          <img src="${hoverImgB64}" />
          
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
    </body>
    </html>
  `, { waitUntil: 'networkidle0' });

  const element = await page.$('#target');
  const targetFile = path.resolve(rootDir, 'README_images/UI-feature/hover-inplace-preview.png');
  await element.screenshot({ path: targetFile, omitBackground: true });
  console.log(`Created: ${targetFile}`);

  await browser.close();
}

run().catch(console.error);
