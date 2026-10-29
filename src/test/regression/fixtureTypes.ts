import type { OcrResult } from '../../offscreen/engines/ocr/BaseOcrEngine.js';
import type { BubbleGeometry } from '../../offscreen/engines/bubble/BaseBubbleEngine.js';
import type { BoxRect } from '../../offscreen/utils/bubbleExpansion.js';
import type { Point2D } from '../../shared/utils/geometry.js';
import type { renderTextBlocksBatch } from '../../offscreen/utils/canvasTypesetting.js';

export type RenderInfos = ReturnType<typeof renderTextBlocksBatch>;
export type FixtureLayout = {
  typesetBoxes: (BoxRect | null | undefined)[];
  contourPoints: (Point2D[] | null | undefined)[];
  skipped?: boolean[];
};
export interface OcrFixture extends Omit<OcrResult, 'maskRawCanvas'> {
  metadata: { image: string; imagePath: string; ocrTier: string; pageWidth: number; pageHeight: number; capturedAt: string };
  polygons: Point2D[][];
}
export interface Transcription {
  index: number;
  originalText: string;
  box: BoxRect;
  direction: 'h' | 'v';
  mappedText: string;
  uncertainty: string | null;
}
export interface TranscriptionFixture {
  metadata: { image: string; sourceDictionary: string; totalBlocks: number };
  transcriptions: Transcription[];
}
export interface SavedYoloItem {
  box: BoxRect;
  score: number;
  rawBox: { cx: number; cy: number; w: number; h: number };
  protoMask?: { pw: number; ph: number; px1: number; py1: number; maskBase64: string };
}

/** Decoded YOLO bubble detection result with prototype mask. */
export interface DecodedYoloBubble {
  box: BoxRect;
  score: number;
  rawBox: { cx: number; cy: number; w: number; h: number };
  coeffs?: Float32Array;
  protoMask?: {
    mask: Uint8Array;
    pw: number;
    ph: number;
    px1: number;
    py1: number;
  };
}
export interface ShapeMetadata {
  boxIndex: number;
  matchedBubbleIndex: number;
  isSevered: boolean;
  minX: number;
  minY: number;
  origPatchW: number;
  origPatchH: number;
  scaleX: number;
  scaleY: number;
  avgScale: number;
  carrierBox: BoxRect;
}
export interface BaselineFixture {
  metadata: { image: string; model: string; engine: string; capturedAt: string; pageWidth: number; pageHeight: number };
  yoloBubbles: BoxRect[];
  yoloItems: SavedYoloItem[];
  carriers: BubbleGeometry['carriers'];
  proposals: BubbleGeometry['proposals'];
  curvatures: BubbleGeometry['curvatures'];
  contours: (Point2D[] | null | undefined)[];
  shapesMetadata: ShapeMetadata[];
  resolvedLayout: FixtureLayout;
  renderInfos: RenderInfos;
  stageMetrics: { totalOcrBoxes: number; yoloProposalCount: number; matchedProposals: number; acceptedTypesetBoxes: number; rejectedTypesetBoxes: number };
}
export interface HarnessOptions {
  /** Replay saved model masks without ONNX inference. */
  fastMode?: boolean;
  imagePath?: string;
  yoloModelPath?: string;
  outputDir?: string;
  verbose?: boolean;
}
export interface BoxDiff {
  boxIndex: number;
  originalText: string;
  mappedText: string;
  carrierDiff: boolean;
  proposalDiff: boolean;
  curvatureDiff: boolean;
  contourDiff: boolean;
  typesetBoxDiff: boolean;
  renderInfoDiff: boolean;
  details: string[];
}
export interface HarnessResult {
  success: boolean;
  stageTimingsMs: { fontAndHyphenation: number; imageLoadAndInpaint: number; yoloInference: number; geometryBuild: number; layoutResolution: number; typesettingRender: number; total: number };
  metrics: { totalOcrBoxes: number; totalYoloBubbles: number; matchedBoxes: number; acceptedLayouts: number; rejectedLayouts: number; rejectedIndices: number[] };
  transcriptionUncertainties: Array<{ index: number; originalText: string; mappedText: string; uncertainty: string }>;
  differentialSummary: { baselineCompared: boolean; totalDifferences: number; matchingBoxes: number; mismatchedBoxes: number; boxDiffs: BoxDiff[]; isIdenticalToBaseline: boolean };
  renderedFiles: { currentPng: string; baselinePng: string; diffPng: string };
}
