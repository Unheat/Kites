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

const heroImg = getBase64('README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg');
const iconImg = getBase64('public/icons/icon128.png');

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. Small Promo Tile (440 x 280)
  const smallPage = await browser.newPage();
  await smallPage.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
  await smallPage.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body {
          width: 440px;
          height: 280px;
          position: relative;
          overflow: hidden;
          background: #0f172a;
        }
        .bg-img {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          object-fit: cover;
          object-position: center;
          filter: brightness(0.65) saturate(1.2);
        }
        .overlay {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          background: linear-gradient(180deg, rgba(15,23,42,0.2) 0%, rgba(15,23,42,0.85) 75%, #0f172a 100%);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 22px 24px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }
        .brand img {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
        .brand-name {
          font-size: 26px;
          font-weight: 900;
          color: #ffffff;
          letter-spacing: -0.5px;
          text-shadow: 0 2px 10px rgba(0,0,0,0.8);
        }
        .tagline {
          font-size: 13px;
          color: #38bdf8;
          font-weight: 700;
          letter-spacing: 0.3px;
          margin-bottom: 4px;
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
        }
        .subtag {
          font-size: 11px;
          color: #cbd5e1;
          font-weight: 500;
          text-shadow: 0 1px 4px rgba(0,0,0,0.8);
        }
      </style>
    </head>
    <body>
      <img class="bg-img" src="${heroImg}" />
      <div class="overlay">
        <div class="brand">
          <img src="${iconImg}" />
          <span class="brand-name">Kites</span>
        </div>
        <div class="tagline">Spatial In-Browser Manga Translator</div>
        <div class="subtag">100% Local-First • WebGPU AI • Zero Cost</div>
      </div>
    </body>
    </html>
  `, { waitUntil: 'networkidle0' });

  const smallPath = path.join(outDir, 'small_promo_tile_440x280.jpg');
  await smallPage.screenshot({ path: smallPath, type: 'jpeg', quality: 95 });
  console.log(`Created: ${smallPath}`);
  await smallPage.close();

  // 2. Marquee Promo Tile (1400 x 560)
  const marqueePage = await browser.newPage();
  await marqueePage.setViewport({ width: 1400, height: 560, deviceScaleFactor: 1 });
  await marqueePage.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body {
          width: 1400px;
          height: 560px;
          position: relative;
          overflow: hidden;
          background: #090d16;
        }
        .bg-img {
          position: absolute;
          right: 0; top: 0; width: 65%; height: 100%;
          object-fit: cover;
          object-position: center right;
          filter: brightness(0.85) saturate(1.15);
        }
        .gradient-mask {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          background: linear-gradient(90deg, #090d16 0%, #090d16 42%, rgba(9,13,22,0.85) 60%, rgba(9,13,22,0.2) 100%);
        }
        .content {
          position: absolute;
          top: 0; left: 0; width: 55%; height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding-left: 80px;
          z-index: 10;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.4);
          color: #7dd3fc;
          padding: 6px 16px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 18px;
          width: fit-content;
        }
        .title {
          font-size: 54px;
          font-weight: 900;
          color: #ffffff;
          line-height: 1.1;
          letter-spacing: -1px;
          margin-bottom: 14px;
        }
        .title span {
          background: linear-gradient(135deg, #38bdf8, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .desc {
          font-size: 18px;
          color: #94a3b8;
          line-height: 1.5;
          margin-bottom: 24px;
        }
        .features {
          display: flex;
          gap: 20px;
        }
        .feat-item {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #e2e8f0;
          font-size: 14px;
          font-weight: 600;
        }
        .feat-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #38bdf8;
        }
      </style>
    </head>
    <body>
      <img class="bg-img" src="${heroImg}" />
      <div class="gradient-mask"></div>
      <div class="content">
        <div class="pill">⚡ Local-First In-Browser AI</div>
        <div class="title">Read Any Manga.<br/><span>In Your Language.</span></div>
        <div class="desc">Translate raw comics directly inside your browser. Powered by WebGPU, clean AI background inpainting, and studio typesetting.</div>
        <div class="features">
          <div class="feat-item"><div class="feat-dot"></div> Zero Cloud Paywalls</div>
          <div class="feat-item"><div class="feat-dot"></div> 100% Private & Local</div>
          <div class="feat-item"><div class="feat-dot"></div> Built-in Studio Editor</div>
        </div>
      </div>
    </body>
    </html>
  `, { waitUntil: 'networkidle0' });

  const marqueePath = path.join(outDir, 'marquee_promo_tile_1400x560.jpg');
  await marqueePage.screenshot({ path: marqueePath, type: 'jpeg', quality: 95 });
  console.log(`Created: ${marqueePath}`);
  await marqueePage.close();

  await browser.close();
}

run().catch(console.error);
