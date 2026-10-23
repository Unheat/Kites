// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaTarget,
  createStyleRevealedTarget,
  discoverAddedMediaTargets,
  discoverMediaTargets,
  getBackgroundUrls,
  reapplyMediaTargetStyles,
  resolveHoverMediaTarget,
  resolveImageSource,
  resolveMediaTargetAtPoint,
} from './mediaTargets';

const LARGE_RECT = { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) };
const SMALL_RECT = { ...LARGE_RECT, right: 40, bottom: 30, width: 40, height: 30 };

/**
 * Assigns a deterministic rendered rectangle to a jsdom element.
 *
 * @param element - Element receiving mocked geometry.
 * @param rect - Rectangle returned by getBoundingClientRect.
 * @returns Nothing.
 */
function setRect(element: Element, rect: DOMRect | typeof LARGE_RECT): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
}

/**
 * Creates a mouse event with a controlled composed path for hover resolution.
 *
 * @param target - Direct event target.
 * @param path - Elements exposed through composedPath.
 * @returns Mouse event suitable for resolver tests.
 */
function createHoverEvent(target: Element, path: EventTarget[]): MouseEvent {
  const event = new MouseEvent('mouseover', { clientX: 10, clientY: 10 });
  Object.defineProperty(event, 'target', { value: target });
  vi.spyOn(event, 'composedPath').mockReturnValue(path);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => []) });
});

describe('media target source resolution', () => {
  it('prefers currentSrc/src and falls back to srcset then lazy attributes', () => {
    const normal = document.createElement('img');
    normal.src = '/normal.jpg';
    expect(resolveImageSource(normal)).toContain('/normal.jpg');

    const responsive = document.createElement('img');
    responsive.setAttribute('srcset', '/medium.jpg 800w, /large.jpg 1600w, /small.jpg 400w');
    expect(resolveImageSource(responsive)).toBe('/large.jpg');

    const density = document.createElement('img');
    density.setAttribute('srcset', '/retina.jpg 3x, /standard.jpg 1x, /high.jpg 2x');
    expect(resolveImageSource(density)).toBe('/retina.jpg');

    const lazy = document.createElement('img');
    lazy.setAttribute('data-lazy-src', '/lazy.jpg');
    expect(resolveImageSource(lazy)).toBe('/lazy.jpg');

    const lazyWithPlaceholder = document.createElement('img');
    lazyWithPlaceholder.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    lazyWithPlaceholder.setAttribute('data-src', 'https://i7.nhentai.net/galleries/123/1.jpg');
    expect(resolveImageSource(lazyWithPlaceholder)).toBe('https://i7.nhentai.net/galleries/123/1.jpg');

    const customLazy = document.createElement('img');
    customLazy.src = '/placeholder-1x1.gif';
    customLazy.setAttribute('data-runner-src', '/custom-lazy.webp');
    expect(resolveImageSource(customLazy)).toBe('/custom-lazy.webp');
  });

  it('skips long inline SVG lazy placeholders in favor of data-src (roliascan.com)', () => {
    // Reproduces issue #2: manga readers lazy-load with a long Lucide-icon SVG data URL
    // (over the 300-char placeholder heuristic) plus data-src holding the real page URL.
    const longSvgPlaceholder = 'data:image/svg+xml;base64,'
      + 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+'
      .repeat(4);
    const lazyPage = document.createElement('img');
    lazyPage.src = longSvgPlaceholder;
    lazyPage.setAttribute('data-src', 'https://roliascan.org/storage/chapters/manhwa_1/page_002.webp');
    expect(resolveImageSource(lazyPage))
      .toBe('https://roliascan.org/storage/chapters/manhwa_1/page_002.webp');

    // A genuine inline SVG image with no other source remains usable via the last fallback.
    const inlineSvgOnly = document.createElement('img');
    inlineSvgOnly.src = longSvgPlaceholder;
    expect(resolveImageSource(inlineSvgOnly)).toBe(longSvgPlaceholder);
  });
});

describe('point-based media target resolution', () => {
  it('resolves the target at a raw viewport point without a mouse event', () => {
    const img = document.createElement('img');
    img.src = 'https://roliascan.org/storage/chapters/manhwa_1/page_001.webp';
    setRect(img, LARGE_RECT);
    document.body.appendChild(img);
    vi.mocked(document.elementsFromPoint).mockReturnValue([img]);

    const target = resolveMediaTargetAtPoint(200, 150);
    expect(target).not.toBeNull();
    expect(target?.surfaceElement).toBe(img);
    expect(target?.srcUrl).toBe('https://roliascan.org/storage/chapters/manhwa_1/page_001.webp');
  });

  it('returns null when the point has no eligible media (scrolling into a gap)', () => {
    vi.mocked(document.elementsFromPoint).mockReturnValue([]);
    expect(resolveMediaTargetAtPoint(200, 150)).toBeNull();
  });
});

