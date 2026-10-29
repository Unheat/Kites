import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TextObject } from '../types';
import { studioStore } from './studioStore';
import { recordGeneratedLayout, resetLayoutRecordsForTests } from './layoutGenerations';
import { useLayoutReadiness } from './layoutReadiness';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const resourceMocks = vi.hoisted(() => ({
  loadLanguage: vi.fn(),
  ensureFonts: vi.fn(),
}));

vi.mock('../../offscreen/utils/hyphenation', () => ({
  loadHyphenationLanguage: resourceMocks.loadLanguage,
}));

vi.mock('../../shared/fontLibrary', () => ({
  ensureFontsRegistered: resourceMocks.ensureFonts,
}));

// Keep the readiness test independent from canvas measurement: the retry just marks objects.
vi.mock('../canvas/studioTypeset', () => ({
  reflowTextObject: (object: TextObject) => ({
    ...object,
    lines: [...(object.lines ?? []), 'reflowed'],
    retriedWithResources: true,
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Builds an externally resolvable promise for resource-readiness staging.
 * @returns Promise plus its resolve/reject handles.
 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Minimal harness that mounts only the readiness hook.
 * @param props - Hook arguments mirrored as component props.
 * @returns Nothing rendered.
 */
function Probe({ lang, page }: { lang?: string; page: number | null }): null {
  useLayoutReadiness(lang, page);
  return null;
}

const makeObject = (overrides: Partial<TextObject> = {}): TextObject => ({
  id: 'bubble-1',
  x: 12,
  y: 34,
  width: 180,
  height: 100,
  text: 'Generated dialogue text',
  lines: ['Generated', 'dialogue text'],
  fontSize: 16,
  fontFamily: 'sans-serif',
  color: '#000000',
  typesetMode: 'contour',
  ...overrides,
});

describe('Studio resource-readiness retry', () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLayoutRecordsForTests();
    studioStore.setState({ textObjects: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    resourceMocks.loadLanguage.mockReset().mockResolvedValue(undefined);
    resourceMocks.ensureFonts.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    consoleError.mockRestore();
    resetLayoutRecordsForTests();
  });

  const mount = async (props: { lang?: string; page: number | null }) => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<Probe {...props} />);
    });
  };

  it('retries only layouts generated during the wait, preserving moves and persisted rows', async () => {
    const pending = makeObject({ id: 'pending', x: 250, y: 300 });
    recordGeneratedLayout(pending);
    const persisted = makeObject({ id: 'persisted', lines: ['pipeline', 'lines'] });
    studioStore.setState({ textObjects: [pending, persisted] });

    await mount({ lang: 'en', page: 1 });
    // Resolve only after the effect registered its snapshot.
    resourceMocks.loadLanguage.mockResolvedValue(undefined);
    resourceMocks.ensureFonts.mockResolvedValue(undefined);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const [retried, untouched] = studioStore.getState().textObjects;
    expect((retried as TextObject & { retriedWithResources?: boolean }).retriedWithResources).toBe(true);
    // Move survives because the retry spreads the live object.
    expect(retried.x).toBe(250);
    expect(retried.y).toBe(300);
    // Persisted lines are never re-flowed.
    expect(untouched).toBe(persisted);
  });

  it('retries text edits generated after the wait started, only after both resources settle', async () => {
    const dict = deferred<void>();
    const fonts = deferred<void>();
    resourceMocks.loadLanguage.mockReturnValue(dict.promise);
    resourceMocks.ensureFonts.mockReturnValue(fonts.promise);
    const persisted = makeObject({ id: 'new-edit', lines: ['saved'] });
    studioStore.setState({ textObjects: [persisted] });
    await mount({ lang: 'de', page: 1 });

    const edited = { ...persisted, text: 'Edited during load', lines: ['premature'] };
    recordGeneratedLayout(edited);
    act(() => studioStore.setState({ textObjects: [edited] }));
    await act(async () => { dict.resolve(); await dict.promise; });
    expect(studioStore.getState().textObjects[0]).toBe(edited);
    await act(async () => { fonts.resolve(); await fonts.promise; });
    expect(studioStore.getState().textObjects[0].lines).toEqual(['premature', 'reflowed']);
  });

  it('does not overwrite a manual resize that landed while resources were loading', async () => {
    const pending = makeObject({ id: 'resizing' });
    recordGeneratedLayout(pending);
    studioStore.setState({ textObjects: [pending] });

    const dict = deferred<void>();
    const fonts = deferred<void>();
    resourceMocks.loadLanguage.mockReturnValue(dict.promise);
    resourceMocks.ensureFonts.mockReturnValue(fonts.promise);

    await mount({ lang: 'de', page: 1 });

    const resized = { ...pending, width: 340, lines: ['Resized', 'layout'] };
    recordGeneratedLayout(resized);
    act(() => studioStore.setState({ textObjects: [resized] }));

    await act(async () => {
      dict.resolve();
      fonts.resolve();
      await dict.promise;
      await fonts.promise;
    });

    expect(studioStore.getState().textObjects[0]).toBe(resized);
  });

  it('does not retry after undo restores older pre-load lines', async () => {
    const pending = makeObject({ id: 'undone' });
    recordGeneratedLayout(pending);
    studioStore.setState({ textObjects: [pending] });

    const dict = deferred<void>();
    const fonts = deferred<void>();
    resourceMocks.loadLanguage.mockReturnValue(dict.promise);
    resourceMocks.ensureFonts.mockReturnValue(fonts.promise);

    await mount({ lang: 'fr', page: 1 });

    // Undo swaps in the pre-load layout: identical inputs, different measured payload.
    const older = { ...pending, lines: ['Pre-load', 'lines'] };
    act(() => studioStore.setState({ textObjects: [older] }));

    await act(async () => {
      dict.resolve();
      fonts.resolve();
      await dict.promise;
      await fonts.promise;
    });

    expect(studioStore.getState().textObjects[0]).toBe(older);
  });

  it('never resurrects a deleted object', async () => {
    const pending = makeObject({ id: 'deleted' });
    recordGeneratedLayout(pending);
    studioStore.setState({ textObjects: [pending] });

    const dict = deferred<void>();
    const fonts = deferred<void>();
    resourceMocks.loadLanguage.mockReturnValue(dict.promise);
    resourceMocks.ensureFonts.mockReturnValue(fonts.promise);

    await mount({ lang: 'es', page: 1 });
    act(() => studioStore.setState({ textObjects: [] }));

    await act(async () => {
      dict.resolve();
      fonts.resolve();
      await dict.promise;
      await fonts.promise;
    });

    expect(studioStore.getState().textObjects).toEqual([]);
  });

  it('cancels the previous wait when the active job switches', async () => {
    const pending = makeObject({ id: 'switch' });
    recordGeneratedLayout(pending);
    studioStore.setState({ textObjects: [pending] });

    const firstDict = deferred<void>();
    const firstFonts = deferred<void>();
    const secondDict = deferred<void>();
    const secondFonts = deferred<void>();
    resourceMocks.loadLanguage
      .mockReturnValueOnce(firstDict.promise)
      .mockReturnValueOnce(secondDict.promise);
    resourceMocks.ensureFonts
      .mockReturnValueOnce(firstFonts.promise)
      .mockReturnValueOnce(secondFonts.promise);

    await mount({ lang: 'en', page: 1 });
    await act(async () => {
      root!.render(<Probe lang="en" page={2} />);
    });

    // The first job's resources settle after the switch: must not touch the new page.
    await act(async () => {
      firstDict.resolve();
      firstFonts.resolve();
      await firstDict.promise;
      await firstFonts.promise;
    });

    expect(studioStore.getState().textObjects[0]).toBe(pending);
  });

  it('stops retrying when resource loading fails instead of looping', async () => {
    const pending = makeObject({ id: 'failed' });
    recordGeneratedLayout(pending);
    studioStore.setState({ textObjects: [pending] });

    resourceMocks.ensureFonts.mockRejectedValue(new Error('font load failed'));

    await mount({ lang: 'en', page: 1 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(studioStore.getState().textObjects[0]).toBe(pending);
    expect(consoleError).toHaveBeenCalledWith(
      '[Studio] Layout resources failed to load; keeping current layout:',
      expect.any(Error)
    );
  });
});
