import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function getBase64(relPath) {
  const absPath = path.resolve(rootDir, relPath);
  if (!fs.existsSync(absPath)) return '';
  const data = fs.readFileSync(absPath);
  const ext = path.extname(relPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

const heroArt = getBase64('README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg');
const studioImg = getBase64('README_images/UI-feature/kite_studio_editing.jpg');
const demo2In = getBase64('README_images/input/demo2.jpeg');
const demo2Out = getBase64('README_images/result/demo2_result.png');
const demo7In = getBase64('README_images/input/demo7.jpg');
const demo7Out = getBase64('README_images/result/demo7_result.png');

const slidesHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: 1920px 1080px;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      background: #090d16;
      color: #f8fafc;
      -webkit-font-smoothing: antialiased;
    }
    .slide {
      width: 1920px;
      height: 1080px;
      page-break-after: always;
      position: relative;
      overflow: hidden;
      background: radial-gradient(circle at 50% 10%, #1e1b4b 0%, #090d16 60%, #020617 100%);
      padding: 70px 90px;
      display: flex;
      flex-direction: column;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(129, 140, 248, 0.4);
      color: #a5b4fc;
      padding: 6px 18px;
      border-radius: 9999px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 12px;
      width: fit-content;
    }
    h2.slide-title {
      font-size: 44px;
      font-weight: 900;
      letter-spacing: -0.8px;
      background: linear-gradient(135deg, #ffffff 40%, #c7d2fe 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    p.slide-sub {
      font-size: 20px;
      color: #94a3b8;
      margin-bottom: 40px;
    }
    .grid-2x2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      flex: 1;
    }
    .grid-3col {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
      flex: 1;
    }
    .grid-4col {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
      flex: 1;
    }
    .card {
      background: rgba(19, 27, 46, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
    }
    .card-icon {
      font-size: 36px;
      margin-bottom: 16px;
    }
    .card-title {
      font-size: 24px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 12px;
    }
    .card-desc {
      font-size: 16px;
      color: #94a3b8;
      line-height: 1.6;
    }
    /* Cover */
    .cover-layout {
      flex: 1;
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 60px;
      align-items: center;
    }
    .cover-title {
      font-size: 84px;
      font-weight: 900;
      letter-spacing: -2px;
      line-height: 1.05;
      margin-bottom: 16px;
    }
    .cover-sub {
      font-size: 32px;
      font-weight: 800;
      color: #38bdf8;
      line-height: 1.25;
      margin-bottom: 24px;
    }
    .cover-desc {
      font-size: 20px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 40px;
    }
    .cover-meta {
      background: rgba(19, 27, 46, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 20px 24px;
      font-size: 16px;
      color: #cbd5e1;
      line-height: 1.7;
    }
    .cover-meta strong { color: #fff; }
    .cover-img-frame {
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 30px 60px -15px rgba(0,0,0,0.9), 0 0 40px rgba(99, 102, 241, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.15);
      height: 720px;
    }
    .cover-img-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    /* Proof */
    .proof-col {
      background: rgba(19, 27, 46, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 24px;
      display: flex;
      flex-direction: column;
    }
    .proof-pair {
      display: flex;
      gap: 16px;
      flex: 1;
      align-items: center;
      justify-content: center;
    }
    .proof-pair img {
      max-height: 560px;
      width: auto;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>

  <!-- SLIDE 1: Cover -->
  <div class="slide">
    <div class="cover-layout">
      <div>
        <div class="badge">⚡ Devpost AI Builders Hackathon 2026</div>
        <div class="cover-title">Kites</div>
        <div class="cover-sub">Spatial In-Browser Manga & Comic Translator</div>
        <div class="cover-desc">
          100% Client-Side WebGPU Neural Pipeline • Zero Python • Zero Cloud Lock-in • Authentic Comic Lettering in Real-Time
        </div>
        <div class="cover-meta">
          <strong>Creator:</strong> Unheat (dangtruongan)<br/>
          <strong>Live Demo:</strong> https://kites-translator.pages.dev<br/>
          <strong>Source Code:</strong> https://github.com/Unheat/Kites
        </div>
      </div>
      <div class="cover-img-frame">
        <img src="${heroArt}" />
      </div>
    </div>
  </div>

  <!-- SLIDE 2: Problem Statement -->
  <div class="slide">
    <div class="badge">01 · Problem Statement</div>
    <h2 class="slide-title">Reading Raw Comics is Broken and Painful</h2>
    <p class="slide-sub">Existing manga translation tools force users into trade-offs between impossible setups and expensive paywalls.</p>
    
    <div class="grid-2x2">
      <div class="card">
        <div class="card-icon">💻</div>
        <div class="card-title">Complex Python / CUDA Setups</div>
        <div class="card-desc">Legacy desktop tools like Cotrans demand gigabytes of PyTorch weights, manual CUDA installation, and complex terminal commands that 99% of readers cannot set up.</div>
      </div>
      <div class="card">
        <div class="card-icon">💸</div>
        <div class="card-title">Aggressive Cloud Paywalls</div>
        <div class="card-desc">Commercial browser extensions charge $10/month recurring subscriptions, impose strict daily page caps, or sell token credits that exhaust after two manga chapters.</div>
      </div>
      <div class="card">
        <div class="card-icon">🔒</div>
        <div class="card-title">Severe Privacy & Security Risks</div>
        <div class="card-desc">Cloud translation extensions upload user browsing habits, private bookmarks, and raw image scans to opaque remote servers without user consent.</div>
      </div>
      <div class="card">
        <div class="card-icon">🎨</div>
        <div class="card-title">Ugly White-Box Erasure</div>
        <div class="card-desc">Crude rectangular erasers paste solid white boxes over dialogue balloons, obliterating underlying screentones, line art, and comic textures.</div>
      </div>
    </div>
  </div>

  <!-- SLIDE 3: Solution Overview -->
  <div class="slide">
    <div class="badge">02 · Solution Overview</div>
    <h2 class="slide-title">Kites: 100% Local-First In-Browser AI Translation</h2>
    <p class="slide-sub">A zero-install Chrome extension running computer vision, generative inpainting, and typography directly on your graphics card.</p>

    <div class="grid-4col">
      <div class="card">
        <div class="badge" style="color: #38bdf8; border-color: #38bdf8;">ZERO SETUP</div>
        <div class="card-title" style="margin-top: 10px;">Instant Browser Extension</div>
        <div class="card-desc">Install in 30 seconds. Runs natively inside Google Chrome and Chromium browsers with zero terminal commands or external software.</div>
      </div>
      <div class="card">
        <div class="badge" style="color: #818cf8; border-color: #818cf8;">WEBGPU AI</div>
        <div class="card-title" style="margin-top: 10px;">Client-Side Acceleration</div>
        <div class="card-desc">PaddleOCR detection and LaMa neural inpainting execute directly on your device GPU via ONNX Runtime Web with zero server cost.</div>
      </div>
      <div class="card">
        <div class="badge" style="color: #10b981; border-color: #10b981;">100% PRIVATE</div>
        <div class="card-title" style="margin-top: 10px;">Zero Data Uploads</div>
        <div class="card-desc">Images are processed in local browser memory and stored in local IndexedDB. Your reading history and images never touch our servers.</div>
      </div>
      <div class="card">
        <div class="badge" style="color: #ff2d75; border-color: #ff2d75;">COMIC AWARE</div>
        <div class="card-title" style="margin-top: 10px;">Studio Typography</div>
        <div class="card-desc">Measures speech bubbles, balances multi-line wrapping, auto-sizes fonts, and renders authentic comic lettering directly in-page.</div>
      </div>
    </div>
  </div>

  <!-- SLIDE 4: Target Users -->
  <div class="slide">
    <div class="badge">03 · Target Users</div>
    <h2 class="slide-title">Who Needs Kites: Global Manga & Web Comic Ecosystem</h2>
    <p class="slide-sub">Serving international comic readers, social media art fans, and scanlation creators worldwide.</p>

    <div class="grid-3col">
      <div class="card">
        <div style="font-size: 40px; font-weight: 900; color: #38bdf8; margin-bottom: 12px;">01</div>
        <div class="card-title">Global Manga & Webtoon Fans</div>
        <p style="font-size: 14px; font-weight: 700; color: #64748b; margin-bottom: 8px;">CHALLENGE:</p>
        <p class="card-desc" style="margin-bottom: 16px;">70M+ readers globally wait weeks or months for fan scanlation groups to translate raw Japanese, Korean, and Chinese releases.</p>
        <p style="font-size: 14px; font-weight: 700; color: #10b981; margin-bottom: 8px;">HOW KITES EMPOWERS THEM:</p>
        <p class="card-desc">Translate raw chapters instantly on manga sites with one click, preserving original artwork and dialogue emotion.</p>
      </div>

      <div class="card">
        <div style="font-size: 40px; font-weight: 900; color: #818cf8; margin-bottom: 12px;">02</div>
        <div class="card-title">Social Media Art Fans</div>
        <p style="font-size: 14px; font-weight: 700; color: #64748b; margin-bottom: 8px;">CHALLENGE:</p>
        <p class="card-desc" style="margin-bottom: 16px;">Millions of short comics and illustrations are shared daily on X (Twitter), Pixiv, and Reddit by creators without official translations.</p>
        <p style="font-size: 14px; font-weight: 700; color: #10b981; margin-bottom: 8px;">HOW KITES EMPOWERS THEM:</p>
        <p class="card-desc">The floating hover button translates comic strips directly inside the social media timeline with zero screenshots or copy-pasting.</p>
      </div>

      <div class="card">
        <div style="font-size: 40px; font-weight: 900; color: #ff2d75; margin-bottom: 12px;">03</div>
        <div class="card-title">Scanlation Teams & Creators</div>
        <p style="font-size: 14px; font-weight: 700; color: #64748b; margin-bottom: 8px;">CHALLENGE:</p>
        <p class="card-desc" style="margin-bottom: 16px;">Manual cleaning, cloning, text redrawing, and typesetting in Photoshop takes 4–8 hours per manga chapter.</p>
        <p style="font-size: 14px; font-weight: 700; color: #10b981; margin-bottom: 8px;">HOW KITES EMPOWERS THEM:</p>
        <p class="card-desc">Kites Studio provides an interactive 8-point bounding box editor to polish translations, adjust fonts, and export 1:1 lossless PNGs.</p>
      </div>
    </div>
  </div>

  <!-- SLIDE 5: Product Features & UX -->
  <div class="slide">
    <div class="badge">04 · Product Features</div>
    <h2 class="slide-title">Frictionless In-Page Interaction & Dedicated Studio</h2>
    <p class="slide-sub">Four versatile browsing trigger modes paired with an interactive full-screen post-editor.</p>

    <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; flex: 1; align-items: center;">
      <div style="border-radius: 20px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 20px 40px rgba(0,0,0,0.8);">
        <img src="${studioImg}" style="width: 100%; display: block;" />
      </div>
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div class="card" style="padding: 20px 24px;">
          <div class="card-title" style="font-size: 20px; color: #38bdf8;">🖱️ In-Page Hover Translation</div>
          <div class="card-desc">Hover over any comic image to reveal the floating translate button. Replaces text in-place with zero page layout distortion.</div>
        </div>
        <div class="card" style="padding: 20px 24px;">
          <div class="card-title" style="font-size: 20px; color: #818cf8;">📌 Persistent Pins & 🚀 Auto-Translate</div>
          <div class="card-desc">Keep action badges pinned across all comic panels, or enable Viewport Auto-Translate to queue chapters automatically as you scroll.</div>
        </div>
        <div class="card" style="padding: 20px 24px;">
          <div class="card-title" style="font-size: 20px; color: #10b981;">🛠️ Built-in Kites Studio</div>
          <div class="card-desc">Triple-view inspection (Original, Clean Inpaint, Typeset), 8-point interactive bounding box resizing, and lossless 1:1 PNG export.</div>
        </div>
        <div class="card" style="padding: 20px 24px;">
          <div class="card-title" style="font-size: 20px; color: #ff2d75;">🛡️ SPA Reversion Shield</div>
          <div class="card-desc">MutationObserver guards prevent modern React/SPA frameworks (X/Twitter, Reddit) from reverting translated images back to raw scans.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- SLIDE 6: Visual Proof -->
  <div class="slide">
    <div class="badge">05 · Visual Proof</div>
    <h2 class="slide-title">Uncompromising Quality: Zero White Boxes</h2>
    <p class="slide-sub">Neural background inpainting erases strictly within character contours, preserving line art and screentones.</p>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; flex: 1;">
      <div class="proof-col">
        <div class="badge" style="color: #38bdf8; border-color: #38bdf8; margin-bottom: 16px;">JAPANESE ➔ ENGLISH (Sato-san benchmark)</div>
        <div class="proof-pair">
          <img src="${demo2In}" />
          <img src="${demo2Out}" />
        </div>
        <p style="text-align: center; margin-top: 14px; font-size: 14px; color: #94a3b8;">Original Scan (Left) vs. Kites Translated (Right)</p>
      </div>

      <div class="proof-col">
        <div class="badge" style="color: #10b981; border-color: #10b981; margin-bottom: 16px;">JAPANESE ➔ VIETNAMESE (Pixiv #145272482)</div>
        <div class="proof-pair">
          <img src="${demo7In}" />
          <img src="${demo7Out}" />
        </div>
        <p style="text-align: center; margin-top: 14px; font-size: 14px; color: #94a3b8;">Original Scan (Left) vs. Kites Translated (Right)</p>
      </div>
    </div>
  </div>

  <!-- SLIDE 7: Technical Architecture -->
  <div class="slide">
    <div class="badge">06 · Technical Architecture</div>
    <h2 class="slide-title">Manifest V3 Offscreen Document Sandboxing</h2>
    <p class="slide-sub">Bypassing service worker lifecycle limits to run persistent WebGPU neural computation in Chromium.</p>

    <div class="grid-4col">
      <div class="card">
        <div class="card-title" style="color: #38bdf8; font-size: 20px;">1. In-Page Scanner</div>
        <p style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Content Script</p>
        <ul style="color: #94a3b8; font-size: 14px; line-height: 1.8; padding-left: 20px;">
          <li>Discovers DOM images ≥150px</li>
          <li>Attaches CSS Anchor hover button</li>
          <li>Wipes responsive srcset candidates</li>
          <li>SPA Reversion Shield (MutationObserver)</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title" style="color: #818cf8; font-size: 20px;">2. Message Hub</div>
        <p style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Service Worker</p>
        <ul style="color: #94a3b8; font-size: 14px; line-height: 1.8; padding-left: 20px;">
          <li>Deduplicates redundant triggers</li>
          <li>Enforces 1–5 task concurrency</li>
          <li>Token-bucket rate limiter</li>
          <li>Routes explicit target/source RPCs</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title" style="color: #10b981; font-size: 20px;">3. WebGPU Sandbox</div>
        <p style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Offscreen Document</p>
        <ul style="color: #94a3b8; font-size: 14px; line-height: 1.8; padding-left: 20px;">
          <li>Persistent context (no timeouts)</li>
          <li>PaddleOCR DBNet rotated detection</li>
          <li>Promise.all: Inpaint + Translation</li>
          <li>4-Pass binary-search typesetting</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title" style="color: #ff2d75; font-size: 20px;">4. Storage & Display</div>
        <p style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Dexie IndexedDB</p>
        <ul style="color: #94a3b8; font-size: 14px; line-height: 1.8; padding-left: 20px;">
          <li>Stores clean plate + TextBlocks</li>
          <li>Automatic 7-day TTL cache pruning</li>
          <li>Converts Base64 to safe Blob URLs</li>
          <li>Studio editor interactive re-rendering</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- SLIDE 8: AI Technologies Used -->
  <div class="slide">
    <div class="badge">07 · AI Technologies</div>
    <h2 class="slide-title">The 4 Core Pillars of the Kites AI Engine</h2>
    <p class="slide-sub">Orchestrating computer vision, graph clustering, generative diffusion, and LLM inference.</p>

    <div class="grid-2x2">
      <div class="card">
        <div class="badge" style="color: #38bdf8; border-color: #38bdf8;">COMPUTER VISION (OCR)</div>
        <div class="card-title">PaddleOCR DBNet + SVTR</div>
        <div class="card-desc">Runs ONNX Runtime Web via WebGPU/WASM. Detects arbitrary rotated 4-point convex hull polygons (dt_polys) with projective perspective crop homography.</div>
      </div>
      <div class="card">
        <div class="badge" style="color: #818cf8; border-color: #818cf8;">SPATIAL GEOMETRY</div>
        <div class="card-title">Kruskal Minimum Spanning Tree</div>
        <div class="card-desc">Direction detection (connected-component majority scoring) + 14-stage noise battery + Kruskal MST bubble clustering to reconstruct natural reading order.</div>
      </div>
      <div class="card">
        <div class="badge" style="color: #10b981; border-color: #10b981;">GENERATIVE INPAINTING</div>
        <div class="card-title">LaMa Manga & AOT-GAN</div>
        <div class="card-desc">Zero-resizing 1:1 scale dynamic 64px patch bucketing. Erases strictly along character contour polygons with UNCLIP 1.8 expansion to preserve line art.</div>
      </div>
      <div class="card">
        <div class="badge" style="color: #ff2d75; border-color: #ff2d75;">LANGUAGE TRANSLATION</div>
        <div class="card-title">WebLLM & Cloudflare Shared Pool</div>
        <div class="card-desc">Runs on-device WebLLM (Qwen 2.5, Llama 3.2) or zero-cost Cloudflare Worker pool with Google OAuth and multi-provider fallback (Mistral -> Gemma -> Groq).</div>
      </div>
    </div>
  </div>

  <!-- SLIDE 9: Impact & Value Proposition -->
  <div class="slide">
    <div class="badge">08 · Impact & Value</div>
    <h2 class="slide-title">Democratizing Visual Storytelling at Zero Server Cost</h2>
    <p class="slide-sub">A sustainable, highly scalable consumer product engineered for privacy and accessibility.</p>

    <div class="grid-3col" style="margin-bottom: 30px; flex: 0.6;">
      <div class="card" style="align-items: center; text-align: center;">
        <div style="font-size: 54px; font-weight: 900; color: #38bdf8; margin-bottom: 6px;">$0</div>
        <div class="card-title" style="font-size: 20px;">Marginal Server Cost</div>
        <div class="card-desc">Compute offloaded to client-side WebGPU</div>
      </div>
      <div class="card" style="align-items: center; text-align: center;">
        <div style="font-size: 54px; font-weight: 900; color: #10b981; margin-bottom: 6px;">100%</div>
        <div class="card-title" style="font-size: 20px;">User Privacy Guaranteed</div>
        <div class="card-desc">Zero images uploaded to remote servers</div>
      </div>
      <div class="card" style="align-items: center; text-align: center;">
        <div style="font-size: 54px; font-weight: 900; color: #ff2d75; margin-bottom: 6px;">&lt; 3s</div>
        <div class="card-title" style="font-size: 20px;">Average Pipeline Latency</div>
        <div class="card-desc">Parallel inpainting + translation execution</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; flex: 1;">
      <div class="card" style="background: #1a1523; border-color: #4b1a2e;">
        <div style="color: #ff2d75; font-weight: 800; font-size: 16px; margin-bottom: 12px;">WITHOUT KITES (STATUS QUO)</div>
        <ul style="color: #94a3b8; font-size: 15px; line-height: 1.8; padding-left: 20px;">
          <li>$10/month cloud subscription fees with harsh daily token limits</li>
          <li>Painful terminal setup (Python, PyTorch, CUDA, Git dependencies)</li>
          <li>Crude white boxes destroying comic backgrounds and line art</li>
          <li>Personal reading history uploaded to unknown third-party servers</li>
        </ul>
      </div>

      <div class="card" style="background: #0d2423; border-color: #134e4a;">
        <div style="color: #10b981; font-weight: 800; font-size: 16px; margin-bottom: 12px;">WITH KITES (LOCAL-FIRST ERA)</div>
        <ul style="color: #f8fafc; font-size: 15px; line-height: 1.8; padding-left: 20px;">
          <li>100% Free & Unlimited reading with zero monthly subscriptions</li>
          <li>One-click Chrome extension install (no terminal or coding required)</li>
          <li>Clean LaMa neural inpainting strictly preserving original art</li>
          <li>100% On-device privacy with zero cloud image uploads</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- SLIDE 10: Future Roadmap & Vision -->
  <div class="slide">
    <div class="badge">09 · Roadmap & Future Vision</div>
    <h2 class="slide-title">Scaling Kites: Next Milestones & Community Launch</h2>
    <p class="slide-sub">Expanding platform reach, multi-language OCR coverage, and creator tooling.</p>

    <div class="grid-3col" style="flex: 1; margin-bottom: 30px;">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 26px; font-weight: 900; color: #fff;">Q3 2026</span>
          <span class="badge" style="color: #10b981; border-color: #10b981; margin: 0;">COMPLETED</span>
        </div>
        <div class="card-title" style="font-size: 20px; color: #38bdf8;">Core Engine & v1.0.3</div>
        <ul style="color: #94a3b8; font-size: 15px; line-height: 1.8; padding-left: 20px; margin-top: 12px;">
          <li>WebGPU ONNX PaddleOCR & LaMa Inpainting</li>
          <li>Kruskal-MST spatial bubble clustering</li>
          <li>Interactive Kites Studio 8-point editor</li>
          <li>Pre-built zip & Chrome Web Store submission</li>
        </ul>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 26px; font-weight: 900; color: #fff;">Q4 2026</span>
          <span class="badge" style="color: #38bdf8; border-color: #38bdf8; margin: 0;">IN PROGRESS</span>
        </div>
        <div class="card-title" style="font-size: 20px; color: #818cf8;">Store Launch & Browsers</div>
        <ul style="color: #94a3b8; font-size: 15px; line-height: 1.8; padding-left: 20px; margin-top: 12px;">
          <li>Chrome Web Store official public release</li>
          <li>Firefox MV3 & Microsoft Edge packaging</li>
          <li>Dynamic WebLLM model download manager</li>
          <li>Custom comic typography font packs</li>
        </ul>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 26px; font-weight: 900; color: #fff;">Q1 2027</span>
          <span class="badge" style="color: #a855f7; border-color: #a855f7; margin: 0;">PLANNED</span>
        </div>
        <div class="card-title" style="font-size: 20px; color: #ff2d75;">Asian OCR Expansion</div>
        <ul style="color: #94a3b8; font-size: 15px; line-height: 1.8; padding-left: 20px; margin-top: 12px;">
          <li>Vertical Korean Hangul dedicated dictionary</li>
          <li>Traditional Chinese Manhua tuning</li>
          <li>Canvas / WebGL viewport screen snipping</li>
          <li>Community scanlation cloud sync</li>
        </ul>
      </div>
    </div>

    <div class="card" style="padding: 20px 32px; align-items: center; text-align: center; border-color: #38bdf8; background: #1e293b;">
      <div style="font-size: 18px; color: #fff;">
        <strong>Try Kites:</strong> <a href="https://kites-translator.pages.dev" style="color: #38bdf8; text-decoration: none;">https://kites-translator.pages.dev</a> &nbsp;•&nbsp;
        <strong>GitHub:</strong> <a href="https://github.com/Unheat/Kites" style="color: #38bdf8; text-decoration: none;">https://github.com/Unheat/Kites</a> &nbsp;•&nbsp;
        <strong>Contact:</strong> andangtruong085@gmail.com
      </div>
    </div>
  </div>

</body>
</html>
`;

async function run() {
  console.log('Launching Puppeteer for presentation PDF & slide captures...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setContent(slidesHtml, { waitUntil: 'networkidle0' });

  // Generate PDF
  const pdfPath = path.resolve(rootDir, 'kites-presentation-deck.pdf');
  await page.pdf({
    path: pdfPath,
    width: '1920px',
    height: '1080px',
    printBackground: true,
    pageRanges: '1-10'
  });
  console.log(`Presentation PDF generated successfully: ${pdfPath}`);

  // Take high-res snapshot of Slide 1 and Slide 6 for visual verification
  const slides = await page.$$('.slide');
  if (slides[0]) {
    await slides[0].screenshot({ path: path.resolve(rootDir, 'scripts/deck_slide_1.jpg'), quality: 90 });
  }
  if (slides[5]) {
    await slides[5].screenshot({ path: path.resolve(rootDir, 'scripts/deck_slide_6.jpg'), quality: 90 });
  }

  await browser.close();
  console.log('Verified screenshots captured!');
}

run().catch(console.error);
