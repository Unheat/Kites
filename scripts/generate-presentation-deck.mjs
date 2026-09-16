import pptxgen from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches
pres.author = 'Unheat';
pres.company = 'Kites Project';
pres.title = 'Kites: Spatial In-Browser Manga Translator — Presentation Deck';

// Palette Constants
const COLOR = {
  BG_DARK: '090D16',
  BG_CARD: '131B2E',
  BG_CARD_LIGHT: '1E293B',
  TEXT_WHITE: 'F8FAFC',
  TEXT_MUTED: '94A3B8',
  TEXT_DIM: '64748B',
  ACCENT_SKY: '38BDF8',
  ACCENT_INDIGO: '818CF8',
  ACCENT_PINK: 'FF2D75',
  ACCENT_EMERALD: '10B981',
  BORDER: '334155'
};

// Canvas Dimensions
const W = 13.33;
const H = 7.5;
const M = 0.6;

// Helper: add header to slide
function addSlideHeader(slide, tag, title, subtitle) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: M, y: 0.45, w: 2.8, h: 0.32,
    fill: { color: '1E293B' },
    line: { color: COLOR.ACCENT_SKY, width: 1 },
    rectRadius: 0.16
  });
  slide.addText(tag.toUpperCase(), {
    x: M, y: 0.45, w: 2.8, h: 0.32,
    fontSize: 10, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_SKY, align: 'center', valign: 'middle'
  });

  slide.addText(title, {
    x: M, y: 0.85, w: 12.0, h: 0.65,
    fontSize: 26, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_WHITE, valign: 'top'
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: M, y: 1.45, w: 12.0, h: 0.35,
      fontSize: 13, fontFace: 'Segoe UI',
      color: COLOR.TEXT_MUTED, valign: 'top'
    });
  }
}

// -------------------------------------------------------------
// SLIDE 1: Title & Hook (Cover)
// -------------------------------------------------------------
const s1 = pres.addSlide();
s1.background = { color: COLOR.BG_DARK };

// Cover Hero Graphic
const heroArtPath = path.resolve(rootDir, 'README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg');
if (fs.existsSync(heroArtPath)) {
  s1.addImage({
    path: heroArtPath,
    x: 6.8, y: 0.8, w: 5.9, h: 5.9,
    sizing: { type: 'cover', w: 5.9, h: 5.9 }
  });
}

// Badge
s1.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: M, y: 1.2, w: 3.8, h: 0.38,
  fill: { color: '1E293B' },
  line: { color: COLOR.ACCENT_INDIGO, width: 1 },
  rectRadius: 0.19
});
s1.addText('⚡ AI BUILDERS HACKATHON 2026', {
  x: M, y: 1.2, w: 3.8, h: 0.38,
  fontSize: 11, fontFace: 'Segoe UI', bold: true,
  color: COLOR.ACCENT_INDIGO, align: 'center', valign: 'middle'
});

// Main Title
s1.addText('Kites', {
  x: M, y: 1.8, w: 6.0, h: 1.1,
  fontSize: 54, fontFace: 'Segoe UI', bold: true,
  color: COLOR.TEXT_WHITE
});

// Subtitle
s1.addText('Spatial In-Browser Manga & Comic Translator', {
  x: M, y: 2.9, w: 5.8, h: 0.8,
  fontSize: 22, fontFace: 'Segoe UI', bold: true,
  color: COLOR.ACCENT_SKY
});

s1.addText('100% Client-Side WebGPU Neural Pipeline • Zero Python • Zero Cloud Lock-in • Authentic Comic Lettering in Real-Time', {
  x: M, y: 3.8, w: 5.8, h: 1.0,
  fontSize: 14, fontFace: 'Segoe UI',
  color: COLOR.TEXT_MUTED
});

