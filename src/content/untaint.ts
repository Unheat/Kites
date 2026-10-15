/**
 * @file untaint.ts
 * Universal Canvas Untaint Engine
 *
 * Runs at `document_start` in `world: "MAIN"` to prevent cross-origin images
 * from tainting HTML5 Canvas elements when drawn by web reader players.
 *
 * Intercepts CanvasRenderingContext2D.prototype.drawImage. When a cross-origin
 * image missing the crossorigin attribute is passed, proxies it through an
 * anonymous CORS image instance so the canvas remains exportable via toDataURL.
 */

(function initUntaintEngine() {
  if (typeof window === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') {
    return;
  }

  // Prevent double-patching if loaded multiple times
  if ((window as any).__kites_untaint_active__) return;
  (window as any).__kites_untaint_active__ = true;

  const isCrossOrigin = (src: string): boolean => {
    if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('chrome-extension:')) {
      return false;
    }
    try {
      const url = new URL(src, window.location.href);
      return url.origin !== window.location.origin;
    } catch {
      return false;
    }
  };

  interface AnonEntry {
    src: string;
    element: HTMLImageElement;
    img: HTMLImageElement;
    pending: ((img: HTMLImageElement) => void)[];
  }

  const anonCache = new WeakMap<HTMLImageElement, AnonEntry>();
  const taintCache = new WeakMap<HTMLImageElement, { src: string; crossOrigin: boolean }>();

  const needsAnonCopy = (image: HTMLImageElement): boolean => {
    if (image.hasAttribute('crossorigin')) return false;

    const src = image.src;
    let cached = taintCache.get(image);
    if (!cached || cached.src !== src) {
      cached = { src, crossOrigin: isCrossOrigin(src) };
      taintCache.set(image, cached);
    }
    return cached.crossOrigin;
  };

  const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;

  const deferDraw = (
    ctx: CanvasRenderingContext2D,
    args: any[]
  ): ((imgToDraw: HTMLImageElement) => void) => {
    const alpha = ctx.globalAlpha;
    const composite = ctx.globalCompositeOperation;
    const filter = ctx.filter;
    const smoothEnabled = ctx.imageSmoothingEnabled;
    const smoothQuality = ctx.imageSmoothingQuality;
    const shadowColor = ctx.shadowColor;
    const shadowBlur = ctx.shadowBlur;
    const shadowOffsetX = ctx.shadowOffsetX;
    const shadowOffsetY = ctx.shadowOffsetY;
    const transform = ctx.getTransform ? ctx.getTransform() : null;

    return (imgToDraw: HTMLImageElement) => {
      ctx.save();
      if (alpha !== undefined) ctx.globalAlpha = alpha;
      if (composite !== undefined) ctx.globalCompositeOperation = composite;
      if (filter !== undefined) ctx.filter = filter;
      if (smoothEnabled !== undefined) ctx.imageSmoothingEnabled = smoothEnabled;
      if (smoothQuality !== undefined) ctx.imageSmoothingQuality = smoothQuality;
      if (shadowColor !== undefined) ctx.shadowColor = shadowColor;
      if (shadowBlur !== undefined) ctx.shadowBlur = shadowBlur;
      if (shadowOffsetX !== undefined) ctx.shadowOffsetX = shadowOffsetX;
      if (shadowOffsetY !== undefined) ctx.shadowOffsetY = shadowOffsetY;
      if (transform) ctx.setTransform(transform);

      origDrawImage.apply(ctx, [imgToDraw, ...args] as any);
      ctx.restore();
    };
  };

  const flushPending = (entry: AnonEntry, imgToDraw: HTMLImageElement) => {
    const pending = entry.pending;
    entry.pending = [];
    if (entry.element.src !== entry.src) return;
    for (const draw of pending) {
      try {
        draw(imgToDraw);
      } catch (err) {
        console.warn('[Kites Untaint] Deferred draw replay error:', err);
      }
    }
  };

  CanvasRenderingContext2D.prototype.drawImage = function (
    image: CanvasImageSource,
    ...args: any[]
  ) {
    if (!(image instanceof HTMLImageElement) || !needsAnonCopy(image)) {
      return (origDrawImage as any).apply(this, [image, ...args]);
    }

    const src = image.src;
    let entry = anonCache.get(image);

    if (!entry || entry.src !== src) {
      const anonImg = new Image();
      entry = { src, element: image, img: anonImg, pending: [] };
      anonCache.set(image, entry);
      anonImg.crossOrigin = 'anonymous';

      anonImg.addEventListener(
        'load',
        () => flushPending(entry!, entry!.img),
        { once: true }
      );
      anonImg.addEventListener(
        'error',
        () => flushPending(entry!, entry!.element),
        { once: true }
      );
      anonImg.src = src;
    }

    const anonImg = entry.img;
    if (anonImg.complete) {
      const target = anonImg.naturalWidth > 0 ? anonImg : image;
      return (origDrawImage as any).apply(this, [target, ...args]);
    }

    entry.pending.push(deferDraw(this, args));
  };
})();
