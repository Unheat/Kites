import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Layers,
  Sparkles,
  Edit3,
  Check,
  Languages,
  Plus,
  Bold,
  Italic,
  Download,
} from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import {
  renderFullCompositeCanvas,
  downloadCanvasAsFile,
  copyCanvasToClipboard,
} from './compositeExport';
import {
  clientToImage,
  imageToClient,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
} from './CanvasViewport';
import { BrushEngine } from './BrushEngine';
import { TextRenderer } from './TextRenderer';
import { CanvasFurniture } from './CanvasFurniture';
import { WarpMesh } from './WarpMesh';
import { createStudioOcrCrops } from './studioOcrCrop';
import { StudioSourceSampler } from './StudioSourceSampler';
import { ToolViewModePolicy } from './tools/ToolViewModePolicy';
import { requestStudioInpaint, requestStudioOcr } from '../bridge/offscreenStudioBridge';
import { computeRotatedBounds, getHandleCursor } from './transformMath';
import { applyTextObjectUpdates, prepareInitialTextObject, CJK_CHARACTER_REGEX } from './studioTypeset';
import { extractTypographyStyle } from '../state/studioStore';
import type {
  BoundingBox,
  Point,
  TextObject,
  TransformHandle,
} from '../types';

/**
 * Coherent gesture record tracking an active text box transform or stationary click.
 */
interface ActiveTextGesture {
  pointerId: number;
  targetId: string;
  handle: TransformHandle;
  initialTransform: TextObject;
  startClientPoint: Point; // in CSS screen pixels for deadzone
  startImagePoint: Point;  // in image coordinates for geometry
  latestDeltaX: number;
  latestDeltaY: number;
  latestShiftKey: boolean;
  hasMoved: boolean;
}

export interface StudioCanvasProps {
  originalImage: HTMLImageElement | null;
  cleanedImage: HTMLImageElement | null;
}