// Bottom Metadata Pill
s1.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: M, y: 5.6, w: 5.8, h: 1.1,
  fill: { color: COLOR.BG_CARD },
  line: { color: COLOR.BORDER, width: 1 },
  rectRadius: 0.1
});
s1.addText([
  { text: 'Creator: ', options: { bold: true, color: COLOR.TEXT_WHITE } },
  { text: 'Unheat (dangtruongan)\n', options: { color: COLOR.ACCENT_SKY } },
  { text: 'Live Demo: ', options: { bold: true, color: COLOR.TEXT_WHITE } },
  { text: 'https://kites-translator.pages.dev  •  ', options: { color: COLOR.TEXT_MUTED } },
  { text: 'GitHub: ', options: { bold: true, color: COLOR.TEXT_WHITE } },
  { text: 'Unheat/Kites', options: { color: COLOR.TEXT_MUTED } }
], {
  x: M + 0.25, y: 5.75, w: 5.3, h: 0.8,
  fontSize: 12, fontFace: 'Segoe UI'
});

// -------------------------------------------------------------
// SLIDE 2: Problem Statement
// -------------------------------------------------------------
const s2 = pres.addSlide();
s2.background = { color: COLOR.BG_DARK };
addSlideHeader(s2, '01 · Problem Statement', 'Reading Raw Comics is Broken and Painful', 'Existing manga translation tools force users into trade-offs between impossible setups and expensive paywalls.');

const problems = [
  {
    icon: '💻',
    title: 'Complex Python/CUDA Setups',
    desc: 'Legacy tools like Cotrans require downloading gigabytes of PyTorch models, configuring CUDA environments, and terminal commands that 99% of readers cannot set up.'
  },
  {
    icon: '💸',
    title: 'Aggressive Cloud Paywalls',
    desc: 'Commercial browser extensions charge $10/month subscriptions, impose strict daily page limits, or sell credits that run out after two manga chapters.'
  },
  {
    icon: '🔒',
    title: 'Severe Privacy Risks',
    desc: 'Cloud translation services upload user reading data and images to third-party servers, compromising user privacy and copyright integrity.'
  },
  {
    icon: '🎨',
    title: 'Ugly White-Box UX',
    desc: 'Crude rectangle erasers obliterate surrounding linework, screentones, and textures, replacing artwork with jarring white blocks.'
  }
];

problems.forEach((p, idx) => {
  const col = idx % 2;
  const row = Math.floor(idx / 2);
  const cardX = M + col * (5.9 + 0.33);
  const cardY = 2.0 + row * (2.4 + 0.25);

  s2.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 5.9, h: 2.4,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s2.addText(p.icon, {
    x: cardX + 0.3, y: cardY + 0.3, w: 0.8, h: 0.8,
    fontSize: 28, align: 'center', valign: 'middle'
  });

  s2.addText(p.title, {
    x: cardX + 1.2, y: cardY + 0.35, w: 4.4, h: 0.4,
    fontSize: 16, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_WHITE
  });

  s2.addText(p.desc, {
    x: cardX + 1.2, y: cardY + 0.85, w: 4.4, h: 1.3,
    fontSize: 12, fontFace: 'Segoe UI',
    color: COLOR.TEXT_MUTED, lineSpacing: 16
  });
});

// -------------------------------------------------------------
// SLIDE 3: Solution Overview
// -------------------------------------------------------------
const s3 = pres.addSlide();
s3.background = { color: COLOR.BG_DARK };
addSlideHeader(s3, '02 · Solution Overview', 'Kites: 100% Local-First In-Browser AI Translation', 'An ultra-lightweight Chrome Extension running neural computer vision, generative inpainting, and typesetting right inside your browser.');

