// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createMediaTarget,
  discoverMediaTargets,
  resolveHoverMediaTarget,
  resolveImageSource,
  surfaceContainsPoint,
} from './mediaTargets';

const CONTENT_CSS_PATH = path.resolve(__dirname, 'content.css');
const LARGE_RECT = { x: 50, y: 50, top: 50, left: 50, right: 850, bottom: 1250, width: 800, height: 1200, toJSON: () => ({}) };

/**
 * Assigns a deterministic rendered rectangle to a jsdom element.
 *
 * @param element - Element receiving mocked geometry.
 * @param rect - Rectangle returned by getBoundingClientRect.
 */
function mockRect(element: Element, rect: typeof LARGE_RECT): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
}

/**
 * Creates a synthetic mouse event with controlled client coordinates and event target.
 *
 * @param target - Element receiving the hover event.
 * @param clientX - X viewport coordinate.
 * @param clientY - Y viewport coordinate.
 * @returns Synthetic MouseEvent.
 */
function createMouseEvent(target: Element, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent('mouseover', { clientX, clientY, bubbles: true });
  Object.defineProperty(event, 'target', { value: target });
  vi.spyOn(event, 'composedPath').mockReturnValue([target, target.parentElement || document.body, document.body, document]);
  return event;
}

describe('Frontend UI & Button CSS Contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('ensures content.css defines required positioning and dimension styles for translate button and control wrapper', () => {
    const css = fs.readFileSync(CONTENT_CSS_PATH, 'utf-8');

    // Regression prevention: .kites-translate-control, [data-kites-translate-control],
    // #kites-translate-btn, [data-kites-translate-button] must all be styled in CSS.
    expect(css).toContain('.kites-translate-control');
    expect(css).toContain('[data-kites-translate-control]');
    expect(css).toContain('#kites-translate-btn');
    expect(css).toContain('[data-kites-translate-button]');
    expect(css).toContain('.kites-translate-btn');

    // Inject content.css into the DOM
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // Create TranslateButton DOM structure as rendered by React
    const wrapper = document.createElement('div');
    wrapper.className = 'kites-translate-control';
    wrapper.setAttribute('data-kites-translate-control', 'true');

    const button = document.createElement('button');
    button.id = 'kites-translate-btn';
    button.className = 'kites-translate-btn';
    button.setAttribute('data-kites-translate-button', 'true');

    wrapper.appendChild(button);
    document.body.appendChild(wrapper);

    const wrapperStyle = window.getComputedStyle(wrapper);
    const buttonStyle = window.getComputedStyle(button);

    // Position MUST be fixed so CSS Anchor Positioning (top: anchor(top), left: anchor(left)) functions
    expect(wrapperStyle.position).toBe('fixed');
    expect(wrapperStyle.zIndex).toBe('999999');

    // Button MUST have non-zero dimensions and brand background color
    expect(buttonStyle.width).toBe('32px');
    expect(buttonStyle.height).toBe('32px');
    expect(buttonStyle.borderRadius).toBe('50%');
    expect(buttonStyle.backgroundColor).toBe('rgb(255, 45, 117)');
  });
});

describe('Manga Reader & Nested Image Hover Handling Logic', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => []) });
  });

  it('resolves image immediately when hovering directly on an HTMLImageElement', () => {
    const img = document.createElement('img');
    img.src = 'https://i7.nhentai.net/galleries/12345/1.jpg';
    mockRect(img, LARGE_RECT);
    document.body.appendChild(img);

    const event = createMouseEvent(img, 100, 100);
    const target = resolveHoverMediaTarget(event);

    expect(target).not.toBeNull();
    expect(target?.imgElement).toBe(img);
    expect(target?.surfaceElement).toBe(img);
    expect(target?.srcUrl).toBe('https://i7.nhentai.net/galleries/12345/1.jpg');
    expect(target?.hiddenBacking).toBe(false);
  });

  it('resolves image when cursor hovers over enclosing anchor/div wrapper (e.g. nhentai reader links)', () => {
    const container = document.createElement('div');
    container.id = 'image-container';

    const link = document.createElement('a');
    link.href = '/g/12345/2/';

    const img = document.createElement('img');
    img.src = 'https://i7.nhentai.net/galleries/12345/1.jpg';

    mockRect(container, LARGE_RECT);
    mockRect(link, LARGE_RECT);
    mockRect(img, LARGE_RECT);

    link.appendChild(img);
    container.appendChild(link);
    document.body.appendChild(container);

    // Cursor lands on the <a> link wrapper instead of the raw <img>
    const event = createMouseEvent(link, 150, 150);
    const target = resolveHoverMediaTarget(event);

    expect(target).not.toBeNull();
    expect(target?.imgElement).toBe(img);
    expect(target?.srcUrl).toBe('https://i7.nhentai.net/galleries/12345/1.jpg');
  });

  it('bypasses 1x1 blank GIF and SVG placeholders to retrieve actual data-src', () => {
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.setAttribute('data-src', 'https://i7.nhentai.net/galleries/12345/1.jpg');
    mockRect(img, LARGE_RECT);
    document.body.appendChild(img);

    const resolved = resolveImageSource(img);
    expect(resolved).toBe('https://i7.nhentai.net/galleries/12345/1.jpg');

    const target = createMediaTarget(img);
    expect(target).not.toBeNull();
    expect(target?.srcUrl).toBe('https://i7.nhentai.net/galleries/12345/1.jpg');
  });

  it('tolerates subpixel mouse coordinates within 3px tolerance margin', () => {
    const element = document.createElement('div');
    mockRect(element, { x: 100, y: 100, top: 100, left: 100, right: 300, bottom: 300, width: 200, height: 200, toJSON: () => ({}) });

    // Exactly on edge
    expect(surfaceContainsPoint(element, 100, 100)).toBe(true);
    expect(surfaceContainsPoint(element, 300, 300)).toBe(true);

    // 2px outside edge (subpixel margin)
    expect(surfaceContainsPoint(element, 98, 100)).toBe(true);
    expect(surfaceContainsPoint(element, 302, 300)).toBe(true);

    // 10px outside edge -> must reject
    expect(surfaceContainsPoint(element, 89, 100)).toBe(false);
    expect(surfaceContainsPoint(element, 315, 300)).toBe(false);
  });

  it('discovers all eligible images in document for persistent mode while rejecting thumbnails', () => {
    const normalMangaPage = document.createElement('img');
    normalMangaPage.src = 'https://i7.nhentai.net/galleries/12345/1.jpg';
    mockRect(normalMangaPage, LARGE_RECT);

    const thumbnail = document.createElement('img');
    thumbnail.src = 'https://i7.nhentai.net/galleries/12345/thumb.jpg';
    mockRect(thumbnail, { x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 100, width: 80, height: 100, toJSON: () => ({}) });

    document.body.appendChild(normalMangaPage);
    document.body.appendChild(thumbnail);

    const targets = discoverMediaTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].srcUrl).toBe('https://i7.nhentai.net/galleries/12345/1.jpg');
  });
});
