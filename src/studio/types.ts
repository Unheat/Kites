import type { TypesetMode } from '../shared/constants';

/**
 * Core type definitions for Kites Studio V2.
 * Comprehensive model for 2D viewport, raster brushes, typography,
 * bounded undo/redo patches, warp quad coordinates, and sticker layers.
 */

export type StudioTool =
  | 'select'
  | 'erase'
  | 'paint'
  | 'inpaint'
  | 'ocr'
  | 'color'
  | 'text'
  | 'warp'
  | 'image';

export type BrushShape = 'circle' | 'square';

export type EraseRestoreSource = 'original' | 'inpainted';

export type StudioViewMode = 'original' | 'inpainted' | 'translated';

export type InpaintSource = 'background' | 'original';

export type PaintSourceMode = 'color' | 'pattern' | 'blur' | 'transparency';

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TransformHandle =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rot'
  | 'font-size'
  | 'wrap'
  | 'quad-tl'
  | 'quad-tr'
  | 'quad-br'
  | 'quad-bl';

export interface CharStyleOverride {
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface TextObject {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  lines?: string[];
  /** Koharu scanline placements (box-local). Present after contour typesetting or pipeline restore; absent falls back to even spacing. */
  positionedLines?: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  originalText?: string;
  charStyles?: (CharStyleOverride | null)[];
  fontSize: number;
  fontFamily: string;
  color: string;
  color2?: string;
  isGradient?: boolean;
  gradientAngle?: number;
  strokeColor?: string;
  strokeColor2?: string;
  isStrokeGradient?: boolean;
  strokeWidth?: number;
  strokeBlur?: number;
  shadowAngle?: number;
  shadowDistance?: number;
  shadowBlur?: number;
  shadowColor?: string;
  isVertical?: boolean;
  direction?: 'ltr' | 'rtl';
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  lowercase?: boolean;
  letterSpacing?: number;
  lineSpacing?: number;
  backgroundFill?: string;
  backgroundPadding?: number;
  backgroundBorderRadius?: number;
  opacity?: number;
  rotation?: number;
  warpPreset?: string;
  warpBend?: number;
  quadPoints?: [Point, Point, Point, Point];
  isLocked?: boolean;
  isVisible?: boolean;
  isSkipped?: boolean;
  /** Preferred engine for future edits, independent of already measured lines. */
  typesetMode?: TypesetMode;
  /** Mathematical bubble corner radius in image pixels (0 = rectangle, >0 = oval/ellipse curvature). */
  borderRadius?: number;
  /** Whether this text object is positioned inside a curved bubble or a rectangular box. */
  isRounded?: boolean;
  /** Organic bubble contour polygon coordinates (in image pixels), if detected. */
  contourPoints?: Point[];
  /** Target language code for syllable hyphenation (e.g. 'en', 'es', 'de'). */
  targetLang?: string;
  /** Cached dimensions and font for smooth non-destructive radius slider scrubbing. */
  roundFit?: {
    width: number;
    fontSize: number;
    fittedWidth?: number;
    fittedFontSize?: number;
  };
}

export interface ImageLayer {
  id: string;
  src: string;
  imageBitmap?: ImageBitmap | HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
  isLocked?: boolean;
  isVisible?: boolean;
  typesetMode?: TypesetMode;
}

export interface BoundedDirtyRectPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  patchImageData: ImageData;
}

export interface UndoAction {
  id: string;
  timestamp: number;
  description: string;
  rasterPatch?: {
    before: BoundedDirtyRectPatch;
    after: BoundedDirtyRectPatch;
  };
  textObjects?: {
    before: TextObject[];
    after: TextObject[];
  };
  imageLayers?: {
    before: ImageLayer[];
    after: ImageLayer[];
  };
  colorState?: {
    before: boolean;
    after: boolean;
  };
}

export interface EditorAppearanceSettings {
  selectedBoxBorderColor: string;
  unselectedBoxBorderColor: string;
  caretColor: string;
  brushCursorColor: string;
}

export interface KeyboardShortcutMapping {
  actionId: string;
  label: string;
  keyCombination: string;
}