const solutionPillars = [
  {
    badge: 'ZERO SETUP',
    badgeColor: COLOR.ACCENT_SKY,
    title: 'Instant Browser Extension',
    desc: 'Install unpacked in 30 seconds. Works natively on Chromium browsers without Python, Docker, or command-line dependencies.'
  },
  {
    badge: 'HARDWARE ACCELERATED',
    badgeColor: COLOR.ACCENT_INDIGO,
    title: 'Client-Side WebGPU Engine',
    desc: 'PaddleOCR detection and LaMa Manga inpainting execute on your device graphics card via ONNX Runtime Web with zero server compute.'
  },
  {
    badge: '100% PRIVATE',
    badgeColor: COLOR.ACCENT_EMERALD,
    title: 'Zero Data Uploads',
    desc: 'Images are processed entirely in browser memory and cached in local IndexedDB. Comic panels never touch our servers.'
  },
  {
    badge: 'COMIC-AWARE',
    badgeColor: COLOR.ACCENT_PINK,
    title: 'Authentic Typesetting',
    desc: 'Measures balloon shapes, balances line wrapping, auto-sizes dialogue fonts, and bakes translated text cleanly into comic panels.'
  }
];

solutionPillars.forEach((p, idx) => {
  const cardX = M + idx * (2.85 + 0.24);
  const cardY = 2.0;

  s3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 2.85, h: 4.7,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX + 0.25, y: cardY + 0.35, w: 2.35, h: 0.3,
    fill: { color: '1E293B' },
    line: { color: p.badgeColor, width: 1 },
    rectRadius: 0.15
  });
  s3.addText(p.badge, {
    x: cardX + 0.25, y: cardY + 0.35, w: 2.35, h: 0.3,
    fontSize: 9, fontFace: 'Segoe UI', bold: true,
    color: p.badgeColor, align: 'center', valign: 'middle'
  });

  s3.addText(p.title, {
    x: cardX + 0.25, y: cardY + 0.9, w: 2.35, h: 0.7,
    fontSize: 16, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_WHITE, lineSpacing: 20
  });

  s3.addText(p.desc, {
    x: cardX + 0.25, y: cardY + 1.7, w: 2.35, h: 2.6,
    fontSize: 12, fontFace: 'Segoe UI',
    color: COLOR.TEXT_MUTED, lineSpacing: 18
  });
});

// -------------------------------------------------------------
// SLIDE 4: Target Users & Market
// -------------------------------------------------------------
const s4 = pres.addSlide();
s4.background = { color: COLOR.BG_DARK };
addSlideHeader(s4, '03 · Target Users', 'Who Needs Kites: Global Manga & Web Comic Ecosystem', 'Serving millions of international comic enthusiasts, social media readers, and scanlation creators.');

const userPersonas = [
  {
    num: '01',
    role: 'Global Manga & Webtoon Fans',
    need: '70M+ readers globally wait weeks or months for fan scanlations of Japanese raw chapters.',
    kitesValue: 'Translate untranslated chapters instantly on raw manga sites with one click, preserving original panel art and dialogue emotion.'
  },
  {
    num: '02',
    role: 'Social Media Comic Readers',
    need: 'Millions of comic strips and indie creator illustrations are shared daily on X (Twitter), Pixiv, and Reddit in Japanese, Korean, or Chinese.',
    kitesValue: 'The subtle CSS-anchored Hover button lets users read indie artwork directly in their timeline without taking screenshots or copying text.'
  },
  {
    num: '03',
    role: 'Scanlators & Content Creators',
    need: 'Manual scanlation requires hours of tedious Photoshop editing: cloning stamps, redrawing screentones, and retyping fonts.',
    kitesValue: 'Kites Studio provides an interactive 8-point bounding box editor to polish translations, adjust balloon text, and export 1:1 lossless PNGs.'
  }
];

