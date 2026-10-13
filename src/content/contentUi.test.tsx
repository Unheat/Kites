// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'fs';
import path from 'path';
import {
  createMediaTarget,
  discoverMediaTargets,
  resolveHoverMediaTarget,
  resolveImageSource,
  surfaceContainsPoint,
} from './mediaTargets';
import { GlobalOverlay } from './contentUi';
import { STORAGE_KEYS } from '../shared/constants';

const CONTENT_CSS_PATH = path.resolve(__dirname, 'content.css');
const LARGE_RECT = {
  x: 50,
  y: 50,
  top: 50,
  left: 50,
  right: 850,
  bottom: 1250,
  width: 800,
  height: 1200,
  toJSON: () => ({}),
};

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
function createMouseEvent(
  target: Element,
  clientX: number,
  clientY: number,
): MouseEvent {
  const event = new MouseEvent('mouseover', {
    clientX,
    clientY,
    bubbles: true,
  });
  Object.defineProperty(event, 'target', { value: target });
  vi.spyOn(event, 'composedPath').mockReturnValue([
    target,
    target.parentElement || document.body,
    document.body,
    document,
  ]);
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
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });
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
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.setAttribute(
      'data-src',
      'https://i7.nhentai.net/galleries/12345/1.jpg',
    );
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
    mockRect(element, {
      x: 100,
      y: 100,
      top: 100,
      left: 100,
      right: 300,
      bottom: 300,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    });

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
    mockRect(thumbnail, {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 80,
      bottom: 100,
      width: 80,
      height: 100,
      toJSON: () => ({}),
    });

    document.body.appendChild(normalMangaPage);
    document.body.appendChild(thumbnail);

    const targets = discoverMediaTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].srcUrl).toBe(
      'https://i7.nhentai.net/galleries/12345/1.jpg',
    );
  });
});

