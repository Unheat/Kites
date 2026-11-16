// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
import type { MediaTarget } from './mediaTargets';
import { STORAGE_KEYS } from '../shared/constants';

const media = vi.hoisted(() => ({
  targets: [] as MediaTarget[],
  underPointer: null as MediaTarget | null,
  resolve: vi.fn(),
}));
vi.mock('./captureArea', async (importOriginal) => ({
  ...await importOriginal<typeof import('./captureArea')>(),
  // Keep capture pending without animation frames, image decoding, or canvas scaffolding.
  waitForCleanFrames: () => new Promise<void>(() => undefined),
}));
vi.mock('./mediaTargets', async (importOriginal) => ({
  ...await importOriginal<typeof import('./mediaTargets')>(),
  discoverMediaTargets: () => media.targets,
  resolveMediaTargetAtPoint: (x: number, y: number) => {
    media.resolve(x, y);
    return media.underPointer;
  },
}));

const messages = new Set<(...args: any[]) => unknown>();
let state: { manualMode: 'hover' | 'persistent'; isExtensionEnabled: boolean; isAuto: boolean };
let content: typeof import('./index');
let sendMessage: ReturnType<typeof vi.fn>;

/** No-op observer prevents unrelated host mutation scans in this wiring test. */
class QuietObserver {
  /** Accepts the browser callback without scheduling host-page work. */
  constructor(_callback: unknown) {}
  /** Accepts an observation target; returns nothing. */
  observe(_target: unknown, _options?: unknown): void {}
  /** Disconnects this test observer; returns nothing. */
  disconnect(): void {}
  /** Returns no pending mutation records. */
  takeRecords(): MutationRecord[] { return []; }
}

/** Intersection observer that reports every observed surface immediately. */
class VisibleIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;
  /** Stores the callback used to report visibility. */
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  /** Reports one visible target; returns nothing. */
  observe(target: Element): void {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  /** No-op teardown for the fixture. */
  disconnect(): void {}
  /** No-op unobserving for the fixture. */
  unobserve(): void {}
  /** Returns no queued records. */
  takeRecords(): IntersectionObserverEntry[] { return []; }
  /** Root bounds are not used by the auto queue. */
  readonly root = null;
  /** Root margin is not used by the auto queue. */
  readonly rootMargin = '0px';
  /** Thresholds are not used by the auto queue. */
  readonly thresholds = [0];
}

/** Creates a connected media fixture; returns its target with deterministic geometry. */
function image(url: string): MediaTarget {
  const element = document.createElement('img');
  element.src = url;
  element.getBoundingClientRect = () => ({ left: 20, top: 20, right: 420, bottom: 620, width: 400, height: 600 } as DOMRect);
  document.body.appendChild(element);
  return { kind: 'img', srcUrl: url, sourceElement: element, surfaceElement: element, anchorElement: element, imgElement: element, hiddenBacking: false } as MediaTarget;
}

/** Mounts the real content entry with chosen manual mode; resolves after React effects. */
async function mount(mode: 'hover' | 'persistent' = 'persistent'): Promise<void> {
  state.manualMode = mode;
  await act(async () => { content = await import('./index'); });
}

/** Delivers one runtime message to installed listeners; resolves after React effects. */
async function deliver(message: unknown): Promise<void> {
  await act(async () => {
    for (const listener of [...messages]) listener(message, {}, vi.fn());
  });
}

/** Moves the pointer over media; returns nothing. */
function move(): void {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 80, clientY: 90 }));
}