userPersonas.forEach((u, idx) => {
  const cardX = M + idx * (3.85 + 0.28);
  const cardY = 2.0;

  s4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 3.85, h: 4.7,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s4.addText(u.num, {
    x: cardX + 0.3, y: cardY + 0.3, w: 1.0, h: 0.6,
    fontSize: 32, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_SKY
  });

  s4.addText(u.role, {
    x: cardX + 0.3, y: cardY + 1.0, w: 3.25, h: 0.6,
    fontSize: 17, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_WHITE
  });

  s4.addText('CHALLENGE:', {
    x: cardX + 0.3, y: cardY + 1.7, w: 3.25, h: 0.3,
    fontSize: 10, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_DIM
  });
  s4.addText(u.need, {
    x: cardX + 0.3, y: cardY + 2.0, w: 3.25, h: 1.0,
    fontSize: 12, fontFace: 'Segoe UI',
    color: COLOR.TEXT_MUTED, lineSpacing: 16
  });

  s4.addText('HOW KITES EMPOWERS THEM:', {
    x: cardX + 0.3, y: cardY + 3.1, w: 3.25, h: 0.3,
    fontSize: 10, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_EMERALD
  });
  s4.addText(u.kitesValue, {
    x: cardX + 0.3, y: cardY + 3.4, w: 3.25, h: 1.1,
    fontSize: 12, fontFace: 'Segoe UI',
    color: COLOR.TEXT_WHITE, lineSpacing: 16
  });
});

// -------------------------------------------------------------
// SLIDE 5: Product Features & UX
// -------------------------------------------------------------
const s5 = pres.addSlide();
s5.background = { color: COLOR.BG_DARK };
addSlideHeader(s5, '04 · Product Features', 'Frictionless In-Page Interaction & Dedicated Studio', 'Four versatile browsing trigger modes paired with an interactive full-screen post-editor.');

// Left: Screenshot of Studio Editor
const studioImgPath = path.resolve(rootDir, 'README_images/UI-feature/kite_studio_editing.jpg');
if (fs.existsSync(studioImgPath)) {
  s5.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: M, y: 2.0, w: 6.8, h: 4.7,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.ACCENT_INDIGO, width: 1 },
    rectRadius: 0.15
  });
  s5.addImage({
    path: studioImgPath,
    x: M + 0.15, y: 2.15, w: 6.5, h: 4.4,
    sizing: { type: 'cover', w: 6.5, h: 4.4 }
  });
}

// Right: Feature List
const featureItems = [
  {
    title: '🖱️ In-Page Hover Translation',
    desc: 'Hover over any image to reveal the floating translation badge. Translates directly over comic panels with zero DOM layout shift.'
  },
  {
    title: '📌 Persistent Pins & 🚀 Auto-Translate',
    desc: 'Keep action badges pinned across all comic panels, or enable Viewport Auto-Translate to queue chapters automatically as you scroll.'
  },
  {
    title: '🛠️ Built-in Kites Studio',
    desc: 'Triple-view inspection (Original, Clean Inpaint, Typeset), 8-point interactive bounding box resizing, and lossless 1:1 PNG export.'
  },
  {
    title: '🛡️ SPA Reversion Shield',
    desc: 'MutationObserver guards prevent modern React/SPA frameworks (X/Twitter, Reddit) from resetting translated images back to raw scans.'
  }
];

featureItems.forEach((f, idx) => {
  const cardX = 7.7;
  const cardY = 2.0 + idx * (1.1 + 0.1);

  s5.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 5.0, h: 1.1,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.12
  });

  s5.addText(f.title, {
    x: cardX + 0.25, y: cardY + 0.15, w: 4.5, h: 0.3,
    fontSize: 13, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_SKY
  });
  s5.addText(f.desc, {
    x: cardX + 0.25, y: cardY + 0.45, w: 4.5, h: 0.6,
    fontSize: 11, fontFace: 'Segoe UI',
    color: COLOR.TEXT_MUTED, lineSpacing: 14
  });
});

// -------------------------------------------------------------
// SLIDE 6: Visual Proof (Before & After)
// -------------------------------------------------------------
const s6 = pres.addSlide();
s6.background = { color: COLOR.BG_DARK };
addSlideHeader(s6, '05 · Visual Proof', 'Uncompromising Quality: Zero White Boxes', 'Neural background inpainting erases strictly within character contours, preserving line art and screen tones.');

// Pair 1: Japanese -> English
const demo2InputPath = path.resolve(rootDir, 'README_images/input/demo2.jpeg');
const demo2ResultPath = path.resolve(rootDir, 'README_images/result/demo2_result.png');