describe('GlobalOverlay lifecycle integration', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let settings: Record<string, unknown>;
  let listeners: Set<(message: any) => void>;
  let storageListeners: Set<(changes: any, area: string) => void>;
  let callbacks: Map<string, (response: any) => void>;
  let intersections: Array<{
    callback: IntersectionObserverCallback;
    elements: Element[];
  }>;

  /** Sends a background event through the real overlay listener set. Returns nothing. */
  function emit(type: string, payload: any): void {
    act(() =>
      listeners.forEach((listener) =>
        listener({
          type,
          target: 'content',
          source: 'background',
          event: true,
          payload,
        }),
      ),
    );
  }
  /** Applies popup state through the real Chrome storage event. Returns nothing. */
  function updateSettings(next: Record<string, unknown>): void {
    settings = { ...settings, ...next };
    act(() =>
      storageListeners.forEach((listener) =>
        listener(
          { [STORAGE_KEYS.POPUP_STATE]: { newValue: settings } },
          'local',
        ),
      ),
    );
  }
  /** Adds a real discovered media surface with deterministic geometry. Returns image. */
  function image(name: string, rect = LARGE_RECT): HTMLImageElement {
    const img = document.createElement('img');
    img.src = `https://example.com/${name}.jpg`;
    mockRect(img, rect);
    document.body.appendChild(img);
    return img;
  }
  /** Mounts the importable overlay, not the content entrypoint. Returns nothing. */
  function mount(): void {
    act(() => root.render(<GlobalOverlay />));
  }
  /** Hovers a page image using actual bubbling DOM events. Returns nothing. */
  function hover(img: HTMLImageElement): void {
    act(() => img.dispatchEvent(createMouseEvent(img, 100, 100)));
  }
  /** Moves off all media and settles the existing hover-dismiss timer. Returns nothing. */
  function leave(img: HTMLImageElement): void {
    act(() => {
      img.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: document.body,
          clientX: 900,
          clientY: 10,
        }),
      );
      document.body.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          clientX: 900,
          clientY: 10,
        }),
      );
      vi.advanceTimersByTime(150);
    });
  }
  /** Gets the single image control by its source URL. Returns control or null. */
  function control(img: HTMLImageElement): HTMLDivElement | null {
    return (
      Array.from(
        container.querySelectorAll<HTMLDivElement>(
          '[data-kites-translate-control]',
        ),
      ).find((node) => node.dataset.kitesUrl === img.src) || null
    );
  }
  /** Gets a control's clickable element. Returns button. */
  function button(img: HTMLImageElement): HTMLButtonElement {
    return control(img)!.querySelector('button')!;
  }
  /** Clicks a real control and accepts its request using background lifecycle event. */
  function queue(img: HTMLImageElement, jobId: number): void {
    hover(img);
    act(() => button(img).click());
    emit('IMAGE_QUEUED', { originalUrl: img.src, jobId });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    settings = {
      isExtensionEnabled: true,
      manualMode: 'hover',
      isAuto: false,
      concurrency: 1,
    };
    listeners = new Set();
    storageListeners = new Set();
    callbacks = new Map();
    intersections = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        entry: { callback: IntersectionObserverCallback; elements: Element[] };
        constructor(callback: IntersectionObserverCallback) {
          this.entry = { callback, elements: [] };
          intersections.push(this.entry);
        }
        observe(element: Element) {
          this.entry.elements.push(element);
        }
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-kites-id',
        lastError: undefined,
        sendMessage: vi.fn((message, callback) =>
          callbacks.set(message.url, callback),
        ),
        onMessage: {
          addListener: (listener: any) => listeners.add(listener),
          removeListener: (listener: any) => listeners.delete(listener),
        },
      },
      storage: {
        local: {
          get: (_key: any, callback: any) =>
            callback({ [STORAGE_KEYS.POPUP_STATE]: settings }),
        },
        onChanged: {
          addListener: (listener: any) => storageListeners.add(listener),
          removeListener: (listener: any) => storageListeners.delete(listener),
        },
      },
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    });
    container = document.createElement('div');
    container.id = 'kites-global-overlay';
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    expect(listeners.size).toBe(0);
    expect(storageListeners.size).toBe(0);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pins three independent jobs, leaves an unqueued hover idle, and removes only completed target', () => {
    const images = [image('one'), image('two'), image('three'), image('idle')];
    mount();
    images.slice(0, 3).forEach((img, index) => queue(img, index + 1));
    hover(images[3]);
    expect(
      container.querySelectorAll('[data-kites-translate-control]'),
    ).toHaveLength(4);
    images
      .slice(0, 3)
      .forEach((img) => expect(button(img).disabled).toBe(true));
    expect(button(images[3]).disabled).toBe(false);
    leave(images[3]);
    expect(
      container.querySelectorAll('[data-kites-translate-control]'),
    ).toHaveLength(3);
    emit('IMAGE_TRANSLATED', { originalUrl: images[1].src, jobId: 2 });
    expect(control(images[1])).toBeNull();
    expect(button(images[0]).disabled).toBe(true);
    expect(button(images[2]).disabled).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3); // Local concurrency=1 is NOT queue admission.
  });

  it('keeps fast queue rejection idle and pinned until feedback timeout after pointer leaves', () => {
    const img = image('full');
    mount();
    hover(img);
    act(() => button(img).click());
    const callback = callbacks.get(img.src)!;
    emit('TRANSLATION_ERROR', {
      originalUrl: img.src,
      code: 'QUEUE_FULL',
      error: 'Queue is full',
    });
    act(() => callback({ status: 'error', code: 'QUEUE_FULL' }));
    expect(button(img).disabled).toBe(false);
    expect(control(img)!.textContent).toContain('Queue limit reached');
    leave(img);
    act(() => vi.advanceTimersByTime(2349));
    expect(control(img)).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(control(img)).toBeNull();
  });

  it('callback transport failure clears busy, shows generic feedback and cannot erase a retry', () => {
    const img = image('transport');
    mount();
    hover(img);
    act(() => button(img).click());
    act(() => {
      (chrome.runtime as any).lastError = { message: 'Message port closed' };
      callbacks.get(img.src)!({});
      (chrome.runtime as any).lastError = undefined;
    });
    expect(button(img).disabled).toBe(false);
    expect(control(img)!.textContent).toContain('Translation failed');
    act(() => button(img).click());
    emit('IMAGE_QUEUED', { originalUrl: img.src, jobId: 8 });
    act(() => vi.advanceTimersByTime(3000));
    expect(button(img).disabled).toBe(true);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src, jobId: 7 });
    expect(button(img).disabled).toBe(true);
    leave(img);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src, jobId: 8 });
    expect(control(img)).toBeNull();
  });

  it('removes generic failure pin at 3000ms and late callback cannot resurrect terminal work', () => {
    const img = image('late');
    mount();
    queue(img, 1);
    const callback = callbacks.get(img.src)!;
    leave(img);
    emit('TRANSLATION_ERROR', {
      originalUrl: img.src,
      jobId: 1,
      error: 'Failed',
    });
    act(() => vi.advanceTimersByTime(2999));
    expect(control(img)).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(control(img)).toBeNull();
    act(() => callback({ status: 'queued', jobId: 1 }));
    expect(control(img)).toBeNull();
  });

  it('right-click accepted events create busy control and completion removes it with no hover', () => {
    const img = image('context');
    mount();
    expect(control(img)).toBeNull();
    emit('IMAGE_QUEUED', { originalUrl: img.src, jobId: 3 });
    expect(button(img).disabled).toBe(true);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src });
    expect(control(img)).toBeNull();
  });

  it('right-click rejection pins idle feedback without any optimistic pending job', () => {
    const img = image('context-full');
    mount();
    expect(control(img)).toBeNull();
    emit('TRANSLATION_ERROR', {
      originalUrl: img.src,
      code: 'QUEUE_FULL',
      error: 'Queue is full',
    });
    expect(button(img).disabled).toBe(false);
    expect(control(img)!.textContent).toContain('Queue limit reached');
    act(() => vi.advanceTimersByTime(2499));
    expect(control(img)).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(control(img)).toBeNull();
  });

  it('accepted event then fast terminal then callback cannot recreate a completed spinner', () => {
    const img = image('terminal-race');
    mount();
    queue(img, 4);
    const callback = callbacks.get(img.src)!;
    leave(img);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src, jobId: 4 });
    expect(control(img)).toBeNull();
    act(() => callback({ status: 'queued', jobId: 4 }));
    expect(control(img)).toBeNull();
  });

  it('auto shows no idle or pending controls, only accepted jobs, including manual/context jobs', () => {
    settings.isAuto = true;
    settings.manualMode = 'persistent';
    const img = image('auto');
    const context = image('auto-context');
    mount();
    hover(img);
    expect(
      container.querySelectorAll('[data-kites-translate-control]'),
    ).toHaveLength(0);
    const io = intersections[0];
    act(() =>
      io.callback(
        [
          {
            target: img,
            isIntersecting: true,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(control(img)).toBeNull();
    act(() => callbacks.get(img.src)!({ status: 'error', code: 'QUEUE_FULL' }));
    expect(control(img)).toBeNull();
    emit('IMAGE_QUEUED', { originalUrl: context.src, jobId: 9 });
    expect(button(context).disabled).toBe(true);
    // Re-entering retries a rejected auto URL; accepted event alone creates its spinner.
    act(() =>
      io.callback(
        [
          {
            target: img,
            isIntersecting: true,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    emit('IMAGE_QUEUED', { originalUrl: img.src, jobId: 10 });
    expect(button(img).disabled).toBe(true);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src });
    expect(control(img)).toBeNull();
  });

  it('persistent manual targets deduplicate pinned controls using stable anchor and URL', () => {
    settings.manualMode = 'persistent';
    const img = image('persistent');
    mount();
    const before = control(img);
    act(() => button(img).click());
    emit('IMAGE_QUEUED', { originalUrl: img.src, jobId: 1 });
    expect(
      container.querySelectorAll('[data-kites-translate-control]'),
    ).toHaveLength(1);
    expect(control(img)).toBe(before);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src });
    expect(control(img)).toBe(before);
    expect(button(img).disabled).toBe(false);
  });

  it('uses same clamp and mounted control while idle becomes busy and back', () => {
    settings.manualMode = 'persistent';
    const img = image('tall', {
      ...LARGE_RECT,
      y: -2000,
      top: -2000,
      bottom: 10000,
      height: 12000,
    });
    mount();
    const before = control(img)!;
    expect(before.style.top).toBe('16px');
    act(() => button(img).click());
    emit('IMAGE_QUEUED', { originalUrl: img.src, jobId: 1 });
    expect(control(img)).toBe(before);
    expect(before.style.top).toBe('16px');
    expect(button(img).disabled).toBe(true);
    emit('IMAGE_TRANSLATED', { originalUrl: img.src });
    expect(control(img)).toBe(before);
    expect(before.style.top).toBe('16px');
    vi.mocked(img.getBoundingClientRect).mockReturnValue(LARGE_RECT as DOMRect);
    const setProperty = vi.spyOn(before.style, 'setProperty');
    act(() => window.dispatchEvent(new Event('scroll')));
    // jsdom cannot parse CSS anchor(), so assert the real clamp's reset write.
    expect(setProperty).toHaveBeenCalledWith('top', 'anchor(top)');
  });

  it('hides all controls when disabled, retains accepted jobs, and processes terminal events while hidden', () => {
    const first = image('disable-one');
    const second = image('disable-two');
    mount();
    queue(first, 1);
    queue(second, 2);
    leave(second);
    updateSettings({ isExtensionEnabled: false });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    emit('IMAGE_TRANSLATED', { originalUrl: first.src });
    updateSettings({ isExtensionEnabled: true });
    expect(control(first)).toBeNull();
    expect(button(second).disabled).toBe(true);
  });

  it('hides recycled or disconnected targets and restores spinner only for original URL', async () => {
    const img = image('recycled');
    mount();
    queue(img, 1);
    leave(img);
    const original = img.src;
    await act(async () => {
      img.src = 'https://example.com/other.jpg';
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelectorAll('button')).toHaveLength(0);
    await act(async () => {
      img.src = original;
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(300));
    expect(button(img).disabled).toBe(true);
    await act(async () => {
      img.remove();
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('parent initialization delay shares pill rendering and ignores stale jobs; timers clear on finish', () => {
    const img = image('initialization');
    mount();
    queue(img, 2);
    emit('MODEL_INITIALIZATION', {
      originalUrl: img.src,
      jobId: 1,
      phase: 'started',
    });
    act(() => vi.advanceTimersByTime(700));
    expect(control(img)!.textContent).not.toContain('Preparing AI');
    emit('MODEL_INITIALIZATION', {
      originalUrl: img.src,
      jobId: 2,
      phase: 'started',
    });
    act(() => vi.advanceTimersByTime(699));
    expect(control(img)!.textContent).not.toContain('Preparing AI');
    act(() => vi.advanceTimersByTime(1));
    expect(control(img)!.textContent).toContain('Preparing AI');
    emit('MODEL_INITIALIZATION', {
      originalUrl: img.src,
      jobId: 2,
      phase: 'finished',
    });
    expect(control(img)!.textContent).not.toContain('Preparing AI');
  });

  it('import creates no overlay root or Chrome listener side effects', () => {
    expect(listeners.size).toBe(0);
    expect(container.childNodes).toHaveLength(0);
    expect(document.querySelectorAll('#kites-global-overlay')).toHaveLength(1); // Only harness-owned root.
  });
});