describe('CSS background source resolution', () => {
  it('extracts image URLs from gradient and multiple-background declarations', () => {
    expect(getBackgroundUrls('linear-gradient(#0008, #0008), url("/page.webp")'))
      .toEqual(['http://localhost:3000/page.webp']);
    expect(getBackgroundUrls('url("https://cdn.example/a.webp"), url(https://cdn.example/b.webp)'))
      .toEqual(['https://cdn.example/a.webp', 'https://cdn.example/b.webp']);
  });

  it('filters inline SVG placeholder backgrounds so lazy containers never win hover (roliascan.com)', () => {
    // Reproduces issue #2's second layer: lazy-container ::before pseudo-elements carry a
    // 500+ char SVG loading icon as background-image; the container (larger than the img)
    // won hover resolution and queued the icon instead of the real page URL.
    const placeholderBg = 'url("data:image/svg+xml;base64,' + 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci'.repeat(6) + '")';
    expect(getBackgroundUrls(placeholderBg)).toEqual([]);
    expect(getBackgroundUrls('url("https://roliascan.org/storage/chapters/manhwa_1/page_002.webp")'))
      .toEqual(['https://roliascan.org/storage/chapters/manhwa_1/page_002.webp']);
  });
});

describe('media target discovery', () => {
  it('keeps ordinary visible images on the unchanged image surface path', () => {
    const img = document.createElement('img');
    img.src = '/page.jpg';
    setRect(img, LARGE_RECT);
    document.body.append(img);

    expect(createMediaTarget(img)).toMatchObject({ imgElement: img, surfaceElement: img, hiddenBacking: false });
  });

  it('accepts a hidden backing image only with an associated visible background surface', () => {
    const surface = document.createElement('div');
    surface.style.backgroundImage = 'url("/page.jpg")';
    const img = document.createElement('img');
    img.src = '/page.jpg';
    img.style.opacity = '0';
    setRect(surface, LARGE_RECT);
    setRect(img, SMALL_RECT);
    surface.append(img);
    document.body.append(surface);

    expect(createMediaTarget(img)).toMatchObject({ imgElement: img, surfaceElement: surface, hiddenBacking: true });

    surface.style.backgroundImage = 'url("/different.jpg")';
    expect(createMediaTarget(img)).toBeNull();
  });

  it('discovers a CSS background without a backing image', () => {
    const surface = document.createElement('div');
    surface.style.backgroundImage = 'url("/background-page.webp")';
    setRect(surface, LARGE_RECT);
    document.body.append(surface);

    expect(discoverMediaTargets()).toContainEqual(expect.objectContaining({
      kind: 'background',
      sourceElement: surface,
      surfaceElement: surface,
    }));
  });

  it('discovers images inside an open Shadow DOM and anchors to its host', () => {
    const host = document.createElement('div');
    setRect(host, LARGE_RECT);
    const shadow = host.attachShadow({ mode: 'open' });
    const image = document.createElement('img');
    image.src = '/shadow-page.webp';
    setRect(image, LARGE_RECT);
    shadow.append(image);
    document.body.append(host);

    expect(discoverMediaTargets()).toContainEqual(expect.objectContaining({
      imgElement: image,
      surfaceElement: image,
      anchorElement: host,
    }));
  });

  it('deduplicates multiple backing images sharing one visible surface', () => {
    const surface = document.createElement('div');
    surface.style.backgroundImage = 'url("/page.jpg")';
    setRect(surface, LARGE_RECT);
    for (let index = 0; index < 2; index += 1) {
      const img = document.createElement('img');
      img.src = '/page.jpg';
      img.style.opacity = '0';
      setRect(img, SMALL_RECT);
      surface.append(img);
    }
    document.body.append(surface);

    expect(discoverMediaTargets()).toHaveLength(1);
  });
});

describe('translated media state', () => {
  it('reapplies hidden backing visibility and suppressed surface background', () => {
    const surface = document.createElement('div');
    const img = document.createElement('img');
    surface.append(img);
    surface.setAttribute('data-kites-background-suppressed', 'true');
    img.setAttribute('data-kites-applied-opacity', '1');
    img.setAttribute('data-kites-applied-z-index', '1');
    img.setAttribute('data-kites-applied-pointer-events', 'none');
    img.style.opacity = '0';
    img.style.visibility = 'hidden';
    img.style.zIndex = '-1';
    img.style.pointerEvents = 'auto';
    surface.style.backgroundImage = 'url("/original.jpg")';

    reapplyMediaTargetStyles(img, surface);

    expect(img.style.opacity).toBe('1');
    expect(img.style.visibility).toBe('visible');
    expect(img.style.zIndex).toBe('1');
    expect(img.style.pointerEvents).toBe('none');
    expect(surface.style.backgroundImage).toBe('none');
  });
});