if (fs.existsSync(demo2InputPath) && fs.existsSync(demo2ResultPath)) {
  s6.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: M, y: 2.0, w: 5.9, h: 4.8,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });
  s6.addText('JAPANESE ➔ ENGLISH (Sato-san benchmark)', {
    x: M + 0.3, y: 2.15, w: 5.3, h: 0.3,
    fontSize: 11, fontFace: 'Segoe UI', bold: true, color: COLOR.ACCENT_SKY
  });
  s6.addImage({
    path: demo2InputPath,
    x: M + 0.3, y: 2.55, w: 2.5, h: 4.0,
    sizing: { type: 'contain', w: 2.5, h: 4.0 }
  });
  s6.addImage({
    path: demo2ResultPath,
    x: M + 3.1, y: 2.55, w: 2.5, h: 4.0,
    sizing: { type: 'contain', w: 2.5, h: 4.0 }
  });
}

// Pair 2: Japanese -> Vietnamese
const demo7InputPath = path.resolve(rootDir, 'README_images/input/demo7.jpg');
const demo7ResultPath = path.resolve(rootDir, 'README_images/result/demo7_result.png');

if (fs.existsSync(demo7InputPath) && fs.existsSync(demo7ResultPath)) {
  s6.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 6.83, y: 2.0, w: 5.9, h: 4.8,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });
  s6.addText('JAPANESE ➔ VIETNAMESE (Pixiv #145272482)', {
    x: 7.13, y: 2.15, w: 5.3, h: 0.3,
    fontSize: 11, fontFace: 'Segoe UI', bold: true, color: COLOR.ACCENT_EMERALD
  });
  s6.addImage({
    path: demo7InputPath,
    x: 7.13, y: 2.55, w: 2.5, h: 4.0,
    sizing: { type: 'contain', w: 2.5, h: 4.0 }
  });
  s6.addImage({
    path: demo7ResultPath,
    x: 9.93, y: 2.55, w: 2.5, h: 4.0,
    sizing: { type: 'contain', w: 2.5, h: 4.0 }
  });
}

// -------------------------------------------------------------
// SLIDE 7: Technical Architecture
// -------------------------------------------------------------
const s7 = pres.addSlide();
s7.background = { color: COLOR.BG_DARK };
addSlideHeader(s7, '06 · Technical Architecture', 'Manifest V3 Offscreen Document Sandboxing', 'Overcoming service worker lifecycle limits to run persistent WebGPU neural computation.');

const archSteps = [
  {
    step: '1. In-Page Scanner',
    subtitle: 'Content Script',
    points: ['Discovers DOM <img> elements ≥150px', 'Attaches CSS Anchor hover button', 'Wipes responsive srcset candidates', 'SPA Reversion Shield (MutationObserver)']
  },
  {
    step: '2. Message Hub & Queue',
    subtitle: 'Service Worker',
    points: ['Deduplicates redundant triggers', 'Enforces 1–5 task concurrency queue', 'Token-bucket rate limiter', 'Routes explicit target/source RPC markers']
  },
  {
    step: '3. WebGPU Sandbox',
    subtitle: 'Offscreen Document',
    points: ['Persistent context (no SW timeouts)', 'PaddleOCR DBNet rotated detection', 'Promise.all: Inpaint + Translation', '4-Pass binary-search typesetting']
  },
  {
    step: '4. Storage & Display',
    subtitle: 'Dexie IndexedDB',
    points: ['Stores clean plate + TextBlocks', 'Automatic 7-day TTL cache pruning', 'Converts Base64 to safe Blob URLs', 'Studio editor interactive re-rendering']
  }
];

