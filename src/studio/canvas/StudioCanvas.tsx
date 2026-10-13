import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
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
import { requestStudioInpaint, requestStudioOcr } from '../bridge/offscreenStudioBridge';
import type {
  BoundingBox,
  Point,
  TextObject,
  TransformHandle,
} from '../types';

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
  const isShowingOriginal = useStudioStore((s) => s.isShowingOriginal ?? s.isCanvasFlipped);
  const hideBoxes = useStudioStore((s) => s.hideBoxes);
  const textObjects = useStudioStore((s) => s.textObjects);
  const selectedTextId = useStudioStore((s) => s.selectedTextId);
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
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const aiProcessingRef = useRef(false);
  const [ocrFeedback, setOcrFeedback] = useState<string | null>(null);
  const [activeHandle, setActiveHandle] = useState<TransformHandle | null>(null);
  const [dragStartPoint, setDragStartPoint] = useState<Point | null>(null);
  const [initialTransformState, setInitialTransformState] = useState<TextObject | null>(null);
  const [preStrokePatch, setPreStrokePatch] = useState<any>(null);

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

    overlay.width = imageWidth;
    overlay.height = imageHeight;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, imageWidth, imageHeight);

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
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = obj.width;
        tempCanvas.height = obj.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
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
      const selectedObj = textObjects.find((t) => t.id === selectedTextId);
      if (selectedObj) {
        CanvasFurniture.drawSelectionFurniture(ctx, selectedObj, appearance.selectedBoxBorderColor);
      }
    }
  }, [imageWidth, imageHeight, textObjects, imageLayers, selectedTextId, selectedImageLayerId, appearance, hideBoxes]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  // Spacebar pan gesture listener
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedTextId) {
        e.preventDefault();
        handleDuplicateSelectedText();
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
  }, [selectedTextId]);

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

  const getPointerImageCoords = (e: React.PointerEvent): Point => {
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

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || aiProcessingRef.current || isAiProcessing || isShowingOriginal) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getPointerImageCoords(e);
    setIsPointerDown(true);
    setDragStartPoint(pt);

    if (isSpacePanning) {
      return;
    }

    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext('2d', { willReadFrequently: true });

    // Erase / Restore Brush
    if (activeTool === 'erase' && bgCtx) {
      const radius = eraseSettings.size / 2;
      const initialBbox: BoundingBox = {
        x: pt.x - radius,
        y: pt.y - radius,
        width: eraseSettings.size,
        height: eraseSettings.size,
      };
      setPreStrokePatch(BrushEngine.captureBoundingPatch(bgCtx, initialBbox));

      brushEngineRef.current.beginStroke(pt, {
        shape: eraseSettings.shape,
        size: eraseSettings.size,
        feather: eraseSettings.feather,
      });
      return;
    }

    // Paint Brush
    if (activeTool === 'paint' && bgCtx) {
      const radius = paintSettings.size / 2;
      const initialBbox: BoundingBox = {
        x: pt.x - radius,
        y: pt.y - radius,
        width: paintSettings.size,
        height: paintSettings.size,
      };
      setPreStrokePatch(BrushEngine.captureBoundingPatch(bgCtx, initialBbox));

      brushEngineRef.current.beginStroke(pt, {
        shape: paintSettings.shape,
        size: paintSettings.size,
        feather: paintSettings.feather,
        color: paintSettings.color,
        paintMode: paintSettings.mode,
        blurRadius: paintSettings.blurRadius,
        patternScale: paintSettings.patternScale,
      });
      return;
    }

    // Inpaint / OCR Mask Brush
    if (activeTool === 'inpaint' || activeTool === 'ocr') {
      const brushSize = activeTool === 'inpaint' ? inpaintSettings.size : ocrSettings.size;
      brushEngineRef.current.beginStroke(pt, {
        shape: activeTool === 'inpaint' ? inpaintSettings.shape : ocrSettings.shape,
        size: brushSize,
        feather: 0,
      });
      return;
    }

    // Select & Transform Tool
    if (activeTool === 'select' || activeTool === 'text') {
      const selectedObj = textObjects.find((t) => t.id === selectedTextId);

      if (selectedObj && !hideBoxes) {
        const handle = CanvasFurniture.hitTestHandles(pt, selectedObj);
        if (handle) {
          setActiveHandle(handle);
          setInitialTransformState({ ...selectedObj });
          return;
        }
      }

      let clickedObj: TextObject | null = null;
      for (let i = textObjects.length - 1; i >= 0; i--) {
        if (CanvasFurniture.hitTestBody(pt, textObjects[i])) {
          clickedObj = textObjects[i];
          break;
        }
      }

      if (clickedObj) {
        studioStore.setState({ selectedTextId: clickedObj.id });
        setActiveHandle('nw');
        setInitialTransformState({ ...clickedObj });
        return;
      }

      if (activeTool === 'text') {
        const newObj: TextObject = {
          id: `bubble-${Date.now()}`,
          x: Math.round(pt.x - 60),
          y: Math.round(pt.y - 20),
          width: 120,
          height: 40,
          text: 'New Dialogue',
          fontSize: 18,
          fontFamily: 'WildWords, CCWildWords, sans-serif',
          color: '#000000',
          strokeColor: '#ffffff',
          strokeWidth: 2,
          align: 'center',
          isVertical: false,
        };
        const prev = [...textObjects];
        const next = [...textObjects, newObj];
        studioStore.setState({ textObjects: next, selectedTextId: newObj.id });
        studioUndoStack.push({
          id: `create-bubble-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Create Text Bubble',
          textObjects: { before: prev, after: next },
        });
        return;
      }

      studioStore.setState({ selectedTextId: null });
      setActiveHandle(null);
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

    if (!isPointerDown) return;

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
      brushEngineRef.current.extendStroke(pt, {
        shape: activeTool === 'inpaint' ? inpaintSettings.shape : ocrSettings.shape,
        size: brushSize,
        feather: 0,
      });

      const overlay = overlayCanvasRef.current;
      const ctx = overlay?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = activeTool === 'inpaint' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(244, 63, 94, 0.4)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    // Transform Selected Text Object
    if ((activeTool === 'select' || activeTool === 'text') && activeHandle && dragStartPoint && initialTransformState) {
      const deltaX = pt.x - dragStartPoint.x;
      const deltaY = pt.y - dragStartPoint.y;

      let updated = { ...initialTransformState };

      if (activeHandle === 'nw' && !initialTransformState.rotation) {
        updated.x = Math.round(initialTransformState.x + deltaX);
        updated.y = Math.round(initialTransformState.y + deltaY);
      } else if (activeHandle === 'rot') {
        const centerX = initialTransformState.x + initialTransformState.width / 2;
        const centerY = initialTransformState.y + initialTransformState.height / 2;
        const angleRad = Math.atan2(pt.y - centerY, pt.x - centerX);
        updated.rotation = Math.round((angleRad * 180) / Math.PI + 90);
      } else if (activeHandle === 'se') {
        updated.width = Math.max(30, Math.round(initialTransformState.width + deltaX));
        updated.height = Math.max(20, Math.round(initialTransformState.height + deltaY));
      } else if (activeHandle === 'e') {
        updated.width = Math.max(30, Math.round(initialTransformState.width + deltaX));
      } else if (activeHandle === 's') {
        updated.height = Math.max(20, Math.round(initialTransformState.height + deltaY));
      }

      studioStore.setState({
        textObjects: textObjects.map((t) => (t.id === updated.id ? updated : t)),
      });
    }
  };

  // Pointer Up
  const handlePointerUp = async () => {
    if (!isPointerDown || aiProcessingRef.current) return;
    setIsPointerDown(false);
    setActiveHandle(null);
    setDragStartPoint(null);

    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext('2d', { willReadFrequently: true });

    // Erase or Paint stroke undo patch
    if ((activeTool === 'erase' || activeTool === 'paint') && bgCtx && preStrokePatch) {
      const bbox = brushEngineRef.current.endStroke(eraseSettings.feather);
      const postStrokePatch = BrushEngine.captureBoundingPatch(bgCtx, bbox);

      studioUndoStack.push({
        id: `stroke-${Date.now()}`,
        timestamp: Date.now(),
        description: activeTool === 'erase' ? 'Erase/Restore Stroke' : 'Paint Stroke',
        rasterPatch: {
          before: preStrokePatch,
          after: postStrokePatch,
        },
      });
      setPreStrokePatch(null);
      return;
    }

    // Finalize Live AI Inpaint
    if (activeTool === 'inpaint' && bgCanvas && bgCtx) {
      const bbox = brushEngineRef.current.endStroke(0);
      if (bbox.width <= 5 || bbox.height <= 5) return;

      const pad = 12;
      const cropX = Math.max(0, bbox.x - pad);
      const cropY = Math.max(0, bbox.y - pad);
      const cropW = Math.min(imageWidth - cropX, bbox.width + pad * 2);
      const cropH = Math.min(imageHeight - cropY, bbox.height + pad * 2);
      const paddedBbox: BoundingBox = { x: cropX, y: cropY, width: cropW, height: cropH };

      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = cropW;
      patchCanvas.height = cropH;
      const patchCtx = patchCanvas.getContext('2d');
      patchCtx?.drawImage(bgCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = cropW;
      maskCanvas.height = cropH;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx?.fillRect(0, 0, cropW, cropH);

      const preInpaintPatch = BrushEngine.captureBoundingPatch(bgCtx, paddedBbox);
      redrawOverlay();

      setIsAiProcessing(true);
      try {
        const inpaintedImg = await requestStudioInpaint(
          patchCanvas,
          maskCanvas,
          paddedBbox,
          selectedInpaintEngineId
        );
        bgCtx.drawImage(inpaintedImg, cropX, cropY, cropW, cropH);
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
          ocrSettings.scanSource
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

    // Transform Text Box Undo state
    if (initialTransformState && selectedTextId) {
      const current = textObjects.find((t) => t.id === selectedTextId);
      if (current && JSON.stringify(current) !== JSON.stringify(initialTransformState)) {
        const prev = textObjects.map((t) => (t.id === initialTransformState.id ? initialTransformState : t));
        studioUndoStack.push({
          id: `transform-${Date.now()}`,
          timestamp: Date.now(),
          description: 'Transform Text Box',
          textObjects: { before: prev, after: textObjects },
        });
      }
      setInitialTransformState(null);
    }
  };

  // Floating Action Pill Handlers
  const handleCopyStyle = () => {
    const selected = textObjects.find((t) => t.id === selectedTextId);
    if (!selected) return;
    studioStore.setState({
      clipboardStyle: {
        fontFamily: selected.fontFamily,
        fontSize: selected.fontSize,
        color: selected.color,
        strokeColor: selected.strokeColor,
        strokeWidth: selected.strokeWidth,
        align: selected.align,
        isVertical: selected.isVertical,
        shadowDistance: selected.shadowDistance,
        shadowAngle: selected.shadowAngle,
      },
    });
  };

  const handlePasteStyle = () => {
    if (!clipboardStyle || !selectedTextId) return;
    const prev = [...textObjects];
    const next = textObjects.map((t) => (t.id === selectedTextId ? { ...t, ...clipboardStyle } : t));
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `paste-style-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Paste Typography Style',
      textObjects: { before: prev, after: next },
    });
  };

  const handleDuplicateSelectedText = () => {
    const selected = textObjects.find((t) => t.id === selectedTextId);
    if (!selected) return;
    const cloned: TextObject = {
      ...selected,
      id: `bubble-${Date.now()}`,
      x: selected.x + 20,
      y: selected.y + 20,
    };
    const prev = [...textObjects];
    const next = [...textObjects, cloned];
    studioStore.setState({ textObjects: next, selectedTextId: cloned.id });
    studioUndoStack.push({
      id: `duplicate-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Duplicate Text Box',
      textObjects: { before: prev, after: next },
    });
  };

  const handleDeleteSelectedText = () => {
    if (!selectedTextId) return;
    const prev = [...textObjects];
    const next = textObjects.filter((t) => t.id !== selectedTextId);
    studioStore.setState({ textObjects: next, selectedTextId: null });
    studioUndoStack.push({
      id: `delete-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Delete Text Box',
      textObjects: { before: prev, after: next },
    });
  };

  const handleRasterizeText = () => {
    const selected = textObjects.find((t) => t.id === selectedTextId);
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

    const prevTexts = [...textObjects];
    const nextTexts = textObjects.filter((t) => t.id !== selected.id);

    studioStore.setState({ textObjects: nextTexts, selectedTextId: null });
    studioUndoStack.push({
      id: `rasterize-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Rasterize Text to Background',
      rasterPatch: { before: prePatch, after: postPatch },
      textObjects: { before: prevTexts, after: nextTexts },
    });
  };

  // Compute screen coordinates for floating action pill
  const selectedObj = textObjects.find((t) => t.id === selectedTextId);
  const pillPos = selectedObj && overlayCanvasRef.current
    ? imageToClient(
        selectedObj.x + selectedObj.width / 2,
        selectedObj.y,
        overlayCanvasRef.current.getBoundingClientRect(),
        imageWidth,
        imageHeight
      )
    : null;

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className={`relative flex flex-1 min-h-0 overflow-auto p-4 w-full h-full bg-[#0a0c12] select-none ${
        isSpacePanning ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* Centered Canvas Spacer: Torii m-auto architecture */}
      <div
        ref={spacerRef}
        style={{
          width: `${imageWidth * zoom}px`,
          height: `${imageHeight * zoom}px`,
        }}
        className="relative block shrink-0 m-auto select-none"
      >
        {/* Pristine original image canvas (visible when isShowingOriginal is true) */}
        <canvas
          ref={originalCanvasRef}
          style={{
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            display: isShowingOriginal ? 'block' : 'none',
          }}
          className="block absolute top-0 left-0 shadow-2xl rounded-sm"
        />

        {/* Working background raster canvas (cleaned/painted artwork) */}
        <canvas
          ref={bgCanvasRef}
          data-studio-working-background="true"
          id="studio-working-background"
          style={{
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            display: isShowingOriginal ? 'none' : 'block',
          }}
          className="block absolute top-0 left-0 shadow-2xl rounded-sm"
        />

        {/* Live overlay canvas for text, stickers, furniture */}
        <canvas
          ref={overlayCanvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            width: `${imageWidth * zoom}px`,
            height: `${imageHeight * zoom}px`,
            display: isShowingOriginal ? 'none' : 'block',
          }}
          className="block absolute top-0 left-0 cursor-crosshair"
        />
      </div>

      {/* Floating Action Pill Toolbar (Figma/Torii style) */}
      {pillPos && selectedObj && !isShowingOriginal && !isSpacePanning && !hideBoxes && (
        <div
          style={{
            left: `${pillPos.x}px`,
            top: `${pillPos.y - 44}px`,
            transform: 'translateX(-50%)',
          }}
          className="fixed z-40 flex items-center gap-0.5 p-1 rounded-xl border border-[#282d3f] bg-[#12141c]/95 backdrop-blur-md shadow-2xl text-slate-200"
        >
          <button
            onClick={handleCopyStyle}
            title="Copy Typography Style"
            className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          {clipboardStyle && (
            <button
              onClick={handlePasteStyle}
              title="Paste Typography Style"
              className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-[#f4446d] hover:text-[#e0355e] transition"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleDuplicateSelectedText}
            title="Duplicate Bubble (Ctrl+D)"
            className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition"
          >
            <CopyPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRasterizeText}
            title="Rasterize to Background Canvas"
            className="p-1.5 rounded-lg hover:bg-[#1c1f2e] text-slate-300 hover:text-white transition"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDeleteSelectedText}
            title="Delete Bubble (Delete)"
            className="p-1.5 rounded-lg hover:bg-[#f4446d]/15 text-[#f4446d] hover:text-[#e0355e] transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
    </div>
  );
};
