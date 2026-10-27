/**
 * @file TypesetStrategyFactory.ts
 * Factory for resolving the appropriate ITypesetStrategy implementation.
 * Guarantees compile-time exhaustive matching per AGENTS.md Section 3.
 */

import type { ITypesetStrategy, TypesetMode } from './ITypesetStrategy';
import { ContourDpTypesetter } from './ContourDpTypesetter';
import { SimpleRectTypesetter } from './SimpleRectTypesetter';
import { AutoBalloonTypesetter } from './AutoBalloonTypesetter';

export interface StrategyResolutionParams {
  typesetMode?: string;
  isFixed?: boolean;
  hasContour?: boolean;
  isRounded?: boolean;
}

export class TypesetStrategyFactory {
  private static readonly contourStrategy: ITypesetStrategy = new ContourDpTypesetter();
  private static readonly simpleStrategy: ITypesetStrategy = new SimpleRectTypesetter();
  private static readonly autoBalloonStrategy: ITypesetStrategy = new AutoBalloonTypesetter();

  /**
   * Resolves the strategy from resolution parameters.
   *
   * @param params - Layout context attributes (typesetMode, isFixed, hasContour, isRounded).
   * @returns The resolved ITypesetStrategy.
   */
  static resolve(params: StrategyResolutionParams): ITypesetStrategy {
    const isFixed = params.isFixed ?? (params.typesetMode !== 'balloon' && params.typesetMode !== undefined);
    const hasContour = Boolean(params.hasContour);
    const isContour = isFixed && (hasContour || params.typesetMode === 'contour' || params.typesetMode === 'ellipse' || (params.isRounded && params.typesetMode !== 'simple'));
    const isSimple = isFixed && !isContour && params.typesetMode === 'simple';

    if (isContour) {
      return this.contourStrategy;
    }
    if (isSimple) {
      return this.simpleStrategy;
    }
    return this.autoBalloonStrategy;
  }

  /**
   * Resolves a strategy by explicit mode with exhaustive checking.
   *
   * @param mode - The explicit TypesetMode ('contour' | 'simple' | 'auto-balloon').
   * @returns Concrete ITypesetStrategy.
   */
  static getByMode(mode: TypesetMode): ITypesetStrategy {
    switch (mode) {
      case 'contour':
        return this.contourStrategy;
      case 'simple':
        return this.simpleStrategy;
      case 'auto-balloon':
      case 'balloon':
        return this.autoBalloonStrategy;
      default: {
        const _exhaustive: never = mode;
        throw new Error(`[TypesetStrategyFactory] Unhandled TypesetMode: ${_exhaustive}`);
      }
    }
  }
}