/** Fires the boundary event that starts hover-mode tracking on one media surface. */
async function hover(target: MediaTarget): Promise<void> {
  await act(async () => {
    target.surfaceElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 80, clientY: 90 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** Seeds a finished image and presentation; returns nothing. */
function finish(target: MediaTarget): void {
  content.translatedRegistry.remember(target.srcUrl, target);
  content.translatedRegistry.complete(target.srcUrl, 'data:image/png;base64,AA==', 7, target);
  target.sourceElement.setAttribute('data-kites-orig-src', target.srcUrl);
  target.sourceElement.setAttribute('data-kites-applied-src', 'blob:translated');
  target.sourceElement.setAttribute('data-kites-translated', 'true');
  target.imgElement!.src = 'blob:translated';
}

beforeEach(() => {
  vi.resetModules();
  media.targets = [];
  media.underPointer = null;
  media.resolve.mockClear();
  messages.clear();
  document.body.innerHTML = '';
  state = { manualMode: 'persistent', isExtensionEnabled: true, isAuto: false };
  sendMessage = vi.fn();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('MutationObserver', QuietObserver);
  vi.stubGlobal('IntersectionObserver', QuietObserver);
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage, onMessage: {
      addListener: (listener: (...args: any[]) => unknown) => messages.add(listener),
      removeListener: (listener: (...args: any[]) => unknown) => messages.delete(listener),
    } },
    storage: { local: { get: (_key: unknown, callback: (value: unknown) => void) => callback({ [STORAGE_KEYS.POPUP_STATE]: state }) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:translated');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(async () => {
  const root = (document.getElementById('kites-global-overlay') as (HTMLElement & { _reactRoot?: Root }) | null)?._reactRoot;
  if (root) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('real content reading shortcut wiring', () => {
  it('resolves persistent target at command time, not the previous pointer target', async () => {
    const first = image('https://example.com/first.png');
    const second = image('https://example.com/second.png');
    media.targets = [first, second];
    media.underPointer = first;
    await mount();
    move();
    // Scrolling/replacement beneath a stationary pointer must target the new image.
    media.underPointer = second;
    await deliver({ type: 'TRANSLATE_HOVERED_IMAGE' });
    expect(media.resolve).toHaveBeenCalledWith(80, 90);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TRANSLATE_IMAGE', url: second.srcUrl }, expect.any(Function));
  });

  it('blocks area selection while a manual image translation is pending', async () => {
    const target = image('https://example.com/page.png');
    media.targets = [target];
    media.underPointer = target;
    await mount();
    move();
    await deliver({ type: 'TRANSLATE_HOVERED_IMAGE' });
    await deliver({ type: 'START_AREA_SELECTION' });
    expect(document.querySelector('.kites-snipper-backdrop')).toBeNull();
    expect(document.body.textContent).not.toContain('Drag to select');
  });

  it('uses a single area-selection path and blocks commands while capturing a crop', async () => {
    const target = image('https://example.com/page.png');
    media.targets = [target];
    media.underPointer = target;
    await mount();
    move();
    await deliver({ type: 'START_AREA_SELECTION' });
    expect(document.querySelectorAll('.kites-snipper-backdrop')).toHaveLength(1);
    const backdrop = document.querySelector('.kites-snipper-backdrop')!;
    await act(async () => { backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 })); });
    await act(async () => { backdrop.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 250, clientY: 250 })); });
    await act(async () => { backdrop.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 250, clientY: 250 })); });
    const button = document.querySelector<HTMLButtonElement>('[title="Translate area"]')!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    expect(document.querySelector('.kites-crop-frozen')).not.toBeNull();
    await deliver({ type: 'START_AREA_SELECTION' });
    await deliver({ type: 'TRANSLATE_HOVERED_IMAGE' });
    expect(document.querySelector('.kites-snipper-backdrop')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('synchronizes finished control labels after keyboard toggle', async () => {
    const target = image('https://example.com/page.png');
    media.targets = [target];
    media.underPointer = target;
    await mount();
    finish(target);
    await deliver({ type: 'IMAGE_TRANSLATED', payload: { originalUrl: target.srcUrl, bakedBase64: 'data:image/png;base64,AA==', jobId: 7 } });
    move();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true })); });
    expect(target.imgElement!.src).toBe(target.srcUrl);
    expect(document.querySelector('[data-kites-toggle-btn]')?.getAttribute('aria-label')).toBe('Show Translated Image');

    // Press 'f' again to toggle back to translated
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true })); });
    expect(target.imgElement!.src).toBe('blob:translated');
    expect(document.querySelector('[data-kites-toggle-btn]')?.getAttribute('aria-label')).toBe('Show Original Image');
  });

  it('toggles repeatedly between original and translated presentation when clicking the eye button', async () => {
    const target = image('https://example.com/page.png');
    media.targets = [target];
    media.underPointer = target;
    await mount();
    finish(target);
    await deliver({ type: 'IMAGE_TRANSLATED', payload: { originalUrl: target.srcUrl, bakedBase64: 'data:image/png;base64,AA==', jobId: 7 } });
    move();

    const toggleBtn = document.querySelector<HTMLButtonElement>('[data-kites-toggle-btn]');
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.getAttribute('aria-label')).toBe('Show Original Image');
    expect(target.imgElement!.src).toBe('blob:translated');

    // First click: switch to original
    await act(async () => { toggleBtn!.click(); });
    expect(target.imgElement!.src).toBe(target.srcUrl);
    expect(target.sourceElement.getAttribute('data-kites-show-original')).toBe('true');
    expect(toggleBtn?.getAttribute('aria-label')).toBe('Show Translated Image');

    // Second click: switch back to translated
    await act(async () => { toggleBtn!.click(); });
    expect(target.imgElement!.src).toBe('blob:translated');
    expect(target.sourceElement.getAttribute('data-kites-show-original')).toBeNull();
    expect(toggleBtn?.getAttribute('aria-label')).toBe('Show Original Image');

    // Third click: switch to original again
    await act(async () => { toggleBtn!.click(); });
    expect(target.imgElement!.src).toBe(target.srcUrl);
    expect(target.sourceElement.getAttribute('data-kites-show-original')).toBe('true');
    expect(toggleBtn?.getAttribute('aria-label')).toBe('Show Translated Image');
  });

  it('shows a pinned spinner for an auto-translated visible image', async () => {
    const target = image('https://example.com/auto.png');
    media.targets = [target];
    state.isAuto = true;
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
    await mount('hover');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(sendMessage).toHaveBeenCalledWith({ type: 'TRANSLATE_IMAGE', url: target.srcUrl }, expect.any(Function));
    const control = document.querySelector<HTMLElement>('[data-kites-translate-control]');
    expect(control).not.toBeNull();
    expect(control?.dataset.kitesSrcUrl).toBe(target.srcUrl);
    expect(control?.querySelector('button')?.disabled).toBe(true);
  });

  it('keeps a pending spinner pinned to its image while the pointer hovers another', async () => {
    const first = image('https://example.com/first.png');
    const second = image('https://example.com/second.png');
    media.targets = [first, second];
    media.underPointer = first;
    await mount('hover');
    await hover(first);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-kites-translate-button]')!.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TRANSLATE_IMAGE', url: first.srcUrl }, expect.any(Function));
    expect(document.querySelectorAll('[data-kites-translate-control]')).toHaveLength(1);

    media.underPointer = second;
    await hover(second);
    const controls = [...document.querySelectorAll<HTMLElement>('[data-kites-translate-control]')];
    expect(controls).toHaveLength(2);
    const firstControl = controls.find((control) => control.dataset.kitesSrcUrl === first.srcUrl)!;
    const secondControl = controls.find((control) => control.dataset.kitesSrcUrl === second.srcUrl)!;
    expect(firstControl.querySelector('button')?.disabled).toBe(true);
    expect(secondControl.querySelector('button')?.disabled).toBe(false);

    await deliver({ type: 'IMAGE_TRANSLATED', payload: { originalUrl: first.srcUrl, bakedBase64: 'data:image/png;base64,AA==', jobId: 8 } });
    // Finished first image is no longer hovered: its control leaves; second stays hovered.
    expect(document.querySelectorAll('[data-kites-translate-control]')).toHaveLength(1);
    expect(document.querySelector<HTMLElement>('[data-kites-translate-control]')?.dataset.kitesSrcUrl).toBe(second.srcUrl);
  });

  it('keeps one spinner per queued image when several are started together', async () => {
    const targets = Array.from({ length: 5 }, (_, index) => image(`https://example.com/page-${index}.png`));
    media.targets = targets;
    await mount('persistent');
    expect(document.querySelectorAll('[data-kites-translate-control]')).toHaveLength(5);

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-kites-translate-button]')];
    await act(async () => { for (const button of buttons) button.click(); });

    expect(sendMessage).toHaveBeenCalledTimes(5);
    expect(document.querySelectorAll('[data-kites-translate-control]')).toHaveLength(5);
    for (const control of document.querySelectorAll<HTMLElement>('[data-kites-translate-control]')) {
      expect(control.querySelector('button')?.disabled).toBe(true);
    }
  });

  it('keeps the eye toggle working after leaving and re-entering a translated image', async () => {
    const first = image('https://example.com/first.png');
    const second = image('https://example.com/second.png');
    media.targets = [first, second];
    media.underPointer = first;
    await mount('hover');
    finish(first);
    await deliver({ type: 'IMAGE_TRANSLATED', payload: { originalUrl: first.srcUrl, bakedBase64: 'data:image/png;base64,AA==', jobId: 9 } });
    await hover(first);

    const toggle = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-kites-toggle-btn]');
    await act(async () => { toggle()!.click(); });
    expect(first.imgElement!.src).toBe(first.srcUrl);

    media.underPointer = second;
    await hover(second);
    media.underPointer = first;
    await hover(first);

    // First click after re-entry shows the translated image; the second must return to original.
    await act(async () => { toggle()!.click(); });
    expect(first.imgElement!.src).toBe('blob:translated');
    await act(async () => { toggle()!.click(); });
    expect(first.imgElement!.src).toBe(first.srcUrl);
  });

  it('clears persistent target when the pointer leaves the document', async () => {
    const target = image('https://example.com/page.png');
    media.targets = [target];
    media.underPointer = target;
    await mount();
    move();
    target.sourceElement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: 80, clientY: 90, relatedTarget: null }));
    await deliver({ type: 'TRANSLATE_HOVERED_IMAGE' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('clears hover target when the pointer leaves the document', async () => {
    const target = image('https://example.com/page.png');
    media.targets = [target];
    media.underPointer = target;
    await mount('hover');
    move();
    target.sourceElement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: 80, clientY: 90, relatedTarget: null }));
    await deliver({ type: 'TRANSLATE_HOVERED_IMAGE' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('replaces image on paginated manga readers (e.g. nhentai /g/123/1/) immediately upon IMAGE_TRANSLATED without requiring eye toggle', async () => {
    delete (window as any).location;
    window.location = new URL('https://nhentai.net/g/677759/1/') as any;
    const target = image('https://i7.nhentai.net/galleries/677759/1.webp');
    media.targets = [target];
    media.underPointer = target;
    await mount('hover');
    content.translatedRegistry.remember(target.srcUrl, target);
    await deliver({
      type: 'IMAGE_TRANSLATED',
      payload: {
        originalUrl: target.srcUrl,
        bakedBase64: 'data:image/png;base64,AA==',
        jobId: 42,
      },
    });
    expect(target.imgElement!.src).toBe('blob:translated');
    expect(target.sourceElement.getAttribute('data-kites-translated')).toBe('true');
  });
});
