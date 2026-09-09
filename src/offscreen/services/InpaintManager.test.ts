import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InpaintManager } from './InpaintManager';

const engines: Array<{ tier: string; init: ReturnType<typeof vi.fn>; inpaint: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
let pendingInpaintResolve: ((value: ArrayBuffer) => void) | null = null;
let nextInitError: Error | null = null;

/**
 * Creates a tracked mock engine for lifecycle assertions.
 *
 * @param tier - Engine tier label.
 * @returns Mock engine implementing inpaint contract.
 */
function makeEngine(tier: string) {
  const engine = {
    tier,
    init: vi.fn().mockImplementation(async () => {
      if (nextInitError) {
        const error = nextInitError;
        nextInitError = null;
        throw error;
      }
    }),
    inpaint: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  engines.push(engine);
  return engine;
}

vi.mock('ppu-paddle-ocr', () => ({ PaddleOcrService: class { platform = {}; } }));
vi.mock('../engines/inpaint/SimpleInpaintEngine', () => ({ SimpleInpaintEngine: class { constructor() { return makeEngine('simple'); } } }));
vi.mock('../engines/inpaint/TeleaInpaintEngine', () => ({ TeleaInpaintEngine: class { constructor() { return makeEngine('telea'); } } }));
vi.mock('../engines/inpaint/AotInpaintEngine', () => ({ AotInpaintEngine: class { constructor() { return makeEngine('aotgan'); } } }));
vi.mock('../engines/inpaint/LamaMangaInpaintEngine', () => ({ LamaMangaInpaintEngine: class { constructor() { return makeEngine('lama-manga'); } } }));
vi.mock('../engines/inpaint/LamaBaseInpaintEngine', () => ({ LamaBaseInpaintEngine: class {} }));
vi.mock('../engines/inpaint/NoneInpaintEngine', () => ({ NoneInpaintEngine: class { constructor() { return makeEngine('none'); } } }));
vi.mock('../engines/inpaint/OriginalInpaintEngine', () => ({ OriginalInpaintEngine: class { constructor() { return makeEngine('original'); } } }));

describe('InpaintManager lifecycle', () => {
  beforeEach(() => {
    engines.length = 0;
    pendingInpaintResolve = null;
    nextInitError = null;
  });

  it('reuses same tier and canonicalizes aot to aotgan', async () => {
    const manager = new InpaintManager();
    await manager.eraseText(new ArrayBuffer(1), [[{ x: 0, y: 0 }]], 'aot');
    await manager.eraseText(new ArrayBuffer(1), [[{ x: 0, y: 0 }]], 'aotgan');
    expect(engines).toHaveLength(1);
  });

  it('deduplicates concurrent engine initialization', async () => {
    const manager = new InpaintManager();
    await Promise.all([
      manager.eraseText(new ArrayBuffer(1), [[{ x: 0, y: 0 }]], 'telea'),
      manager.eraseText(new ArrayBuffer(1), [[{ x: 0, y: 0 }]], 'telea'),
    ]);
    expect(engines).toHaveLength(1);
    expect(engines[0].init).toHaveBeenCalledTimes(1);
  });

  it('waits for active operation before destroying old tier', async () => {
    const manager = new InpaintManager();
    const polygons = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]];
    await manager.eraseText(new ArrayBuffer(1), polygons, 'telea');
    const telea = engines[0];
    telea.inpaint.mockImplementation(() => new Promise<ArrayBuffer>(resolve => { pendingInpaintResolve = resolve; }));

    telea.inpaint.mockClear();
    const operation = manager.eraseText(new ArrayBuffer(1), polygons, 'telea');
    await vi.waitFor(() => expect(pendingInpaintResolve).not.toBeNull());
    const switchTier = manager.eraseText(new ArrayBuffer(1), polygons, 'simple');
    await Promise.resolve();
    expect(telea.destroy).not.toHaveBeenCalled();

    pendingInpaintResolve!(new ArrayBuffer(1));
    await operation;
    await switchTier;
    expect(telea.destroy).toHaveBeenCalledTimes(1);
    expect(engines.at(-1)?.tier).toBe('simple');
  });

  it('clears failed engine initialization so next request retries', async () => {
    const manager = new InpaintManager();
    nextInitError = new Error('init failed');
    await expect(manager.eraseText(new ArrayBuffer(1), [[{ x: 0, y: 0 }]], 'simple')).rejects.toThrow('init failed');
    await expect(manager.eraseText(new ArrayBuffer(1), [[{ x: 0, y: 0 }]], 'simple')).resolves.toBeDefined();
    expect(engines).toHaveLength(2);
    expect(engines[0].destroy).toHaveBeenCalledTimes(1);
  });
});
