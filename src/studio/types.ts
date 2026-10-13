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
  | 'text'
  | 'warp'
  | 'image';

export type BrushShape = 'circle' | 'square';

export type EraseRestoreSource = 'original' | 'inpainted';

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
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rot'
  | 'quad-tl'
  | 'quad-tr'
  | 'quad-br'
  | 'quad-bl';

export interface TextObject {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  originalText?: string;
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