describe('hover media resolution', () => {
  it('rejects candidates whose surface does not contain the pointer', () => {
    const img = document.createElement('img');
    img.src = '/outside.jpg';
    setRect(img, { ...LARGE_RECT, x: 100, y: 100, top: 100, left: 100, right: 500, bottom: 400 });
    document.body.append(img);

    expect(resolveHoverMediaTarget(createHoverEvent(img, [img, document.body, document]))).toBeNull();
  });

  it('uses a narrow wrapper fallback and prefers the largest eligible surface', () => {
    const wrapper = document.createElement('div');
    const small = document.createElement('img');
    const large = document.createElement('img');
    small.src = '/small.jpg';
    large.src = '/large.jpg';
    setRect(small, { ...LARGE_RECT, right: 200, bottom: 180, width: 200, height: 180 });
    setRect(large, LARGE_RECT);
    wrapper.append(small, large);
    document.body.append(wrapper);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [large]) });

    expect(resolveHoverMediaTarget(createHoverEvent(wrapper, [wrapper, document.body, document])))
      .toMatchObject({ imgElement: large, surfaceElement: large });
  });

  it('filters hover targets using custom selector when provided', () => {
    const reader = document.createElement('div');
    reader.id = 'readerarea';
    const readerImg = document.createElement('img');
    readerImg.src = '/chapter1.jpg';
    setRect(readerImg, LARGE_RECT);
    reader.append(readerImg);

    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar';
    const sidebarImg = document.createElement('img');
    sidebarImg.src = '/ad.jpg';
    setRect(sidebarImg, LARGE_RECT);
    sidebar.append(sidebarImg);

    document.body.append(reader, sidebar);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [readerImg]) });

    // Matches custom selector
    expect(
      resolveHoverMediaTarget(createHoverEvent(readerImg, [readerImg, reader, document.body, document]), '#readerarea img')
    ).toMatchObject({ imgElement: readerImg });

    // Does not match custom selector
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [sidebarImg]) });
    expect(
      resolveHoverMediaTarget(createHoverEvent(sidebarImg, [sidebarImg, sidebar, document.body, document]), '#readerarea img')
    ).toBeNull();
  });

  it('drops hover targets in noise containers when no custom selector is set', () => {
    const aside = document.createElement('aside');
    aside.className = 'sidebar';
    const adImg = document.createElement('img');
    adImg.src = '/banner.jpg';
    setRect(adImg, LARGE_RECT);
    aside.append(adImg);
    document.body.append(aside);

    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [adImg]) });
    expect(resolveHoverMediaTarget(createHoverEvent(adImg, [adImg, aside, document.body, document]))).toBeNull();
  });

  it('resolves images behind anti-scrape overlays via elementsFromPoint without querying outer feed containers (X.com pattern)', () => {
    // Mimic X.com (Twitter) timeline structure:
    // div#react-root -> main -> div[data-testid="primaryColumn"] -> article[data-testid="tweet"] -> overlay + img
    const reactRoot = document.createElement('div');
    reactRoot.id = 'react-root';
    const main = document.createElement('main');
    const primaryColumn = document.createElement('div');
    primaryColumn.setAttribute('data-testid', 'primaryColumn');
    const tweet = document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');

    const photoWrapper = document.createElement('div');
    photoWrapper.setAttribute('data-testid', 'tweetPhoto');

    const img = document.createElement('img');
    img.src = 'https://pbs.twimg.com/media/tweet_image.jpg';
    setRect(img, LARGE_RECT);

    // X.com transparent overlay that sits on top of the image to intercept pointer events
    const overlay = document.createElement('div');
    overlay.className = 'css-175oi2r transparent-overlay';
    setRect(overlay, LARGE_RECT);

    photoWrapper.append(img, overlay);
    tweet.append(photoWrapper);
    primaryColumn.append(tweet);
    main.append(primaryColumn);
    reactRoot.append(main);
    document.body.append(reactRoot);

    // Spy on high-level feed containers to guarantee no feed-wide querySelectorAll thrashing
    const mainQuerySpy = vi.spyOn(main, 'querySelectorAll');
    const rootQuerySpy = vi.spyOn(reactRoot, 'querySelectorAll');
    const columnQuerySpy = vi.spyOn(primaryColumn, 'querySelectorAll');

    // Native C++ elementsFromPoint returns the overlay on top and the image beneath it
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [overlay, photoWrapper, img, tweet, primaryColumn, main, reactRoot, document.body]),
    });

    const event = createHoverEvent(overlay, [
      overlay,
      photoWrapper,
      tweet,
      primaryColumn,
      main,
      reactRoot,
      document.body,
      document,
    ]);

    const target = resolveHoverMediaTarget(event);

    expect(target).not.toBeNull();
    expect(target?.imgElement).toBe(img);
    expect(target?.srcUrl).toBe('https://pbs.twimg.com/media/tweet_image.jpg');

    // High-level feed containers must NOT be queried on hover
    expect(mainQuerySpy).not.toHaveBeenCalled();
    expect(rootQuerySpy).not.toHaveBeenCalled();
    expect(columnQuerySpy).not.toHaveBeenCalled();
  });

  it('stops descendant query traversal at card container boundaries during fallback search', () => {
    const feed = document.createElement('div');
    feed.id = 'feed-column';

    const card = document.createElement('article');
    card.setAttribute('role', 'article');

    const wrapper = document.createElement('div');
    const img = document.createElement('img');
    img.src = '/card-image.jpg';
    setRect(img, LARGE_RECT);
    wrapper.append(img);
    card.append(wrapper);
    feed.append(card);
    document.body.append(feed);

    const feedQuerySpy = vi.spyOn(feed, 'querySelectorAll');

    // Simulate elementsFromPoint returning only the wrapper (fallback search needed)
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [wrapper]),
    });

    const event = createHoverEvent(wrapper, [wrapper, card, feed, document.body, document]);
    const target = resolveHoverMediaTarget(event);

    expect(target).not.toBeNull();
    expect(target?.imgElement).toBe(img);
    // Boundary guard: the query must never bubble past the article boundary to query the entire feed
    expect(feedQuerySpy).not.toHaveBeenCalled();
  });

  it('caches canvas dataURL across repeated hover checks to avoid synchronous toDataURL GPU stalls', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    setRect(canvas, LARGE_RECT);
    document.body.append(canvas);

    const toDataUrlSpy = vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,mockedCanvasData');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [canvas]),
    });

    const event = createHoverEvent(canvas, [canvas, document.body, document]);

    const first = resolveHoverMediaTarget(event);
    expect(first).not.toBeNull();
    expect(first?.kind).toBe('canvas');
    expect(toDataUrlSpy).toHaveBeenCalledTimes(1);

    // Second hover immediately after must use the cached data URL
    const second = resolveHoverMediaTarget(event);
    expect(second).not.toBeNull();
    expect(second?.srcUrl).toBe('data:image/png;base64,mockedCanvasData');
    expect(toDataUrlSpy).toHaveBeenCalledTimes(1);
  });
});

