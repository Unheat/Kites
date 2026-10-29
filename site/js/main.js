/**
 * Kites Marketing Website - Interactive Comparison Slider & Controls
 *
 * Implements smooth before/after comparison with hardware-accelerated clip-path,
 * multi-image thumbnail selection, and interactive translation sweep animation.
 */

document.addEventListener('DOMContentLoaded', () => {
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Demo dataset for comparison selector
   */
  const DEMO_PAGES = {
    demo2: {
      split: 52,
      targetLang: 'English',
      langLabel: '日本語',
      lang: 'ja',
      caption: 'Story: 佐藤さんは知っていた by @09ra_19ra',
      original: 'assets/demo2-input.jpeg',
      translated: 'assets/demo2-result.png',
      originalAlt: 'Original Japanese Manga Scan - Romance comedy panel',
      translatedAlt: 'Kites English Translation - Balanced lettering and line breaks'
    },
    'color-bubble': {
      split: 50,
      targetLang: 'English',
      langLabel: '中文',
      lang: 'zh',
      caption: 'Full translation + colorization (Chinese → English) — Original grayscale page and colorized result',
      original: 'assets/color-bubble-original.jpg',
      translated: 'assets/color-bubble-result.png',
      originalAlt: 'Original grayscale Chinese manga page',
      translatedAlt: 'Kites English translation with full-page colorization and speech balloon wrapping'
    },
    demo7: {
      split: 50,
      targetLang: 'Tiếng Việt',
      langLabel: '日本語',
      lang: 'ja',
      caption: 'Source: Pixiv #145272482 - Erases strictly inside character strokes',
      original: 'assets/demo7-input.jpg',
      translated: 'assets/demo7-result.png',
      originalAlt: 'Original Japanese Manga Scan - Dialogue-heavy panel',
      translatedAlt: 'Kites Vietnamese Translation - Zero gray boxes, clean inpainting'
    }
  };

  /**
   * Standard cubic easing for smooth animation sweeps
   * @param {number} t Time value between 0 and 1
   * @returns {number} Eased value
   */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Initializes the interactive comparison showcase
   */
  function setUpHeroDemo() {
    const card = document.getElementById('hero-demo');
    const range = document.getElementById('hero-demo-range');
    const gate = document.getElementById('hero-gate');
    const captionEl = document.getElementById('demo-caption-text');
    if (!card || !range || !gate) return;

    const original = card.querySelector('[data-demo="original"]');
    const translated = card.querySelector('[data-demo="translated"]');
    const afterTag = card.querySelector('[data-demo-tag="after"]');
    const beforeTag = card.querySelector('[data-demo-tag="before"]');
    const knob = card.querySelector('[data-demo-knob]');
    const thumbs = document.querySelectorAll('[data-demo-page]');

    let currentPageKey = card.dataset.page || 'demo2';
    let page = DEMO_PAGES[currentPageKey];
    let animationId = 0;

    /**
     * Updates split position and tag visibilities
     * @param {number} value Split percentage (0-100)
     */
    const setSplit = (value) => {
      range.value = value;
      card.style.setProperty('--split', `${value}%`);
      if (afterTag) afterTag.style.opacity = value > 8 ? '1' : '0';
      if (beforeTag) beforeTag.style.opacity = value < 92 ? '1' : '0';
      if (knob) knob.style.opacity = value > 4 && value < 96 ? '1' : '0';
    };

    /**
     * Smoothly sweeps the seam between two positions
     * @param {number} from Starting percentage
     * @param {number} to Target percentage
     * @param {number} duration Duration in milliseconds
     * @returns {Promise<boolean>} True if sweep completed without interruption
     */
    const sweep = (from, to, duration) =>
      new Promise((resolve) => {
        const id = ++animationId;
        const start = performance.now();
        const step = (now) => {
          if (id !== animationId) return resolve(false);
          const t = Math.min(1, (now - start) / duration);
          setSplit(from + (to - from) * easeOutCubic(t));
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            resolve(true);
          }
        };
        requestAnimationFrame(step);
      });

    // Native range input slider event
    range.addEventListener('input', () => {
      animationId++;
      setSplit(Number(range.value));
    });

    // Pointer drag directly on card
    let isDragging = false;
    const updateFromPointer = (e) => {
      const rect = card.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(0, Math.min(100, pct));
      animationId++;
      setSplit(pct);
    };

    card.addEventListener('pointerdown', (e) => {
      if (e.target === gate || e.target.closest('#hero-gate')) return;
      isDragging = true;
      card.setPointerCapture(e.pointerId);
      updateFromPointer(e);
    });

    card.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      updateFromPointer(e);
    });

    const stopDragging = (e) => {
      if (isDragging) {
        isDragging = false;
        try { card.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    card.addEventListener('pointerup', stopDragging);
    card.addEventListener('pointercancel', stopDragging);

    // Gate button: simulates in-place extension translation sweep
    gate.addEventListener('click', async (e) => {
      e.stopPropagation();
      gate.classList.remove('is-inviting');
      if (REDUCED_MOTION) return setSplit(100);

      const currentVal = Number(range.value);
      if (!(await sweep(currentVal, 0, 260))) return;
      if (!(await sweep(0, 100, 950))) return;

      const id = animationId;
      await new Promise((r) => setTimeout(r, 380));
      if (id === animationId) {
        sweep(100, page.split, 520);
      }
    });

    // Preload cache to prevent image loading flicker
    const loadedImages = {};
    const preloadPage = (key) => {
      if (loadedImages[key]) return loadedImages[key];
      const cfg = DEMO_PAGES[key];
      const orig = new Image();
      orig.src = cfg.original;
      const trans = new Image();
      trans.src = cfg.translated;
      loadedImages[key] = [orig, trans];
      return loadedImages[key];
    };

    // Preload both initially
    preloadPage('demo2');
    preloadPage('color-bubble');
    preloadPage('demo7');

    // Thumbnail selector switching
    thumbs.forEach((thumb) => {
      const targetKey = thumb.dataset.demoPage;

      thumb.addEventListener('pointerenter', () => preloadPage(targetKey), { once: true, passive: true });
      thumb.addEventListener('focus', () => preloadPage(targetKey), { once: true, passive: true });

      thumb.addEventListener('click', async () => {
        if (targetKey === currentPageKey) return;

        thumbs.forEach((t) => t.setAttribute('aria-pressed', String(t === thumb)));
        const [origImg, transImg] = preloadPage(targetKey);

        await Promise.all([
          origImg.decode ? origImg.decode().catch(() => {}) : Promise.resolve(),
          transImg.decode ? transImg.decode().catch(() => {}) : Promise.resolve()
        ]);

        if (thumb.getAttribute('aria-pressed') !== 'true') return;

        animationId++;
        currentPageKey = targetKey;
        page = DEMO_PAGES[targetKey];
        card.dataset.page = targetKey;

        original.src = page.original;
        original.alt = page.originalAlt;
        translated.src = page.translated;
        translated.alt = page.translatedAlt;

        if (afterTag) afterTag.textContent = page.targetLang;
        if (beforeTag) beforeTag.textContent = page.langLabel;
        if (captionEl) captionEl.textContent = page.caption;

        if (REDUCED_MOTION) {
          setSplit(page.split);
        } else {
          sweep(Number(range.value), page.split, 600);
        }
      });
    });

    // Initial entrance animation
    setSplit(88);
    if (!REDUCED_MOTION) {
      setTimeout(() => {
        sweep(88, page.split, 1100);
      }, 350);
    } else {
      setSplit(page.split);
    }
  }

  setUpHeroDemo();

  // Smooth scroll for nav anchor links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});