archSteps.forEach((a, idx) => {
  const cardX = M + idx * (2.85 + 0.24);
  const cardY = 2.1;

  s7.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 2.85, h: 4.6,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s7.addText(a.step, {
    x: cardX + 0.2, y: cardY + 0.3, w: 2.45, h: 0.35,
    fontSize: 14, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_SKY
  });
  s7.addText(a.subtitle, {
    x: cardX + 0.2, y: cardY + 0.65, w: 2.45, h: 0.25,
    fontSize: 10, fontFace: 'Segoe UI',
    color: COLOR.TEXT_DIM
  });

  const bulletItems = a.points.map(p => ({
    text: p,
    options: { bullet: { code: '2022', indent: 12 }, breakLine: true, fontSize: 11, color: COLOR.TEXT_MUTED }
  }));

  s7.addText(bulletItems, {
    x: cardX + 0.2, y: cardY + 1.1, w: 2.45, h: 3.2,
    lineSpacing: 18, paraSpaceAfter: 8
  });
});

// -------------------------------------------------------------
// SLIDE 8: AI & Deep Learning Stack
// -------------------------------------------------------------
const s8 = pres.addSlide();
s8.background = { color: COLOR.BG_DARK };
addSlideHeader(s8, '07 · AI Technologies', 'The 4 Core Pillars of the Kites AI Engine', 'Orchestrating computer vision, graph clustering, generative diffusion, and LLM inference.');

const aiPillars = [
  {
    category: 'COMPUTER VISION (OCR)',
    model: 'PaddleOCR DBNet + SVTR',
    details: 'Runs ONNX Runtime Web via WebGPU/WASM. Detects arbitrary rotated 4-point convex hull polygons (dt_polys) with projective perspective crop homography.'
  },
  {
    category: 'SPATIAL GEOMETRY',
    model: 'Kruskal Minimum Spanning Tree',
    details: 'Direction detection (connected-component majority scoring) + 14-stage noise battery + Kruskal MST bubble clustering to reconstruct natural reading order.'
  },
  {
    category: 'GENERATIVE INPAINTING',
    model: 'LaMa Manga & AOT-GAN',
    details: 'Zero-resizing 1:1 scale dynamic 64px patch bucketing. Erases strictly along character contour polygons with UNCLIP 1.8 expansion to preserve line art.'
  },
  {
    category: 'LANGUAGE TRANSLATION',
    model: 'WebLLM & Cloudflare Shared Pool',
    details: 'Runs on-device WebLLM (Qwen 2.5, Llama 3.2) or zero-cost Cloudflare Worker pool with Google OAuth and multi-provider fallback (Mistral -> Gemma -> Groq).'
  }
];

aiPillars.forEach((ai, idx) => {
  const col = idx % 2;
  const row = Math.floor(idx / 2);
  const cardX = M + col * (5.9 + 0.33);
  const cardY = 2.0 + row * (2.4 + 0.25);

  s8.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 5.9, h: 2.4,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s8.addText(ai.category, {
    x: cardX + 0.3, y: cardY + 0.25, w: 5.3, h: 0.25,
    fontSize: 10, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_INDIGO
  });

  s8.addText(ai.model, {
    x: cardX + 0.3, y: cardY + 0.55, w: 5.3, h: 0.45,
    fontSize: 16, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_WHITE
  });

  s8.addText(ai.details, {
    x: cardX + 0.3, y: cardY + 1.05, w: 5.3, h: 1.15,
    fontSize: 12, fontFace: 'Segoe UI',
    color: COLOR.TEXT_MUTED, lineSpacing: 16
  });
});

// -------------------------------------------------------------
// SLIDE 9: Impact & Value Proposition
// -------------------------------------------------------------
const s9 = pres.addSlide();
s9.background = { color: COLOR.BG_DARK };
addSlideHeader(s9, '08 · Impact & Value', 'Democratizing Visual Storytelling at Zero Server Cost', 'A sustainable, highly scalable consumer product engineered for privacy and accessibility.');

// Top 3 Stat Cards
const stats = [
  { val: '$0', label: 'Marginal Server Cost', sub: 'Client-side WebGPU compute' },
  { val: '100%', label: 'User Privacy Guaranteed', sub: 'Zero images uploaded to cloud' },
  { val: '< 3s', label: 'Average Pipeline Latency', sub: 'Parallel inpaint + translation' }
];

