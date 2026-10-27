import { describe, it, expect } from 'vitest';
import { TypesetStrategyFactory } from './TypesetStrategyFactory';
import { ContourDpTypesetter } from './ContourDpTypesetter';
import { SimpleRectTypesetter } from './SimpleRectTypesetter';
import { AutoBalloonTypesetter } from './AutoBalloonTypesetter';

describe('TypesetStrategyFactory', () => {
  it('resolves ContourDpTypesetter for fixed contour/rounded balloons', () => {
    const s1 = TypesetStrategyFactory.resolve({ typesetMode: 'contour', isFixed: true });
    expect(s1.mode).toBe('contour');
    expect(s1).toBeInstanceOf(ContourDpTypesetter);

    const s2 = TypesetStrategyFactory.resolve({ isFixed: true, isRounded: true });
    expect(s2.mode).toBe('contour');

    const s3 = TypesetStrategyFactory.resolve({ isFixed: true, hasContour: true });
    expect(s3.mode).toBe('contour');
  });

  it('resolves SimpleRectTypesetter for rectangular fixed captions', () => {
    const s = TypesetStrategyFactory.resolve({ typesetMode: 'simple', isFixed: true });
    expect(s.mode).toBe('simple');
    expect(s).toBeInstanceOf(SimpleRectTypesetter);
  });

  it('resolves AutoBalloonTypesetter for unfixed/disabled balloon mode', () => {
    const s1 = TypesetStrategyFactory.resolve({ typesetMode: 'balloon', isFixed: false });
    expect(s1.mode).toBe('auto-balloon');
    expect(s1).toBeInstanceOf(AutoBalloonTypesetter);

    const s2 = TypesetStrategyFactory.resolve({});
    expect(s2.mode).toBe('auto-balloon');
  });

  it('resolves strategies via explicit getByMode with exhaustive safety', () => {
    expect(TypesetStrategyFactory.getByMode('contour')).toBeInstanceOf(ContourDpTypesetter);
    expect(TypesetStrategyFactory.getByMode('simple')).toBeInstanceOf(SimpleRectTypesetter);
    expect(TypesetStrategyFactory.getByMode('auto-balloon')).toBeInstanceOf(AutoBalloonTypesetter);
  });
});
