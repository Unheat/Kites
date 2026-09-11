import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'store_screenshots');

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
          background: radial-gradient(circle at 50% 10%, #1e1b4b 0%, #0b0f19 60%, #020617 100%);
          color: #fff;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 60px;
          position: relative;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(129, 140, 248, 0.35);
          color: #a5b4fc;
          padding: 6px 16px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        h1 {
          font-size: 40px;
          font-weight: 900;
          letter-spacing: -0.5px;
          text-align: center;
          background: linear-gradient(135deg, #ffffff 30%, #c7d2fe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
        }
        p.subtitle {
          color: #94a3b8;
          font-size: 17px;
          font-weight: 400;
          text-align: center;
          margin-bottom: 32px;
          max-width: 750px;
        }
        .main-container {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 24px;
          align-items: center;
        }
        .repo-bar {
          width: 100%;
          max-width: 900px;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 14px;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.5);
        }
        .repo-info {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .github-icon {
          width: 36px;
          height: 36px;
          fill: #ffffff;
        }
        .repo-title {
          font-size: 18px;
          font-weight: 700;
          color: #ffffff;
        }
        .repo-sub {
          font-size: 13px;
          color: #94a3b8;
        }
        .badges-group {
          display: flex;
          gap: 10px;
        }
        .chip {
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.3px;
        }
        .chip-gpl {
          background: #1e3a8a;
          color: #93c5fd;
          border: 1px solid #3b82f6;
        }
        .chip-gpu {
          background: #3b2064;
          color: #d8b4fe;
          border: 1px solid #a855f7;
        }
        .chip-ts {
          background: #064e3b;
          color: #6ee7b7;
          border: 1px solid #10b981;
        }

        .pillars-grid {
          width: 100%;
          max-width: 900px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }
        .pillar-card {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
          box-shadow: 0 15px 30px -8px rgba(0, 0, 0, 0.6);
          position: relative;
          overflow: hidden;
        }
        .pillar-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; height: 3px;
        }
        .card-1::before { background: linear-gradient(90deg, #38bdf8, #818cf8); }
        .card-2::before { background: linear-gradient(90deg, #34d399, #10b981); }
        .card-3::before { background: linear-gradient(90deg, #f472b6, #fb7185); }

        .icon-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
        }
        .ib-1 { background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); }
        .ib-2 { background: rgba(52, 211, 153, 0.15); border: 1px solid rgba(52, 211, 153, 0.3); }
        .ib-3 { background: rgba(244, 114, 182, 0.15); border: 1px solid rgba(244, 114, 182, 0.3); }

        .pillar-title {
          font-size: 17px;
          font-weight: 700;
          color: #f1f5f9;
        }
        .pillar-desc {
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.5;
        }
        .footer-note {
          margin-top: 10px;
          color: #64748b;
          font-size: 13px;
          font-weight: 500;
        }
      </style>
    </head>
    <body>
      <div class="badge">🛡️ User Privacy & Transparency</div>
      <h1>100% Open Source & Local-First</h1>
      <p class="subtitle">Zero subscriptions, zero tracking, and your comic images never leave your computer</p>

      <div class="main-container">
        <div class="repo-bar">
          <div class="repo-info">
            <svg class="github-icon" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <div>
              <div class="repo-title">Unheat / Kites</div>
              <div class="repo-sub">Spatial In-Browser Manga & Comic Translator</div>
            </div>
          </div>
          <div class="badges-group">
            <span class="chip chip-gpl">GPL v3.0</span>
            <span class="chip chip-gpu">WebGPU / WASM</span>
            <span class="chip chip-ts">TypeScript</span>
          </div>
        </div>

        <div class="pillars-grid">
          <div class="pillar-card card-1">
            <div class="icon-box ib-1">🔒</div>
            <div class="pillar-title">100% Private & Local</div>
            <div class="pillar-desc">All neural OCR, polygon text erasing, and canvas typesetting execute directly on your machine. Your images are never uploaded to any remote server.</div>
          </div>

          <div class="pillar-card card-2">
            <div class="icon-box ib-2">📖</div>
            <div class="pillar-title">Publicly Auditable</div>
            <div class="pillar-desc">Licensed under GPLv3 with 100% open-source code on GitHub. Zero hidden analytics, zero trackers, and zero third-party telemetry.</div>
          </div>

          <div class="pillar-card card-3">
            <div class="icon-box ib-3">⚡</div>
            <div class="pillar-title">Free & Unlimited</div>
            <div class="pillar-desc">No monthly subscriptions, no token meters, and no artificial daily reading caps. Translate and enjoy as many chapters as you want.</div>
          </div>
        </div>

        <div class="footer-note">
          github.com/Unheat/Kites • Built with passion for comic & manga lovers
        </div>
      </div>
    </body>
    </html>
  `, { waitUntil: 'networkidle0' });

  const targetPath = path.join(outDir, '5_open_source_privacy.jpg');
  await page.screenshot({ path: targetPath, type: 'jpeg', quality: 95 });
  console.log(`Created: ${targetPath}`);

  await browser.close();
}

run().catch(console.error);