stats.forEach((st, idx) => {
  const cardX = M + idx * (3.85 + 0.28);
  const cardY = 2.0;

  s9.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 3.85, h: 1.7,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s9.addText(st.val, {
    x: cardX + 0.2, y: cardY + 0.2, w: 3.45, h: 0.6,
    fontSize: 32, fontFace: 'Segoe UI', bold: true,
    color: COLOR.ACCENT_SKY, align: 'center'
  });
  s9.addText(st.label, {
    x: cardX + 0.2, y: cardY + 0.85, w: 3.45, h: 0.3,
    fontSize: 13, fontFace: 'Segoe UI', bold: true,
    color: COLOR.TEXT_WHITE, align: 'center'
  });
  s9.addText(st.sub, {
    x: cardX + 0.2, y: cardY + 1.15, w: 3.45, h: 0.3,
    fontSize: 11, fontFace: 'Segoe UI',
    color: COLOR.TEXT_MUTED, align: 'center'
  });
});

// Bottom Comparison: Before Kites vs With Kites
s9.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: M, y: 4.0, w: 5.9, h: 2.7,
  fill: { color: '1A1523' },
  line: { color: '4B1A2E', width: 1 },
  rectRadius: 0.15
});
s9.addText('WITHOUT KITES (STATUS QUO)', {
  x: M + 0.3, y: 4.2, w: 5.3, h: 0.3,
  fontSize: 12, fontFace: 'Segoe UI', bold: true, color: COLOR.ACCENT_PINK
});
s9.addText([
  { text: '• $10/month cloud subscription fees with token limits', options: { breakLine: true } },
  { text: '• Painful terminal setup (Python, PyTorch, CUDA, Git)', options: { breakLine: true } },
  { text: '• Crude white boxes destroying comic backgrounds', options: { breakLine: true } },
  { text: '• Personal reading history uploaded to unknown servers', options: { breakLine: true } }
], {
  x: M + 0.3, y: 4.6, w: 5.3, h: 1.9,
  fontSize: 12, fontFace: 'Segoe UI', color: COLOR.TEXT_MUTED, lineSpacing: 18
});

s9.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 6.83, y: 4.0, w: 5.9, h: 2.7,
  fill: { color: '0D2423' },
  line: { color: '134E4A', width: 1 },
  rectRadius: 0.15
});
s9.addText('WITH KITES (LOCAL-FIRST ERA)', {
  x: 7.13, y: 4.2, w: 5.3, h: 0.3,
  fontSize: 12, fontFace: 'Segoe UI', bold: true, color: COLOR.ACCENT_EMERALD
});
s9.addText([
  { text: '• 100% Free & Unlimited reading with zero subscriptions', options: { breakLine: true } },
  { text: '• One-click Chrome extension install (no terminal needed)', options: { breakLine: true } },
  { text: '• Clean LaMa neural inpainting preserving original art', options: { breakLine: true } },
  { text: '• 100% On-device privacy with zero cloud image uploads', options: { breakLine: true } }
], {
  x: 7.13, y: 4.6, w: 5.3, h: 1.9,
  fontSize: 12, fontFace: 'Segoe UI', color: COLOR.TEXT_WHITE, lineSpacing: 18
});

// -------------------------------------------------------------
// SLIDE 10: Future Roadmap & Vision
// -------------------------------------------------------------
const s10 = pres.addSlide();
s10.background = { color: COLOR.BG_DARK };
addSlideHeader(s10, '09 · Roadmap & Future Vision', 'Scaling Kites: Next Milestones & Community Launch', 'Expanding platform reach, multi-language OCR coverage, and creator tooling.');