describe('incremental mutation scan helpers', () => {
  it('discovers a bare img added without a wrapper element (self inclusion)', () => {
    const img = document.createElement('img');
    img.src = '/bare-page.jpg';
    setRect(img, LARGE_RECT);

    const targets = discoverAddedMediaTargets(img);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ imgElement: img, surfaceElement: img });
  });

  it('discovers descendants of an inserted container and deduplicates shared surfaces', () => {
    const container = document.createElement('article');
    const surface = document.createElement('div');
    surface.style.backgroundImage = 'url("/wrapped.jpg")';
    setRect(surface, LARGE_RECT);
    const img = document.createElement('img');
    img.src = '/wrapped.jpg';
    img.style.opacity = '0';
    setRect(img, SMALL_RECT);
    surface.append(img);
    container.append(surface);

    const targets = discoverAddedMediaTargets(container);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: 'img', surfaceElement: surface, hiddenBacking: true });
  });

  it('honors custom selector overrides inside inserted subtrees', () => {
    const container = document.createElement('div');
    const custom = document.createElement('div');
    custom.setAttribute('data-page', 'true');
    custom.style.backgroundImage = 'url("/custom-rule.jpg")';
    setRect(custom, LARGE_RECT);
    container.append(custom);

    const targets = discoverAddedMediaTargets(container, '[data-page="true"]');

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: 'background', sourceElement: custom });
  });

  it('resolves a style mutation that reveals a background image on the element itself', () => {
    const surface = document.createElement('div');
    surface.style.backgroundImage = 'url("/style-revealed.jpg")';
    setRect(surface, LARGE_RECT);

    expect(createStyleRevealedTarget(surface)).toMatchObject({
      kind: 'background',
      sourceElement: surface,
      surfaceElement: surface,
    });
  });

  it('never triggers canvas toDataURL from a style mutation', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    setRect(canvas, LARGE_RECT);
    const toDataUrlSpy = vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,unused');

    expect(createStyleRevealedTarget(canvas)).toBeNull();
    expect(toDataUrlSpy).not.toHaveBeenCalled();
  });

  it('ignores style mutations on images and plain elements without backgrounds', () => {
    const img = document.createElement('img');
    img.src = '/plain.jpg';
    setRect(img, LARGE_RECT);
    const plain = document.createElement('div');
    setRect(plain, LARGE_RECT);

    expect(createStyleRevealedTarget(img)).toBeNull();
    expect(createStyleRevealedTarget(plain)).toBeNull();
  });
});
