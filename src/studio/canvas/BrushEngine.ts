import type {
  BoundedDirtyRectPatch,
  BoundingBox,
  BrushShape,
  PaintSourceMode,
  Point,
} from '../types';

export interface StrokeOptions {
  shape: BrushShape;
  size: number;
  feather: number;
  color?: string;
  opacity?: number;
  paintMode?: PaintSourceMode;
  patternImage?: CanvasImageSource | null;
  patternScale?: number;
  blurRadius?: number;
}

export class BrushEngine {
  private isDrawing = false;
  private prevPoint: Point | null = null;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  // Mask canvas accumulating the stroke path for feathering & destination-in
  private dabCanvas: HTMLCanvasElement | null = null;
  private dabCtx: CanvasRenderingContext2D | null = null;

  // Scratch canvas for compositing operations
  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;

  private canvasWidth = 0;
  private canvasHeight = 0;

  /**
   * Initializes or resizes internal mask and scratch canvases.
   *
   * @param width - Base canvas width in pixels.
   * @param height - Base canvas height in pixels.
   */
  public init(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;

    if (!this.dabCanvas) {
      this.dabCanvas = document.createElement('canvas');
      this.dabCtx = this.dabCanvas.getContext('2d');
    }
    this.dabCanvas.width = width;
    this.dabCanvas.height = height;

    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas');
      this.scratchCtx = this.scratchCanvas.getContext('2d');
    }
    this.scratchCanvas.width = width;
    this.scratchCanvas.height = height;
  }

  /**
   * Begins a new stroke at the specified point.
   *
   * @param point - Starting coordinate in image pixels.
   * @param options - Stroke styling and size parameters.
   */
  public beginStroke(point: Point, options: StrokeOptions): void {
    if (!this.dabCanvas || !this.dabCtx) return;

    this.isDrawing = true;
    this.prevPoint = point;
    this.dabCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const radius = options.size / 2;
    this.minX = Math.floor(point.x - radius);
    this.minY = Math.floor(point.y - radius);
    this.maxX = Math.ceil(point.x + radius);
    this.maxY = Math.ceil(point.y + radius);

    this.drawDab(this.dabCtx, point, options);
  }

  /**
   * Extends the current stroke to a new point.
   *
   * @param point - Next coordinate in image pixels.
   * @param options - Stroke styling and size parameters.
   */
  public extendStroke(point: Point, options: StrokeOptions): void {
    if (!this.isDrawing || !this.dabCtx || !this.prevPoint) return;

    const radius = options.size / 2;
    this.minX = Math.min(this.minX, Math.floor(point.x - radius));
    this.minY = Math.min(this.minY, Math.floor(point.y - radius));
    this.maxX = Math.max(this.maxX, Math.ceil(point.x + radius));
    this.maxY = Math.max(this.maxY, Math.ceil(point.y + radius));

    this.dabCtx.beginPath();
    this.dabCtx.strokeStyle = '#ffffff';
    this.dabCtx.fillStyle = '#ffffff';
    this.dabCtx.lineWidth = options.size;
    this.dabCtx.lineCap = options.shape === 'circle' ? 'round' : 'square';
    this.dabCtx.lineJoin = options.shape === 'circle' ? 'round' : 'miter';

    this.dabCtx.moveTo(this.prevPoint.x, this.prevPoint.y);
    this.dabCtx.lineTo(point.x, point.y);
    this.dabCtx.stroke();

    this.drawDab(this.dabCtx, point, options);
    this.prevPoint = point;
  }

  /**
   * Finalizes the current stroke and returns the tight stroked bounding box with padding.
   *
   * @param feather - Feather radius to expand bounding box.
   * @returns Clamped bounding box of modified canvas region.
   */
  public endStroke(feather: number = 0): BoundingBox {
    this.isDrawing = false;
    this.prevPoint = null;

    const pad = Math.ceil(feather * 2) + 4;
    const clampedX = Math.max(0, this.minX - pad);
    const clampedY = Math.max(0, this.minY - pad);
    const clampedW = Math.min(this.canvasWidth - clampedX, Math.max(1, this.maxX - this.minX + pad * 2));
    const clampedH = Math.min(this.canvasHeight - clampedY, Math.max(1, this.maxY - this.minY + pad * 2));

    return {
      x: clampedX,
      y: clampedY,
      width: clampedW,
      height: clampedH,
    };
  }

  /**
   * Applies the Erase/Restore brush composite to the target canvas.
   *
   * @param targetCtx - Canvas context where artwork is being edited.
   * @param sourceImage - Image source to restore from (original artwork or clean background).
   * @param feather - Edge blur radius for smooth transitions.
   */
  public applyEraseRestore(
    targetCtx: CanvasRenderingContext2D,
    sourceImage: CanvasImageSource,
    feather: number
  ): void {
    if (!this.dabCanvas || !this.scratchCanvas || !this.scratchCtx) return;

    const bbox = this.endStroke(feather);
    if (bbox.width <= 0 || bbox.height <= 0) return;

    const { x, y, width: w, height: h } = bbox;

    // 1. Clear scratch buffer slice
    this.scratchCtx.clearRect(0, 0, w, h);

    // 2. Draw source image patch onto scratch
    this.scratchCtx.drawImage(sourceImage, x, y, w, h, 0, 0, w, h);

    // 3. Mask with accumulated stroke dabs using destination-in
    this.scratchCtx.globalCompositeOperation = 'destination-in';
    if (feather > 0) {
      this.scratchCtx.filter = `blur(${feather}px)`;
    }
    this.scratchCtx.drawImage(this.dabCanvas, x, y, w, h, 0, 0, w, h);
    this.scratchCtx.filter = 'none';
    this.scratchCtx.globalCompositeOperation = 'source-over';

    // 4. Stamp masked restoration back onto target canvas
    targetCtx.drawImage(this.scratchCanvas, 0, 0, w, h, x, y, w, h);
  }

  /**
   * Applies the Paint brush stroke to the target canvas.
   *
   * @param targetCtx - Canvas context being painted.
   * @param options - Stroke color, pattern, blur, or transparency mode.
   */
  public applyPaint(targetCtx: CanvasRenderingContext2D, options: StrokeOptions): void {
    if (!this.dabCanvas || !this.scratchCanvas || !this.scratchCtx) return;

    const bbox = this.endStroke(options.feather);
    if (bbox.width <= 0 || bbox.height <= 0) return;

    const { x, y, width: w, height: h } = bbox;
    const mode = options.paintMode || 'color';

    if (mode === 'color') {
      this.scratchCtx.clearRect(0, 0, w, h);
      this.scratchCtx.fillStyle = options.color || '#ffffff';
      this.scratchCtx.globalAlpha = options.opacity ?? 1.0;
      this.scratchCtx.fillRect(0, 0, w, h);

      this.scratchCtx.globalCompositeOperation = 'destination-in';
      if (options.feather > 0) {
        this.scratchCtx.filter = `blur(${options.feather}px)`;
      }
      this.scratchCtx.drawImage(this.dabCanvas, x, y, w, h, 0, 0, w, h);
      this.scratchCtx.filter = 'none';
      this.scratchCtx.globalCompositeOperation = 'source-over';
      this.scratchCtx.globalAlpha = 1.0;

      targetCtx.drawImage(this.scratchCanvas, 0, 0, w, h, x, y, w, h);
    } else if (mode === 'transparency') {
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'destination-out';
      if (options.feather > 0) {
        targetCtx.filter = `blur(${options.feather}px)`;
      }
      targetCtx.drawImage(this.dabCanvas, x, y, w, h, x, y, w, h);
      targetCtx.restore();
    } else if (mode === 'blur') {
      const radius = options.blurRadius ?? 6;
      this.scratchCtx.clearRect(0, 0, w, h);
      this.scratchCtx.filter = `blur(${radius}px)`;
      this.scratchCtx.drawImage(targetCtx.canvas, x, y, w, h, 0, 0, w, h);
      this.scratchCtx.filter = 'none';

      this.scratchCtx.globalCompositeOperation = 'destination-in';
      if (options.feather > 0) {
        this.scratchCtx.filter = `blur(${options.feather}px)`;
      }
      this.scratchCtx.drawImage(this.dabCanvas, x, y, w, h, 0, 0, w, h);
      this.scratchCtx.filter = 'none';
      this.scratchCtx.globalCompositeOperation = 'source-over';

      targetCtx.drawImage(this.scratchCanvas, 0, 0, w, h, x, y, w, h);
    } else if (mode === 'pattern' && options.patternImage) {
      this.scratchCtx.clearRect(0, 0, w, h);
      const pattern = this.scratchCtx.createPattern(options.patternImage, 'repeat');
      if (pattern) {
        this.scratchCtx.fillStyle = pattern;
        this.scratchCtx.fillRect(0, 0, w, h);

        this.scratchCtx.globalCompositeOperation = 'destination-in';
        if (options.feather > 0) {
          this.scratchCtx.filter = `blur(${options.feather}px)`;
        }
        this.scratchCtx.drawImage(this.dabCanvas, x, y, w, h, 0, 0, w, h);
        this.scratchCtx.filter = 'none';
        this.scratchCtx.globalCompositeOperation = 'source-over';

        targetCtx.drawImage(this.scratchCanvas, 0, 0, w, h, x, y, w, h);
      }
    }
  }

  /**
   * Captures an ImageData patch of only the specified bounding box.
   *
   * @param ctx - Source canvas context.
   * @param bbox - Bounding region to extract.
   * @returns Bounded dirty rect patch object.
   */
  public static captureBoundingPatch(
    ctx: CanvasRenderingContext2D,
    bbox: BoundingBox
  ): BoundedDirtyRectPatch {
    const clampedX = Math.max(0, bbox.x);
    const clampedY = Math.max(0, bbox.y);
    const clampedW = Math.max(1, Math.min(ctx.canvas.width - clampedX, bbox.width));
    const clampedH = Math.max(1, Math.min(ctx.canvas.height - clampedY, bbox.height));

    const patchImageData = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);

    return {
      x: clampedX,
      y: clampedY,
      width: clampedW,
      height: clampedH,
      patchImageData,
    };
  }

  /**
   * Restores a previously captured ImageData patch back onto the canvas.
   *
   * @param ctx - Target canvas context.
   * @param patch - Bounded dirty rect patch object.
   */
  public static putBoundingPatch(
    ctx: CanvasRenderingContext2D,
    patch: BoundedDirtyRectPatch
  ): void {
    ctx.putImageData(patch.patchImageData, patch.x, patch.y);
  }

  private drawDab(ctx: CanvasRenderingContext2D, point: Point, options: StrokeOptions): void {
    const radius = options.size / 2;
    ctx.fillStyle = '#ffffff';

    if (options.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(point.x - radius, point.y - radius, options.size, options.size);
    }
  }
}
