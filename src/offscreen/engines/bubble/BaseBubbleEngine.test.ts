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
});
