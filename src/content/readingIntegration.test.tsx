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
});