export const StudioCanvas: React.FC<StudioCanvasProps> = ({
  originalImage,
  cleanedImage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const activeTool = useStudioStore((s) => s.activeTool);
  const zoom = useStudioStore((s) => s.zoom);
  const viewMode = useStudioStore((s) => s.viewMode ?? (s.isShowingOriginal ? 'original' : 'translated'));
  const hideBoxes = useStudioStore((s) => s.hideBoxes);
  const textObjects = useStudioStore((s) => s.textObjects);
  const selectedTextId = useStudioStore((s) => s.selectedTextId);
  const editingTextId = useStudioStore((s) => s.editingTextId);
  const clipboardStyle = useStudioStore((s) => s.clipboardStyle);
  const eraseSettings = useStudioStore((s) => s.eraseSettings);
  const paintSettings = useStudioStore((s) => s.paintSettings);
  const inpaintSettings = useStudioStore((s) => s.inpaintSettings);
  const ocrSettings = useStudioStore((s) => s.ocrSettings);
  const selectedInpaintEngineId = useStudioStore((s) => s.selectedInpaintEngineId);
  const selectedOcrEngineId = useStudioStore((s) => s.selectedOcrEngineId);
  const imageLayers = useStudioStore((s) => s.imageLayers);
  const selectedImageLayerId = useStudioStore((s) => s.selectedImageLayerId);
  const appearance = useStudioStore((s) => s.appearance);

  const brushEngineRef = useRef<BrushEngine>(new BrushEngine());
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inlineInitialTextRef = useRef<TextObject[] | null>(null);
  const lastClickRef = useRef<{ time: number; id: string | null }>({ time: 0, id: null });
  const activeGestureRef = useRef<ActiveTextGesture | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const warpScratchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [copiedOrigPill, setCopiedOrigPill] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const aiProcessingRef = useRef(false);
  const [ocrFeedback, setOcrFeedback] = useState<string | null>(null);
  const [activeHandle, setActiveHandle] = useState<TransformHandle | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<string>('default');
  const [inlineSelection, setInlineSelection] = useState<{ start: number; end: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    imageX: number;
    imageY: number;
    targetObj: TextObject | null;
  } | null>(null);

  const imageWidth = originalImage?.naturalWidth || cleanedImage?.naturalWidth || 800;
  const imageHeight = originalImage?.naturalHeight || cleanedImage?.naturalHeight || 1200;

  // Initialize and redraw background canvases
  useEffect(() => {
    const origCanvas = originalCanvasRef.current;
    if (origCanvas && originalImage && originalImage.complete && imageWidth > 0 && imageHeight > 0) {
      origCanvas.width = imageWidth;
      origCanvas.height = imageHeight;
      const oCtx = origCanvas.getContext('2d');
      if (oCtx) {
        oCtx.clearRect(0, 0, imageWidth, imageHeight);
        oCtx.drawImage(originalImage, 0, 0);
      }
    }

    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas || imageWidth <= 0 || imageHeight <= 0) return;

    bgCanvas.width = imageWidth;
    bgCanvas.height = imageHeight;
    const ctx = bgCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, imageWidth, imageHeight);
    if (cleanedImage && cleanedImage.complete) {
      ctx.drawImage(cleanedImage, 0, 0);
    } else if (originalImage && originalImage.complete) {
      ctx.drawImage(originalImage, 0, 0);
    }

    brushEngineRef.current.init(imageWidth, imageHeight);
  }, [cleanedImage, originalImage, imageWidth, imageHeight]);

  // Main redraw loop for overlay canvas (text objects, stickers, selection furniture)
  const redrawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    // Avoid reallocating GPU texture backing store unless dimensions changed
    if (overlay.width !== imageWidth) overlay.width = imageWidth;
    if (overlay.height !== imageHeight) overlay.height = imageHeight;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, imageWidth, imageHeight);

    // Only render stickers, text objects, and transform furniture in 'translated' presentation mode
    if (viewMode !== 'translated') {
      return;
    }

    // 1. Render stickers / image layers
    for (const layer of imageLayers) {
      if (layer.isVisible === false) continue;
      ctx.save();
      ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      if (layer.flipH || layer.flipV) ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
      ctx.globalAlpha = layer.opacity;

      if (layer.imageBitmap) {
        ctx.drawImage(layer.imageBitmap, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      }
      ctx.restore();

      if (!hideBoxes && layer.id === selectedImageLayerId) {
        ctx.save();
        ctx.strokeStyle = appearance.selectedBoxBorderColor;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
        ctx.restore();
      }
    }

    // 2. Render Text Objects
    for (const obj of textObjects) {
      if (obj.isVisible === false) continue;

      if (obj.warpPreset && obj.warpPreset !== 'none' && obj.quadPoints) {
        let tempCanvas = warpScratchCanvasRef.current;
        if (!tempCanvas) {
          tempCanvas = document.createElement('canvas');
          warpScratchCanvasRef.current = tempCanvas;
        }
        if (tempCanvas.width !== obj.width) tempCanvas.width = obj.width;
        if (tempCanvas.height !== obj.height) tempCanvas.height = obj.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.clearRect(0, 0, obj.width, obj.height);
          TextRenderer.renderText(tempCtx, { ...obj, x: 0, y: 0, rotation: 0 });
          ctx.save();
          ctx.translate(obj.x, obj.y);
          WarpMesh.renderWarpedMesh(ctx, tempCanvas, obj.quadPoints);
          ctx.restore();
        }
      } else {
        TextRenderer.renderText(ctx, obj);
      }
    }

    // 3. Render transform furniture if not in hideBoxes mode
    if (!hideBoxes) {
      // Draw subtle dashed grey outline for unselected skipped dialogue boxes
      for (const obj of textObjects) {
        if (obj.isSkipped && obj.id !== selectedTextId) {
          ctx.save();
          ctx.translate(obj.x, obj.y);
          if (obj.rotation) {
            const cx = obj.width / 2;
            const cy = obj.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate((obj.rotation * Math.PI) / 180);
            ctx.translate(-cx, -cy);
          }
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.strokeRect(0, 0, obj.width, obj.height);
          ctx.restore();
        }
      }

      const selectedObj = textObjects.find((t) => t.id === selectedTextId);
      if (selectedObj) {
        CanvasFurniture.drawSelectionFurniture(ctx, selectedObj, appearance.selectedBoxBorderColor);
      }
    }
  }, [imageWidth, imageHeight, textObjects, imageLayers, selectedTextId, editingTextId, selectedImageLayerId, appearance, hideBoxes, viewMode]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  // Interactive dialogue box actions (reading live store to prevent stale closures)
  const handleDuplicateSelectedText = useCallback(() => {
    const liveTexts = studioStore.getState().textObjects;
    const selected = liveTexts.find((t) => t.id === selectedTextId);
    if (!selected) return;
    const cloned: TextObject = {
      ...selected,
      id: `bubble-${Date.now()}`,
      x: selected.x + 20,
      y: selected.y + 20,
    };
    const prev = [...liveTexts];
    const next = [...liveTexts, cloned];
    studioStore.setState({ textObjects: next, selectedTextId: cloned.id });
    studioUndoStack.push({
      id: `duplicate-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Duplicate Text Box',
      textObjects: { before: prev, after: next },
    });
  }, [selectedTextId]);

  const handleDeleteSelectedText = useCallback(() => {
    if (!selectedTextId) return;
    const liveTexts = studioStore.getState().textObjects;
    const prev = [...liveTexts];
    const next = liveTexts.filter((t) => t.id !== selectedTextId);
    studioStore.setState({ textObjects: next, selectedTextId: null });
    studioUndoStack.push({
      id: `delete-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Delete Text Box',
      textObjects: { before: prev, after: next },
    });
  }, [selectedTextId]);

  const handleRasterizeText = useCallback(() => {
    const liveTexts = studioStore.getState().textObjects;
    const selected = liveTexts.find((t) => t.id === selectedTextId);
    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext('2d', { willReadFrequently: true });
    if (!selected || !bgCanvas || !bgCtx) return;

    const bbox: BoundingBox = {
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
    };
    const prePatch = BrushEngine.captureBoundingPatch(bgCtx, bbox);

    TextRenderer.renderText(bgCtx, selected);
    const postPatch = BrushEngine.captureBoundingPatch(bgCtx, bbox);

    const prevTexts = [...liveTexts];
    const nextTexts = liveTexts.filter((t) => t.id !== selected.id);

    studioStore.setState({ textObjects: nextTexts, selectedTextId: null });
    studioUndoStack.push({
      id: `rasterize-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Rasterize Text to Background',
      rasterPatch: { before: prePatch, after: postPatch },
      textObjects: { before: prevTexts, after: nextTexts },
    });
  }, [selectedTextId]);

  const handleCopyStyle = useCallback(() => {
    const liveTexts = studioStore.getState().textObjects;
    const selected = liveTexts.find((t) => t.id === selectedTextId);
    if (!selected) return;
    const style = extractTypographyStyle(selected);
    studioStore.setState({ clipboardStyle: style });
  }, [selectedTextId]);

  const handlePasteStyle = useCallback(() => {
    const { clipboardStyle, textObjects: liveTexts } = studioStore.getState();
    if (!clipboardStyle || !selectedTextId) return;
    const target = liveTexts.find((t) => t.id === selectedTextId);
    if (!target) return;
    const prev = [...liveTexts];
    // Pasted styling must not replace the target's chosen editing engine.
    const { typesetMode: _clipboardMode, ...style } = clipboardStyle;
    const updated = applyTextObjectUpdates(target, style, studioStore.getState().globalTypesetMode);

    const next = liveTexts.map((t) => (t.id === selectedTextId ? updated : t));
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `paste-style-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Paste Typography Style',
      textObjects: { before: prev, after: next },
    });
  }, [selectedTextId]);

  const handleToggleBold = useCallback(() => {
    const liveTexts = studioStore.getState().textObjects;
    const selected = liveTexts.find((t) => t.id === selectedTextId);
    if (!selected) return;

    if (inlineSelection && inlineSelection.start !== inlineSelection.end) {
      const charStyles = [...(selected.charStyles || new Array(selected.text.length).fill(null))];
      const currentStartBold = charStyles[inlineSelection.start]?.bold ?? selected.bold;
      const nextBold = !currentStartBold;
      for (let i = inlineSelection.start; i < inlineSelection.end; i++) {
        charStyles[i] = { ...(charStyles[i] || {}), bold: nextBold };
      }
      const updated = applyTextObjectUpdates(selected, { charStyles }, studioStore.getState().globalTypesetMode);
      const prev = [...liveTexts];
      const next = liveTexts.map((t) => (t.id === selected.id ? updated : t));
      studioStore.setState({ textObjects: next });
      studioUndoStack.push({
        id: `format-bold-${Date.now()}`,
        timestamp: Date.now(),
        description: 'Format Word Bold',
        textObjects: { before: prev, after: next },
      });
    } else {
      const updated = applyTextObjectUpdates(selected, { bold: !selected.bold }, studioStore.getState().globalTypesetMode);
      const prev = [...liveTexts];
      const next = liveTexts.map((t) => (t.id === selected.id ? updated : t));
      studioStore.setState({ textObjects: next });
      studioUndoStack.push({
        id: `format-bold-${Date.now()}`,
        timestamp: Date.now(),
        description: 'Toggle Box Bold',
        textObjects: { before: prev, after: next },
      });
    }
  }, [selectedTextId, inlineSelection]);

  const handleToggleItalic = useCallback(() => {
    const liveTexts = studioStore.getState().textObjects;
    const selected = liveTexts.find((t) => t.id === selectedTextId);
    if (!selected) return;

    if (inlineSelection && inlineSelection.start !== inlineSelection.end) {
      const charStyles = [...(selected.charStyles || new Array(selected.text.length).fill(null))];
      const currentStartItalic = charStyles[inlineSelection.start]?.italic ?? selected.italic;
      const nextItalic = !currentStartItalic;
      for (let i = inlineSelection.start; i < inlineSelection.end; i++) {
        charStyles[i] = { ...(charStyles[i] || {}), italic: nextItalic };
      }
      const updated = applyTextObjectUpdates(selected, { charStyles }, studioStore.getState().globalTypesetMode);
      const prev = [...liveTexts];
      const next = liveTexts.map((t) => (t.id === selected.id ? updated : t));
      studioStore.setState({ textObjects: next });
      studioUndoStack.push({
        id: `format-italic-${Date.now()}`,
        timestamp: Date.now(),
        description: 'Format Word Italic',
        textObjects: { before: prev, after: next },
      });
    } else {
      const updated = applyTextObjectUpdates(selected, { italic: !selected.italic }, studioStore.getState().globalTypesetMode);
      const prev = [...liveTexts];
      const next = liveTexts.map((t) => (t.id === selected.id ? updated : t));
      studioStore.setState({ textObjects: next });
      studioUndoStack.push({
        id: `format-italic-${Date.now()}`,
        timestamp: Date.now(),
        description: 'Toggle Box Italic',
        textObjects: { before: prev, after: next },
      });
    }
  }, [selectedTextId, inlineSelection]);

  // Spacebar pan gesture & keyboard shortcut listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        setIsSpacePanning(true);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTextId) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        handleDeleteSelectedText();
      }
      if (e.key === 'Enter' && selectedTextId && !editingTextId) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          studioStore.setState({ editingTextId: selectedTextId });
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedTextId) {
        e.preventDefault();
        handleDuplicateSelectedText();
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b' && selectedTextId) {
        e.preventDefault();
        handleToggleBold();
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'i' && selectedTextId) {
        e.preventDefault();
        handleToggleItalic();
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'c' && selectedTextId) {
        e.preventDefault();
        handleCopyStyle();
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'v' && selectedTextId) {
        e.preventDefault();
        handlePasteStyle();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedTextId, editingTextId, handleDeleteSelectedText, handleDuplicateSelectedText, handleCopyStyle, handlePasteStyle, handleToggleBold, handleToggleItalic]);

  // Global click & escape listener to close custom context menu
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-studio-context-menu]')) {
        setContextMenu(null);
      }
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const pt = getPointerImageCoords(e);
    const liveTexts = studioStore.getState().textObjects;
    let clicked: TextObject | null = null;
    for (let i = liveTexts.length - 1; i >= 0; i--) {
      if (CanvasFurniture.hitTestBody(pt, liveTexts[i])) {
        clicked = liveTexts[i];
        break;
      }
    }

    if (clicked) {
      studioStore.setState({ selectedTextId: clicked.id });
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      imageX: pt.x,
      imageY: pt.y,
      targetObj: clicked,
    });
  };

  const handleContextDownload = async (format: 'png' | 'jpeg' = 'png') => {
    const bgCanvas = bgCanvasRef.current;
    const compositeCanvas = renderFullCompositeCanvas(
      imageWidth,
      imageHeight,
      bgCanvas,
      originalImage,
      viewMode,
      imageLayers,
      textObjects
    );
    await downloadCanvasAsFile(compositeCanvas, `kites-translated.${format === 'jpeg' ? 'jpg' : 'png'}`, format);
    setContextMenu(null);
  };

  const handleContextCopyImage = async () => {
    const bgCanvas = bgCanvasRef.current;
    const compositeCanvas = renderFullCompositeCanvas(
      imageWidth,
      imageHeight,
      bgCanvas,
      originalImage,
      viewMode,
      imageLayers,
      textObjects
    );
    const ok = await copyCanvasToClipboard(compositeCanvas);
    setContextMenu(null);
    if (ok) {
      setOcrFeedback('Full image copied to clipboard!');
      setTimeout(() => setOcrFeedback(null), 2500);
    }
  };

  const handleContextAddBoxHere = () => {
    if (!contextMenu) return;
    const id = `bubble-${Date.now()}`;
    const newObj = prepareInitialTextObject({
      id,
      x: Math.round(contextMenu.imageX - 70),
      y: Math.round(contextMenu.imageY - 25),
      width: 140,
      height: 50,
      text: 'New Dialogue',
      fontSize: 18,
      fontFamily: 'WildWords, CCWildWords, sans-serif',
      color: '#000000',
      strokeColor: '#ffffff',
      strokeWidth: 2,
      align: 'center',
      isVertical: false,
    });
    const prev = [...textObjects];
    const next = [...textObjects, newObj];
    studioStore.setState({ textObjects: next, selectedTextId: id, editingTextId: id });
    studioUndoStack.push({
      id: `add-box-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Add Text Box',
      textObjects: { before: prev, after: next },
    });
    setContextMenu(null);
  };

  // Mouse wheel listener: natural scrolling vs cursor-centered zoom
  const handleWheel = (e: React.WheelEvent) => {
    const container = containerRef.current;
    if (!container) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const containerRect = container.getBoundingClientRect();
      const mouseX = e.clientX - containerRect.left + container.scrollLeft;
      const mouseY = e.clientY - containerRect.top + container.scrollTop;

      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      const newZoom = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, zoom * factor));
      const ratio = newZoom / zoom;

      studioStore.setState({ zoom: newZoom });

      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollLeft = mouseX * ratio - (e.clientX - containerRect.left);
          containerRef.current.scrollTop = mouseY * ratio - (e.clientY - containerRect.top);
        }
      });
    } else if (e.shiftKey) {
      e.preventDefault();
      container.scrollLeft += e.deltaY * 0.6;
    }
  };

  const getPointerImageCoords = (e: { clientX: number; clientY: number }): Point => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return { x: 0, y: 0 };
    return clientToImage(
      e.clientX,
      e.clientY,
      overlay.getBoundingClientRect(),
      imageWidth,
      imageHeight
    );
  };

  // Ensure any scheduled RAF is cancelled on component unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  /**
   * Computes the updated TextObject geometry and typeset reflow for an active gesture.
   * @param gesture - Initial object, transform handle, and current pointer deltas.
   * @returns Updated geometry, reflowed only when measured inputs changed.
   */
  const computeUpdatedTextObject = (gesture: ActiveTextGesture): TextObject => {
    const { initialTransform, handle, latestDeltaX, latestDeltaY, latestShiftKey } = gesture;
    const updated = { ...initialTransform };

    if (handle === 'rot') {
      const centerX = initialTransform.x + initialTransform.width / 2;
      const centerY = initialTransform.y + initialTransform.height / 2;
      const initialMouseAngle = Math.atan2(gesture.startImagePoint.y - centerY, gesture.startImagePoint.x - centerX);
      const currentPtX = gesture.startImagePoint.x + latestDeltaX;
      const currentPtY = gesture.startImagePoint.y + latestDeltaY;
      const currentMouseAngle = Math.atan2(currentPtY - centerY, currentPtX - centerX);
      const deltaAngleDeg = ((currentMouseAngle - initialMouseAngle) * 180) / Math.PI;

      let deg = Math.round((initialTransform.rotation || 0) + deltaAngleDeg);
      deg = ((((deg % 360) + 540) % 360) - 180);

      if (latestShiftKey) {
        deg = Math.round(deg / 15) * 15;
        if (deg === 180 || deg === -180) deg = 180;
      } else {
        if (Math.abs(deg) <= 5) deg = 0;
        else if (Math.abs(deg - 90) <= 5) deg = 90;
        else if (Math.abs(deg + 90) <= 5) deg = -90;
        else if (Math.abs(Math.abs(deg) - 180) <= 5) deg = 180;
      }
      updated.rotation = deg;
    } else if (handle === 'font-size') {
      const rad = ((initialTransform.rotation || 0) * Math.PI) / 180;
      const localDeltaX = latestDeltaX * Math.cos(rad) + latestDeltaY * Math.sin(rad);
      const localDeltaY = -latestDeltaX * Math.sin(rad) + latestDeltaY * Math.cos(rad);
      const scaleStep = Math.round((localDeltaX - localDeltaY) * 0.25);
      const newFontSize = Math.max(6, Math.min(140, Math.round(initialTransform.fontSize + scaleStep)));
      updated.fontSize = newFontSize;
    } else {
      const newBounds = computeRotatedBounds(initialTransform, handle, latestDeltaX, latestDeltaY);
      updated.x = newBounds.x;
      updated.y = newBounds.y;
      updated.width = newBounds.width;
      updated.height = newBounds.height;
    }

    return applyTextObjectUpdates(initialTransform, updated, studioStore.getState().globalTypesetMode);
  };

  /**
   * Applies the latest transformed TextObject into the Zustand store on animation frames.
   */
  const applyTransformFrame = useCallback(() => {
    const gesture = activeGestureRef.current;
    if (!gesture || !gesture.hasMoved) return;
    const updated = computeUpdatedTextObject(gesture);
    studioStore.setState((state) => ({
      textObjects: state.textObjects.map((t) => (t.id === updated.id ? updated : t)),
    }));
  }, []);

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || aiProcessingRef.current || isAiProcessing) return;
    if (!ToolViewModePolicy.isToolAllowed(activeTool, viewMode)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getPointerImageCoords(e);
    setIsPointerDown(true);

    if (isSpacePanning) {
      return;
    }

    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext('2d', { willReadFrequently: true });

    // Erase / Restore Brush
    if (activeTool === 'erase' && bgCtx) {
      brushEngineRef.current.saveSnapshot(bgCtx);
      brushEngineRef.current.beginStroke(pt, {
        shape: eraseSettings.shape,
        size: eraseSettings.size,
        feather: eraseSettings.feather,
      });

      const sourceImage: CanvasImageSource =
        eraseSettings.source === 'original' && originalImage
          ? originalImage
          : ((cleanedImage || bgCanvas) as CanvasImageSource);
      if (sourceImage) {
        brushEngineRef.current.applyEraseRestore(bgCtx, sourceImage, eraseSettings.feather);
      }
      return;
    }

    // Paint Brush
    if (activeTool === 'paint' && bgCtx) {
      brushEngineRef.current.saveSnapshot(bgCtx);
      brushEngineRef.current.beginStroke(pt, {
        shape: paintSettings.shape,
        size: paintSettings.size,
        feather: paintSettings.feather,
        color: paintSettings.color,
        paintMode: paintSettings.mode,
        blurRadius: paintSettings.blurRadius,
        patternScale: paintSettings.patternScale,
      });

      brushEngineRef.current.applyPaint(bgCtx, {
        shape: paintSettings.shape,
        size: paintSettings.size,
        feather: paintSettings.feather,
        color: paintSettings.color,
        paintMode: paintSettings.mode,
        blurRadius: paintSettings.blurRadius,
      });
      return;
    }

    // Inpaint / OCR Mask Brush
    if (activeTool === 'inpaint' || activeTool === 'ocr') {
      const brushSize = activeTool === 'inpaint' ? inpaintSettings.size : ocrSettings.size;
      const brushShape = activeTool === 'inpaint' ? inpaintSettings.shape : ocrSettings.shape;
      brushEngineRef.current.beginStroke(pt, {
        shape: brushShape,
        size: brushSize,
        feather: 0,
      });

      const overlay = overlayCanvasRef.current;
      const ctx = overlay?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = activeTool === 'inpaint' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(244, 63, 94, 0.4)';
        if (brushShape === 'square') {
          ctx.fillRect(pt.x - brushSize / 2, pt.y - brushSize / 2, brushSize, brushSize);
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    // Select & Transform Tool
    if (activeTool === 'select' || activeTool === 'text') {
      const liveTexts = studioStore.getState().textObjects;
      const selectedObj = liveTexts.find((t) => t.id === selectedTextId);

      if (selectedObj && !hideBoxes && !selectedObj.isLocked) {
        const handle = CanvasFurniture.hitTestHandles(pt, selectedObj);
        if (handle) {
          activeGestureRef.current = {
            pointerId: e.pointerId,
            targetId: selectedObj.id,
            handle,
            initialTransform: { ...selectedObj },
            startClientPoint: { x: e.clientX, y: e.clientY },
            startImagePoint: pt,
            latestDeltaX: 0,
            latestDeltaY: 0,
            latestShiftKey: e.shiftKey,
            hasMoved: false,
          };
          setActiveHandle(handle);
          return;
        }
      }

      let clickedObj: TextObject | null = null;
      for (let i = liveTexts.length - 1; i >= 0; i--) {
        if (CanvasFurniture.hitTestBody(pt, liveTexts[i])) {
          clickedObj = liveTexts[i];
          break;
        }
      }

      if (clickedObj) {
        // If clicking another object while editing, dismiss previous edit
        if (editingTextId && editingTextId !== clickedObj.id) {
          studioStore.setState({ editingTextId: null, selectedTextId: clickedObj.id });
        } else if (selectedTextId !== clickedObj.id) {
          studioStore.setState({ selectedTextId: clickedObj.id });
        }

        // Locked text objects can be selected, but cannot be moved or transformed
        if (clickedObj.isLocked) {
          activeGestureRef.current = null;
          setActiveHandle(null);
          return;
        }

        // Arm 'move' handle for dragging. Double-click to edit is deferred to pointerup
        // when no movement occurs, so immediate or fast 2nd-click dragging never freezes!
        activeGestureRef.current = {
          pointerId: e.pointerId,
          targetId: clickedObj.id,
          handle: 'move',
          initialTransform: { ...clickedObj },
          startClientPoint: { x: e.clientX, y: e.clientY },
          startImagePoint: pt,
          latestDeltaX: 0,
          latestDeltaY: 0,
          latestShiftKey: e.shiftKey,
          hasMoved: false,
        };
        setActiveHandle('move');
        return;
      }

      // Clicked outside text objects
      activeGestureRef.current = null;
      setActiveHandle(null);
      lastClickRef.current = { time: 0, id: null };

      if (editingTextId) {
        studioStore.setState({ editingTextId: null, inlineSelection: null });
        setInlineSelection(null);
      }

      // If a text bubble is currently selected, clicking empty space deselects it
      if (selectedTextId) {
        studioStore.setState({ selectedTextId: null, inlineSelection: null });
        setInlineSelection(null);
        return;
      }

      return;
    }
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent) => {
    const pt = getPointerImageCoords(e);

    if (isPointerDown && isSpacePanning) {
      if (containerRef.current) {
        containerRef.current.scrollLeft -= e.movementX;
        containerRef.current.scrollTop -= e.movementY;
      }
      return;
    }

    if (!isPointerDown) {
      if (activeTool === 'select' || activeTool === 'text') {
        const liveTexts = studioStore.getState().textObjects;
        const selectedObj = liveTexts.find((t) => t.id === selectedTextId);
        if (selectedObj && !hideBoxes) {
          const handle = CanvasFurniture.hitTestHandles(pt, selectedObj);
          if (handle) {
            setCanvasCursor(getHandleCursor(handle, selectedObj.rotation));
            return;
          }
        }
        for (let i = liveTexts.length - 1; i >= 0; i--) {
          if (CanvasFurniture.hitTestBody(pt, liveTexts[i])) {
            setCanvasCursor('move');
            return;
          }
        }
        setCanvasCursor('default');
      }
      return;
    }

    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext('2d', { willReadFrequently: true });

    // Erase / Restore Brush Drag
    if (activeTool === 'erase' && bgCtx) {
      brushEngineRef.current.extendStroke(pt, {
        shape: eraseSettings.shape,
        size: eraseSettings.size,
        feather: eraseSettings.feather,
      });

      const sourceImage: CanvasImageSource =
        eraseSettings.source === 'original' && originalImage
          ? originalImage
          : ((cleanedImage || bgCanvas) as CanvasImageSource);
      if (sourceImage) {
        brushEngineRef.current.applyEraseRestore(bgCtx, sourceImage, eraseSettings.feather);
      }
      return;
    }

    // Paint Brush Drag
    if (activeTool === 'paint' && bgCtx) {
      brushEngineRef.current.extendStroke(pt, {
        shape: paintSettings.shape,
        size: paintSettings.size,
        feather: paintSettings.feather,
        color: paintSettings.color,
        paintMode: paintSettings.mode,
        blurRadius: paintSettings.blurRadius,
        patternScale: paintSettings.patternScale,
      });
      brushEngineRef.current.applyPaint(bgCtx, {
        shape: paintSettings.shape,
        size: paintSettings.size,
        feather: paintSettings.feather,
        color: paintSettings.color,
        paintMode: paintSettings.mode,
        blurRadius: paintSettings.blurRadius,
      });
      return;
    }

    // Inpaint / OCR Brush Drag (draws preview mask on overlay)
    if (activeTool === 'inpaint' || activeTool === 'ocr') {
      const brushSize = activeTool === 'inpaint' ? inpaintSettings.size : ocrSettings.size;
      const brushShape = activeTool === 'inpaint' ? inpaintSettings.shape : ocrSettings.shape;
      brushEngineRef.current.extendStroke(pt, {
        shape: brushShape,
        size: brushSize,
        feather: 0,
      });

      const overlay = overlayCanvasRef.current;
      const ctx = overlay?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = activeTool === 'inpaint' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(244, 63, 94, 0.4)';
        if (brushShape === 'square') {
          ctx.fillRect(pt.x - brushSize / 2, pt.y - brushSize / 2, brushSize, brushSize);
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    // Transform Selected Text Object
    const gesture = activeGestureRef.current;
    if ((activeTool === 'select' || activeTool === 'text') && gesture && gesture.pointerId === e.pointerId) {
      const clientDx = e.clientX - gesture.startClientPoint.x;
      const clientDy = e.clientY - gesture.startClientPoint.y;

      // 3px deadzone threshold in CSS screen pixels
      if (!gesture.hasMoved) {
        if (Math.hypot(clientDx, clientDy) < 3) {
          return;
        }
        gesture.hasMoved = true;
      }

      gesture.latestDeltaX = pt.x - gesture.startImagePoint.x;
      gesture.latestDeltaY = pt.y - gesture.startImagePoint.y;
      gesture.latestShiftKey = e.shiftKey;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          applyTransformFrame();
        });
      }
      return;
    }
  };

  // Pointer Up
  const handlePointerUp = async () => {
    if (!isPointerDown || aiProcessingRef.current) return;
    setIsPointerDown(false);

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext('2d', { willReadFrequently: true });

    // Erase or Paint stroke undo patch
    if ((activeTool === 'erase' || activeTool === 'paint') && bgCtx) {
      const feather = activeTool === 'erase' ? eraseSettings.feather : paintSettings.feather;
      const bbox = brushEngineRef.current.endStroke(feather);
      const snapshotCanvas = brushEngineRef.current.getSnapshotCanvas();
      const snapshotCtx = snapshotCanvas?.getContext('2d');

      if (snapshotCtx && bbox.width > 0 && bbox.height > 0) {
        const beforePatch = BrushEngine.captureBoundingPatch(snapshotCtx, bbox);
        const postStrokePatch = BrushEngine.captureBoundingPatch(bgCtx, bbox);

        studioUndoStack.push({
          id: `stroke-${Date.now()}`,
          timestamp: Date.now(),
          description: activeTool === 'erase' ? 'Erase/Restore Stroke' : 'Paint Stroke',
          rasterPatch: {
            before: beforePatch,
            after: postStrokePatch,
          },
        });
      }
      return;
    }

    // Finalize Live AI Inpaint
    if (activeTool === 'inpaint' && bgCanvas && bgCtx) {
      const bbox = brushEngineRef.current.endStroke(0);
      if (bbox.width <= 5 || bbox.height <= 5) return;

      // 1. Immediately redraw overlay so the user-drawn live red brush preview is cleared
      // and not accidentally baked into the inpaint source crop.
      redrawOverlay();

      // 2. Ensure sufficient surrounding context for inpainting models (minimum 128px patch)
      const minContextSize = 128;
      const targetW = Math.max(minContextSize, bbox.width + 48);
      const targetH = Math.max(minContextSize, bbox.height + 48);
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;
      const cropX = Math.max(0, Math.min(imageWidth - targetW, Math.floor(centerX - targetW / 2)));
      const cropY = Math.max(0, Math.min(imageHeight - targetH, Math.floor(centerY - targetH / 2)));
      const cropW = Math.min(imageWidth - cropX, targetW);
      const cropH = Math.min(imageHeight - cropY, targetH);
      const paddedBbox: BoundingBox = { x: cropX, y: cropY, width: cropW, height: cropH };

      // 3. Extract source crop AFTER overlay is cleanly redrawn
      const patchCanvas = StudioSourceSampler.extractCrop(
        inpaintSettings.source,
        paddedBbox,
        {
          originalImage,
          backgroundCanvas: bgCanvas,
          overlayCanvas: overlayCanvasRef.current,
          textObjects,
          isOverlayRendered: viewMode === 'translated',
        }
      );

      const dabCanvas = brushEngineRef.current.getDabCanvas();
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = cropW;
      maskCanvas.height = cropH;
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx && dabCanvas) {
        maskCtx.drawImage(dabCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      } else {
        maskCtx?.fillRect(0, 0, cropW, cropH);
      }

      const preInpaintPatch = BrushEngine.captureBoundingPatch(bgCtx, paddedBbox);

      setIsAiProcessing(true);
      try {
        const inpaintedImg = await requestStudioInpaint(
          patchCanvas,
          maskCanvas,
          paddedBbox,
          selectedInpaintEngineId
        );

        // Option B (Torii-parity): Composite inpainted result through the user's stroke mask.
        // Only pixels directly underneath the circle or square brush strokes are updated on bgCtx,
        // leaving the surrounding context pixels untouched.
        const blendCanvas = document.createElement('canvas');
        blendCanvas.width = cropW;
        blendCanvas.height = cropH;
        const blendCtx = blendCanvas.getContext('2d');
        if (blendCtx) {
          blendCtx.drawImage(inpaintedImg, 0, 0, cropW, cropH);
          blendCtx.globalCompositeOperation = 'destination-in';
          blendCtx.drawImage(maskCanvas, 0, 0);
          bgCtx.drawImage(blendCanvas, cropX, cropY);
        } else {
          bgCtx.drawImage(inpaintedImg, cropX, cropY, cropW, cropH);
        }
        const postInpaintPatch = BrushEngine.captureBoundingPatch(bgCtx, paddedBbox);

        studioUndoStack.push({
          id: `inpaint-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Live AI Inpaint',
          rasterPatch: {
            before: preInpaintPatch,
            after: postInpaintPatch,
          },
        });
      } catch (err) {
        console.error('[Studio] Inpaint request failed:', err);
      } finally {
        setIsAiProcessing(false);
      }
      return;
    }

    // Finalize Live AI Re-OCR Area
    if (activeTool === 'ocr' && bgCanvas && bgCtx) {
      const bbox = brushEngineRef.current.endStroke(0);
      if (bbox.width <= 8 || bbox.height <= 8) return;

      redrawOverlay();
      setOcrFeedback(null);
      aiProcessingRef.current = true;
      setIsAiProcessing(true);
      try {
        const crops = createStudioOcrCrops(
          originalImage,
          bgCanvas,
          overlayCanvasRef.current,
          bbox,
          ocrSettings.scanSource,
          {
            textObjects,
            isOverlayRendered: viewMode === 'translated',
          }
        );
        const paddedBbox = crops.bounds;
        const preOcrPatch = ocrSettings.inpaint
          ? BrushEngine.captureBoundingPatch(bgCtx, paddedBbox) : undefined;
        const result = await requestStudioOcr(crops.recognition, paddedBbox, {
          ocrEngineId: selectedOcrEngineId,
          inpaintEngineId: selectedInpaintEngineId,
          translate: ocrSettings.translate,
          inpaint: ocrSettings.inpaint,
          backgroundPatchBase64: ocrSettings.inpaint ? crops.background.toDataURL('image/png') : undefined,
        });
        if (result.textObjects.length === 0) {
          setOcrFeedback('No text found in the selected area. Try selecting the whole text line.');
          return;
        }
        if (ocrSettings.inpaint) {
          bgCtx.drawImage(result.inpaintedImage, paddedBbox.x, paddedBbox.y, paddedBbox.width, paddedBbox.height);
        }
        const postOcrPatch = ocrSettings.inpaint
          ? BrushEngine.captureBoundingPatch(bgCtx, paddedBbox) : undefined;

        const prevTexts = [...studioStore.getState().textObjects];
        const nextTexts = [...prevTexts, ...result.textObjects];
        studioStore.setState({
          textObjects: nextTexts,
          selectedTextId: result.textObjects[0].id,
        });
        setOcrFeedback(`Recognized ${result.textObjects.length} text box${result.textObjects.length === 1 ? '' : 'es'}.`);
        studioUndoStack.push({
          id: `ocr-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Live AI Re-OCR',
          ...(preOcrPatch && postOcrPatch ? { rasterPatch: { before: preOcrPatch, after: postOcrPatch } } : {}),
          textObjects: { before: prevTexts, after: nextTexts },
        });
      } catch (err) {
        console.error('[Studio] OCR request failed:', err);
        setOcrFeedback(err instanceof Error ? err.message : 'OCR failed. Try again.');
      } finally {
        aiProcessingRef.current = false;
        setIsAiProcessing(false);
      }
      return;
    }

    // Transform Text Box / Click / Double Click resolution
    const gesture = activeGestureRef.current;
    if ((activeTool === 'select' || activeTool === 'text') && gesture) {
      if (gesture.hasMoved) {
        // Synchronously commit final frame position
        const finalUpdated = computeUpdatedTextObject(gesture);
        const currentList = studioStore.getState().textObjects;
        const nextList = currentList.map((t) => (t.id === finalUpdated.id ? finalUpdated : t));
        studioStore.setState({ textObjects: nextList });

        // Dragging invalidates double-click timer
        lastClickRef.current = { time: 0, id: null };

        if (JSON.stringify(finalUpdated) !== JSON.stringify(gesture.initialTransform)) {
          const prev = nextList.map((t) => (t.id === gesture.initialTransform.id ? gesture.initialTransform : t));
          const actionDesc =
            gesture.handle === 'move'
              ? 'Move Text Box'
              : gesture.handle === 'rot'
              ? 'Rotate Text Box'
              : gesture.handle === 'font-size'
              ? 'Scale Font Size'
              : gesture.handle === 'wrap'
              ? 'Wrap Text Lines'
              : 'Resize & Reflow Text Box';

          studioUndoStack.push({
            id: `transform-${Date.now()}`,
            timestamp: Date.now(),
            description: actionDesc,
            textObjects: { before: prev, after: nextList },
          });
        }
      } else {
        // Pointer did NOT move beyond 3px deadzone: it was a stationary click!
        const now = Date.now();
        const isDoubleClick =
          lastClickRef.current.id === gesture.targetId && now - lastClickRef.current.time < 350;

        if (isDoubleClick) {
          lastClickRef.current = { time: 0, id: null };
          studioStore.setState({
            selectedTextId: gesture.targetId,
            editingTextId: gesture.targetId,
          });
        } else {
          lastClickRef.current = { time: now, id: gesture.targetId };
          studioStore.setState({
            selectedTextId: gesture.targetId,
          });
        }
      }

      activeGestureRef.current = null;
      setActiveHandle(null);
      return;
    }

    activeGestureRef.current = null;
    setActiveHandle(null);
  };

  /**
   * Cancels any active gesture, rolls back transform if moved, and resets pointer state.
   */
  const handlePointerCancel = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const gesture = activeGestureRef.current;
    if (gesture && gesture.hasMoved) {
      // Roll back store to initialTransform
      studioStore.setState((state) => ({
        textObjects: state.textObjects.map((t) =>
          t.id === gesture.initialTransform.id ? gesture.initialTransform : t
        ),
      }));
    }
    activeGestureRef.current = null;
    setIsPointerDown(false);
    setActiveHandle(null);
  };

  /**
   * Double-click handler to prevent default browser behavior.
   * Double-click detection is safely handled in handlePointerUp when no drag movement occurred.
   */
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // Focus inline textarea and place caret at end when inline editing mode activates
  useEffect(() => {
    if (editingTextId && inlineTextareaRef.current) {
      const textarea = inlineTextareaRef.current;
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  }, [editingTextId]);

  /**
   * Reflows an actual inline text edit using the object's mode or global editing default.
   * @param newText - Changed textarea text; unchanged display text is ignored.
   * @returns Nothing; updates the live text list and captures its undo baseline.
   */
  const handleInlineTextChange = (newText: string) => {
    if (!editingTextId) return;
    const { textObjects: liveTexts, globalTypesetMode } = studioStore.getState();
    const currentObj = liveTexts.find((t) => t.id === editingTextId);
    if (!currentObj) return;
    const displayedText = !currentObj.text.includes('\n') && currentObj.lines && currentObj.lines.length > 1
      ? currentObj.lines.join('\n') : currentObj.text;
    if (newText === displayedText) return;
    if (!inlineInitialTextRef.current) {
      inlineInitialTextRef.current = [...liveTexts];
    }
    const updated = applyTextObjectUpdates(currentObj, { text: newText }, globalTypesetMode);
    const next = liveTexts.map((t) => t.id === editingTextId ? updated : t);
    studioStore.setState({ textObjects: next });
  };

  const handleFinishInlineEdit = (e?: React.FocusEvent) => {
    if (e?.relatedTarget) {
      const target = e.relatedTarget as HTMLElement;
      if (target.closest('[data-studio-sidebar]') || target.closest('[data-studio-toolbar]')) {
        return;
      }
    }
    setInlineSelection(null);
    if (inlineInitialTextRef.current) {
      const prev = inlineInitialTextRef.current;
      const current = studioStore.getState().textObjects;
      inlineInitialTextRef.current = null;
      if (JSON.stringify(prev) !== JSON.stringify(current)) {
        studioUndoStack.push({
          id: `inline-text-edit-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Edit Dialogue Text',
          textObjects: { before: prev, after: current },
        });
      }
    }
    studioStore.setState({ editingTextId: null });
  };

  const handleAddNewEmptyTextBox = () => {
    const id = `bubble-${Date.now()}`;
    const selected = textObjects.find((t) => t.id === selectedTextId);
    const newObj = prepareInitialTextObject({
      id,
      x: selected ? Math.round(selected.x + 30) : Math.round(imageWidth / 2 - 70),
      y: selected ? Math.round(selected.y + 30) : Math.round(imageHeight / 2 - 25),
      width: 140,
      height: 50,
      text: 'New Dialogue',
      originalText: undefined,
      fontSize: 18,
      fontFamily: 'WildWords, CCWildWords, sans-serif',
      color: '#000000',
      strokeColor: '#ffffff',
      strokeWidth: 2,
      align: 'center',
      isVertical: false,
    });
    const prev = [...textObjects];
    const next = [...textObjects, newObj];
    studioStore.setState({ textObjects: next, selectedTextId: id, editingTextId: null });
    studioUndoStack.push({
      id: `add-empty-box-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Add Empty Text Box',
      textObjects: { before: prev, after: next },
    });
  };

  // Compute screen coordinates for floating action pill (accounting for rotation)
  const selectedObj = textObjects.find((t) => t.id === selectedTextId);
  const editingObj = textObjects.find((t) => t.id === editingTextId);

  let pillPos: Point | null = null;
  let pillBottomPos: Point | null = null;

  if (selectedObj && overlayCanvasRef.current) {
    const cx = selectedObj.x + selectedObj.width / 2;
    const cy = selectedObj.y + selectedObj.height / 2;
    const w = selectedObj.width;
    const h = selectedObj.height;
    const rad = ((selectedObj.rotation || 0) * Math.PI) / 180;

    // 4 corners + rotation nub in local space relative to center
    const localPts = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
      { x: 0, y: -h / 2 - 28 }, // rotation handle nub
    ];

    let minY = Infinity;
    let maxY = -Infinity;
    for (const pt of localPts) {
      const worldY = cy + pt.x * Math.sin(rad) + pt.y * Math.cos(rad);
      if (worldY < minY) minY = worldY;
      if (worldY > maxY) maxY = worldY;
    }

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    pillPos = imageToClient(cx, minY, rect, imageWidth, imageHeight);
    pillBottomPos = imageToClient(cx, maxY, rect, imageWidth, imageHeight);
  }

  return (
    <div
      ref={containerRef}
      data-studio-canvas-container="true"
      onWheel={handleWheel}
      className={`relative flex flex-1 min-h-0 overflow-auto p-4 w-full h-full bg-[#0a0c12] select-none ${
        isSpacePanning ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* Centered Canvas Spacer: m-auto architecture */}
      <div
        ref={spacerRef}
        style={{
          width: `${imageWidth * zoom}px`,
          height: `${imageHeight * zoom}px`,
        }}
        className="relative block shrink-0 m-auto select-none"
      >
        {/* Pristine original image canvas (visible when viewMode is 'original') */}
        <canvas
          ref={originalCanvasRef}
          onContextMenu={handleContextMenu}
          style={{
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            display: viewMode === 'original' ? 'block' : 'none',
          }}
          className="block absolute top-0 left-0 shadow-2xl rounded-sm"
        />

        {/* Working background raster canvas (cleaned/painted artwork; visible in 'inpainted' and 'translated' modes) */}
        <canvas
          ref={bgCanvasRef}
          onContextMenu={handleContextMenu}
          data-studio-working-background="true"
          id="studio-working-background"
          style={{
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            display: viewMode !== 'original' ? 'block' : 'none',
          }}
          className="block absolute top-0 left-0 shadow-2xl rounded-sm"
        />

        {/* Live overlay canvas for text, stickers, furniture, and brush feedback (always active for pointer events and brush previews) */}
        <canvas
          ref={overlayCanvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          style={{
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            display: 'block',
            cursor: isPointerDown && activeHandle === 'rot' ? 'grabbing' : canvasCursor,
          }}
          className="block absolute top-0 left-0"
        />

        {/* Layer 4: Direct In-Place Text Editor Overlay */}
        {editingTextId && editingObj && viewMode === 'translated' && (() => {
          const scaledFontSize = editingObj.fontSize * zoom;
          const lineSpacing = editingObj.lineSpacing ?? 1.2;
          const scaledLineHeight = scaledFontSize * lineSpacing;
          const lineCount = Math.max(
            1,
            editingObj.lines && editingObj.lines.length > 0
              ? editingObj.lines.length
              : editingObj.text.split('\n').length
          );
          const contentHeight = lineCount * scaledLineHeight;
          const totalBoxHeight = editingObj.height * zoom;
          const verticalPadding = Math.max(0, Math.floor((totalBoxHeight - contentHeight) / 2));
          const horizontalPadding = Math.round(4 * zoom);

          // Check single-column vertical CJK layout
          const hasCjk = CJK_CHARACTER_REGEX.test(editingObj.text);
          const isVerticalMode = Boolean(editingObj.isVertical && hasCjk);

          return (
            <div
              style={{
                position: 'absolute',
                left: `${editingObj.x * zoom}px`,
                top: `${editingObj.y * zoom}px`,
                width: `${editingObj.width * zoom}px`,
                height: `${editingObj.height * zoom}px`,
                transform: editingObj.rotation ? `rotate(${editingObj.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                zIndex: 35,
                backgroundColor:
                  editingObj.backgroundFill && editingObj.backgroundFill !== 'transparent'
                    ? editingObj.backgroundFill
                    : 'transparent',
                borderRadius: editingObj.backgroundBorderRadius
                  ? `${editingObj.backgroundBorderRadius * zoom}px`
                  : undefined,
                boxSizing: 'border-box',
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <textarea
                ref={inlineTextareaRef}
                value={
                  (!isVerticalMode && !editingObj.text.includes('\n') && editingObj.lines && editingObj.lines.length > 1)
                    ? editingObj.lines.join('\n')
                    : editingObj.text
                }
                onChange={(e) => handleInlineTextChange(e.target.value)}
                onBlur={handleFinishInlineEdit}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
                    e.preventDefault();
                    handleToggleBold();
                  } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'i') {
                    e.preventDefault();
                    handleToggleItalic();
                  } else if (e.key === 'Escape') {
                    handleFinishInlineEdit();
                  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    handleFinishInlineEdit();
                  }
                  e.stopPropagation();
                }}
                onSelect={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  const sel = { start: el.selectionStart, end: el.selectionEnd };
                  setInlineSelection(sel);
                  studioStore.setState({
                    inlineSelection: { textId: editingObj.id, start: el.selectionStart, end: el.selectionEnd },
                  });
                }}
                onKeyUp={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  const sel = { start: el.selectionStart, end: el.selectionEnd };
                  setInlineSelection(sel);
                  studioStore.setState({
                    inlineSelection: { textId: editingObj.id, start: el.selectionStart, end: el.selectionEnd },
                  });
                }}
                onMouseUp={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  const sel = { start: el.selectionStart, end: el.selectionEnd };
                  setInlineSelection(sel);
                  studioStore.setState({
                    inlineSelection: { textId: editingObj.id, start: el.selectionStart, end: el.selectionEnd },
                  });
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  paddingTop: isVerticalMode ? `${horizontalPadding}px` : `${verticalPadding}px`,
                  paddingBottom: isVerticalMode ? `${horizontalPadding}px` : `${verticalPadding}px`,
                  paddingLeft: `${horizontalPadding}px`,
                  paddingRight: `${horizontalPadding}px`,
                  fontSize: `${scaledFontSize}px`,
                  fontFamily: editingObj.fontFamily || 'sans-serif',
                  fontWeight: editingObj.bold ? 'bold' : 'normal',
                  fontStyle: editingObj.italic ? 'italic' : 'normal',
                  color: 'transparent',
                  textAlign: editingObj.align || 'center',
                  lineHeight: lineSpacing,
                  writingMode: isVerticalMode ? 'vertical-rl' : undefined,
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  caretColor: '#f4446d',
                }}
                autoFocus
              />
            </div>
          );
        })()}
      </div>

      {/* Floating Action Pill Toolbar */}
      {pillPos && selectedObj && viewMode === 'translated' && !isSpacePanning && !hideBoxes && (() => {
        const clearanceAbove = Math.max(48, Math.round((24 + 8) * zoom) + 16);
        const calculatedTop = pillPos.y - clearanceAbove - 36;
        const placeAbove = calculatedTop >= (selectedObj.originalText ? 80 : 36);

        const toolbarY = placeAbove
          ? calculatedTop
          : (pillBottomPos?.y ?? (pillPos.y + selectedObj.height * zoom)) + 16;
        const ocrBarY = placeAbove
          ? calculatedTop - 38
          : toolbarY + 44;

        const isSelActive = Boolean(
          inlineSelection &&
          inlineSelection.start !== inlineSelection.end
        );
        const activeSelStart = inlineSelection ? Math.min(inlineSelection.start, inlineSelection.end) : 0;
        const selOverride = isSelActive && selectedObj.charStyles ? selectedObj.charStyles[activeSelStart] : null;
        const isBoldActive = selOverride?.bold !== undefined ? selOverride.bold : Boolean(selectedObj.bold);
        const isItalicActive = selOverride?.italic !== undefined ? selOverride.italic : Boolean(selectedObj.italic);

        return (
          <>
            {/* Floating Original Text Bar (Mapped from selected bubble) */}
            {selectedObj.originalText && (
              <div
                data-studio-toolbar="true"
                style={{
                  left: `${pillPos.x}px`,
                  top: `${ocrBarY}px`,
                  transform: 'translateX(-50%)',
                }}
                className="fixed z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#282d3f] bg-[#12141c]/95 backdrop-blur-md shadow-2xl text-slate-200 max-w-sm pointer-events-auto"
              >
                <span className="text-[10px] uppercase font-bold text-[#f4446d] tracking-wider shrink-0 flex items-center gap-1">
                  <Languages className="w-3 h-3" />
                  OCR:
                </span>
                <span
                  className="text-xs text-slate-300 truncate max-w-[200px] font-sans"
                  title={selectedObj.originalText}
                >
                  {selectedObj.originalText}
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    navigator.clipboard.writeText(selectedObj.originalText!);
                    setCopiedOrigPill(true);
                    setTimeout(() => setCopiedOrigPill(false), 1500);
                  }}
                  title="Copy original OCR text"
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition shrink-0 cursor-pointer"
                >
                  {copiedOrigPill ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            )}

            <div
              data-studio-toolbar="true"
              style={{
                left: `${pillPos.x}px`,
                top: `${toolbarY}px`,
                transform: 'translateX(-50%)',
              }}
              className="fixed z-40 flex items-center gap-0.5 p-1 rounded-xl border border-[#282d3f] bg-[#12141c]/95 backdrop-blur-md shadow-2xl text-slate-200"
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (editingTextId === selectedObj.id) {
                    handleFinishInlineEdit();
                  } else {
                    studioStore.setState({ editingTextId: selectedObj.id });
                  }
                }}
                title="Edit Dialogue (Double-click bubble or Enter)"
                className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-[#f4446d] hover:text-[#e0355e] transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleToggleBold}
                title={isSelActive ? "Bold Selected Text (Ctrl+B)" : "Toggle Box Bold (Ctrl+B)"}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isBoldActive ? 'bg-[#f4446d]/20 text-[#f4446d]' : 'text-slate-300 hover:text-white hover:bg-[#1c1f2e]'
                }`}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleToggleItalic}
                title={isSelActive ? "Italic Selected Text (Ctrl+I)" : "Toggle Box Italic (Ctrl+I)"}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isItalicActive ? 'bg-[#f4446d]/20 text-[#f4446d]' : 'text-slate-300 hover:text-white hover:bg-[#1c1f2e]'
                }`}
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddNewEmptyTextBox}
                title="Add New Text Box"
                className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopyStyle}
                title="Copy Typography Style"
                className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              {clipboardStyle && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handlePasteStyle}
                  title="Paste Typography Style"
                  className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-[#f4446d] hover:text-[#e0355e] transition cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleDuplicateSelectedText}
                title="Duplicate Bubble (Ctrl+D)"
                className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <CopyPlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleRasterizeText}
                title="Rasterize to Background Canvas"
                className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleDeleteSelectedText}
                title="Delete Bubble (Delete)"
                className="p-1.5 rounded-lg hover:bg-[#f4446d]/15 text-[#f4446d] hover:text-[#e0355e] transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        );
      })()}

      {activeTool === 'ocr' && ocrFeedback && !isAiProcessing && (
        <div role="status" className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-[#282d3f] bg-[#12141c] px-4 py-3 text-xs text-slate-200 shadow-xl">
          <div className="flex items-start gap-3">
            <span>{ocrFeedback}</span>
            <button type="button" aria-label="Dismiss OCR message" onClick={() => setOcrFeedback(null)} className="text-slate-400 hover:text-white">×</button>
          </div>
        </div>
      )}

      {/* Local AI WebGPU Processing Spinner */}
      {isAiProcessing && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#f4446d]/40 bg-[#12141c]/90 backdrop-blur-md text-xs text-[#f4446d] shadow-xl">
          <Sparkles className="w-4 h-4 animate-spin text-[#f4446d]" />
          <span>Local WebGPU Inference...</span>
        </div>
      )}

      {/* Custom Full-Composite Canvas Context Menu (Prevents transparent overlay right-click save bug) */}
      {contextMenu && (
        <div
          data-studio-context-menu="true"
          style={{
            left: `${Math.min(contextMenu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(contextMenu.y, window.innerHeight - 260)}px`,
          }}
          className="fixed z-50 w-52 rounded-xl border border-[#282d3f] bg-[#12141c]/95 backdrop-blur-md p-1.5 shadow-2xl text-xs text-slate-200 select-none animate-in fade-in duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
            Image Export
          </div>
          <button
            type="button"
            onClick={() => handleContextDownload('png')}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] hover:text-white transition cursor-pointer text-left"
          >
            <Download className="w-3.5 h-3.5 text-[#f4446d]" />
            <span>Save Image As (PNG)</span>
          </button>
          <button
            type="button"
            onClick={handleContextCopyImage}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] hover:text-white transition cursor-pointer text-left"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-400" />
            <span>Copy Full Image</span>
          </button>

          <div className="my-1 border-t border-[#262a3b]" />

          {contextMenu.targetObj ? (
            <>
              <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Dialogue Bubble
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.targetObj!.text);
                  setOcrFeedback('Copied dialogue text');
                  setTimeout(() => setOcrFeedback(null), 2000);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] hover:text-white transition cursor-pointer text-left"
              >
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy Dialogue Text</span>
              </button>
              {contextMenu.targetObj.originalText && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.targetObj!.originalText!);
                    setOcrFeedback('Copied original OCR text');
                    setTimeout(() => setOcrFeedback(null), 2000);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] hover:text-white transition cursor-pointer text-left"
                >
                  <Languages className="w-3.5 h-3.5 text-[#f4446d]" />
                  <span>Copy Original OCR</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  handleDuplicateSelectedText();
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] hover:text-white transition cursor-pointer text-left"
              >
                <CopyPlus className="w-3.5 h-3.5 text-slate-400" />
                <span>Duplicate Bubble</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDeleteSelectedText();
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#f4446d]/15 text-[#f4446d] hover:text-[#e0355e] transition cursor-pointer text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Bubble</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleContextAddBoxHere}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#1c1f2e] hover:text-white transition cursor-pointer text-left"
            >
              <Plus className="w-3.5 h-3.5 text-[#f4446d]" />
              <span>Add Text Box Here</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