const roadmap = [
  {
    quarter: 'Q3 2026',
    status: 'COMPLETED',
    statusColor: COLOR.ACCENT_EMERALD,
    title: 'Core Engine & Release v1.0.3',
    items: ['WebGPU ONNX PaddleOCR & LaMa Inpainting', 'Kruskal-MST spatial bubble clustering', 'Interactive Kites Studio 8-point editor', 'Pre-built zip & Chrome Web Store submission']
  },
  {
    quarter: 'Q4 2026',
    status: 'IN PROGRESS',
    statusColor: COLOR.ACCENT_SKY,
    title: 'Store Launch & Cross-Browser',
    items: ['Chrome Web Store official public release', 'Firefox MV3 & Microsoft Edge packaging', 'Dynamic WebLLM model download manager', 'Custom comic typography font packs']
  },
  {
    quarter: 'Q1 2027',
    status: 'PLANNED',
    statusColor: COLOR.ACCENT_INDIGO,
    title: 'Multilingual Asian OCR Expansion',
    items: ['Vertical Korean Hangul dedicated dictionary', 'Traditional Chinese Manhua tuning', 'Canvas / WebGL viewport screen snipping', 'Community scanlation cloud sync']
  }
];

roadmap.forEach((rm, idx) => {
  const cardX = M + idx * (3.85 + 0.28);
  const cardY = 2.0;

  s10.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX, y: cardY, w: 3.85, h: 3.6,
    fill: { color: COLOR.BG_CARD },
    line: { color: COLOR.BORDER, width: 1 },
    rectRadius: 0.15
  });

  s10.addText(rm.quarter, {
    x: cardX + 0.3, y: cardY + 0.3, w: 1.8, h: 0.3,
    fontSize: 18, fontFace: 'Segoe UI', bold: true, color: COLOR.TEXT_WHITE
  });

  s10.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardX + 2.2, y: cardY + 0.3, w: 1.35, h: 0.25,
    fill: { color: '1E293B' },
    line: { color: rm.statusColor, width: 1 },
    rectRadius: 0.12
  });
  s10.addText(rm.status, {
    x: cardX + 2.2, y: cardY + 0.3, w: 1.35, h: 0.25,
    fontSize: 8, fontFace: 'Segoe UI', bold: true,
    color: rm.statusColor, align: 'center', valign: 'middle'
  });

  s10.addText(rm.title, {
    x: cardX + 0.3, y: cardY + 0.75, w: 3.25, h: 0.4,
    fontSize: 13, fontFace: 'Segoe UI', bold: true, color: COLOR.ACCENT_SKY
  });

  const bulletItems = rm.items.map(item => ({
    text: item,
    options: { bullet: { code: '2022', indent: 12 }, breakLine: true, fontSize: 11, color: COLOR.TEXT_MUTED }
  }));

  s10.addText(bulletItems, {
    x: cardX + 0.3, y: cardY + 1.25, w: 3.25, h: 2.1,
    lineSpacing: 18, paraSpaceAfter: 6
  });
});

// Bottom Call To Action Banner
s10.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: M, y: 5.9, w: 12.13, h: 1.0,
  fill: { color: '1E293B' },
  line: { color: COLOR.ACCENT_SKY, width: 1 },
  rectRadius: 0.15
});

s10.addText([
  { text: 'Try Kites Today: ', options: { bold: true, color: COLOR.TEXT_WHITE } },
  { text: 'https://kites-translator.pages.dev  •  ', options: { color: COLOR.ACCENT_SKY } },
  { text: 'GitHub: ', options: { bold: true, color: COLOR.TEXT_WHITE } },
  { text: 'https://github.com/Unheat/Kites  •  ', options: { color: COLOR.TEXT_MUTED } },
  { text: 'Contact: ', options: { bold: true, color: COLOR.TEXT_WHITE } },
  { text: 'andangtruong085@gmail.com', options: { color: COLOR.TEXT_MUTED } }
], {
  x: M + 0.3, y: 6.2, w: 11.5, h: 0.4,
  fontSize: 13, fontFace: 'Segoe UI', align: 'center', valign: 'middle'
});

// Output File
const outputPath = path.resolve(rootDir, 'kites-presentation-deck.pptx');
await pres.writeFile({ fileName: outputPath });
console.log(`Presentation deck generated successfully: ${outputPath}`);
