import { describe, expect, it, vi } from 'vitest';
import { HeuristicBubbleEngine } from './HeuristicBubbleEngine';
import { NeuralBubbleEngine } from './NeuralBubbleEngine';
import { BubbleManager } from '../../services/BubbleManager';
import { NeuralBubbleDetector } from './NeuralBubbleDetector';

describe('Bubble Engine OOP Abstraction', () => {
  it('HeuristicBubbleEngine implements IBubbleEngine interface', async () => {
    const engine = new HeuristicBubbleEngine();
    await engine.init();
    expect(typeof engine.detect).toBe('function');
    expect(typeof engine.destroy).toBe('function');

    // Empty text boxes returns empty bubbles
    const canvas = { width: 100, height: 100 } as any;
    const result = await engine.detect(canvas, []);
    expect(result).toEqual({ bubbles: [] });
    await engine.destroy();
  });

  it('NeuralBubbleEngine implements IBubbleEngine and delegates to NeuralBubbleDetector', async () => {
    const engine = new NeuralBubbleEngine();
    await engine.init();

    const spyDetect = vi.spyOn(NeuralBubbleDetector, 'detect').mockResolvedValue([{ x: 10, y: 10, w: 50, h: 50 }]);
    const spyDispose = vi.spyOn(NeuralBubbleDetector, 'dispose').mockResolvedValue();

    const canvas = { width: 200, height: 200 } as any;
    const result = await engine.detect(canvas);
    expect(result?.bubbles).toEqual([{ x: 10, y: 10, w: 50, h: 50 }]);

    await engine.destroy();
    expect(spyDispose).toHaveBeenCalled();

    spyDetect.mockRestore();
    spyDispose.mockRestore();
  });

  it('BubbleManager manages engine lifecycle and destroys old engine on mode switch', async () => {
    const manager = new BubbleManager();

    // Acquire heuristic
    const lease1 = await manager.acquireEngine('heuristic');
    expect(lease1.engine).toBeInstanceOf(HeuristicBubbleEngine);
    lease1.release();

    // Switch to neural -> disposes previous engine
    const lease2 = await manager.acquireEngine('neural');
    expect(lease2.engine).toBeInstanceOf(NeuralBubbleEngine);
    lease2.release();

    // Switch to off -> engine is null
    const lease3 = await manager.acquireEngine('off');
    expect(lease3.engine).toBeNull();
    lease3.release();

    await manager.destroy();
  });

  it('BubbleManager recreates engine when isProviderCurrent reports false', async () => {
    const manager = new BubbleManager();
    const lease1 = await manager.acquireEngine('neural');
    expect(lease1.engine).toBeInstanceOf(NeuralBubbleEngine);
    lease1.release();

    const oldEngine = lease1.engine as NeuralBubbleEngine;
    const spyDestroy = vi.spyOn(oldEngine, 'destroy');
    vi.spyOn(oldEngine, 'isProviderCurrent').mockResolvedValue(false);

    const lease2 = await manager.acquireEngine('neural');
    expect(spyDestroy).toHaveBeenCalledOnce();
    expect(lease2.engine).not.toBe(oldEngine);
    lease2.release();

    await manager.destroy();
  });

  it('BubbleManager waits for active users to drain before destroying', async () => {
    const manager = new BubbleManager();
    let resolveDetect!: (val: any) => void;
    const pendingDetect = new Promise<any>((resolve) => {
      resolveDetect = resolve;
    });

    // Seed heuristic engine
    const seedLease = await manager.acquireEngine('heuristic');
    const engine = seedLease.engine!;
    seedLease.release();

    vi.spyOn(engine, 'detect').mockImplementation(() => pendingDetect);
    const spyDestroy = vi.spyOn(engine, 'destroy');

    // Start long-running detect operation (which holds activeUsers = 1)
    const detectOp = manager.detect({ width: 10, height: 10 } as any, [], 'heuristic');

    // Concurrently request switch to neural mode
    let switchFinished = false;
    const switchPromise = manager.acquireEngine('neural').then((l) => {
      switchFinished = true;
      l.release();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(switchFinished).toBe(false);
    expect(spyDestroy).not.toHaveBeenCalled();

    resolveDetect({ bubbles: [] });
    await detectOp;
    await switchPromise;

    expect(switchFinished).toBe(true);
    expect(spyDestroy).toHaveBeenCalledOnce();
    await manager.destroy();
  });
});
