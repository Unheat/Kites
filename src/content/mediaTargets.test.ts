// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaTarget,
  discoverMediaTargets,
  reapplyMediaTargetStyles,
  resolveHoverMediaTarget,
  resolveImageSource,
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
});
