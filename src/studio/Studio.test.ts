import { describe, it, expect, beforeEach } from 'vitest';
import { studioStore } from './state/studioStore';
import { studioUndoStack } from './state/undoStack';
import type { TextObject } from './types';

describe('Studio State Management', () => {
  beforeEach(() => {
    studioStore.setState({
      activeTool: 'select',
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      isCanvasFlipped: false,
      textObjects: [],
      selectedTextId: null,
      globalEditMode: false,
    });
    studioUndoStack.clear();
  });

  it('switches tools and updates activeTool state', () => {
    studioStore.setState({ activeTool: 'erase' });
    expect(studioStore.getState().activeTool).toBe('erase');

    studioStore.setState({ activeTool: 'inpaint' });
    expect(studioStore.getState().activeTool).toBe('inpaint');
  });

  it('clamps zoom factors to safety limits', () => {
    studioStore.setClampedZoom(0.001);
    expect(studioStore.getState().zoom).toBeGreaterThanOrEqual(0.05);

    studioStore.setClampedZoom(25.0);
    expect(studioStore.getState().zoom).toBeLessThanOrEqual(8.0);
  });

  it('pushes and restores text edits through the undo stack', () => {
    const text1: TextObject = {
      id: 't-1',
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      text: 'Initial dialogue',
      fontSize: 16,
      fontFamily: 'WildWords',
      color: '#000',
    };

    studioStore.setState({ textObjects: [text1] });

    const text2: TextObject = {
      ...text1,
      text: 'Edited dialogue',
    };

    studioUndoStack.push({
      id: 'edit-1',
      timestamp: Date.now(),
      description: 'Edit text',
      textObjects: {
        before: [text1],
        after: [text2],
      },
    });

    studioStore.setState({ textObjects: [text2] });
    expect(studioStore.getState().textObjects[0].text).toBe('Edited dialogue');

    studioUndoStack.undo({
      applyTextObjects: (objs) => studioStore.setState({ textObjects: objs }),
    });

    expect(studioStore.getState().textObjects[0].text).toBe('Initial dialogue');

    studioUndoStack.redo({
      applyTextObjects: (objs) => studioStore.setState({ textObjects: objs }),
    });

    expect(studioStore.getState().textObjects[0].text).toBe('Edited dialogue');
  });

  it('toggles isShowingOriginal to switch between raw untranslated image and translated view', () => {
    expect(studioStore.getState().isShowingOriginal).toBe(false);
    studioStore.setState({ isShowingOriginal: true });
    expect(studioStore.getState().isShowingOriginal).toBe(true);
    studioStore.setState({ isShowingOriginal: false });
    expect(studioStore.getState().isShowingOriginal).toBe(false);
  });

  it('manages engine tier selection and global sync toggle', () => {
    expect(studioStore.getState().syncWithGlobal).toBe(true);
    studioStore.setEngineSelection('inpaint', 'aotgan');
    expect(studioStore.getState().selectedInpaintEngineId).toBe('aotgan');

    studioStore.setEngineSelection('ocr', 'v6-medium');
    expect(studioStore.getState().selectedOcrEngineId).toBe('v6-medium');

    studioStore.setState({ syncWithGlobal: false });
    expect(studioStore.getState().syncWithGlobal).toBe(false);

    studioStore.setEngineSelection('inpaint', 'telea');
    expect(studioStore.getState().selectedInpaintEngineId).toBe('telea');
  });

  it('restores compound raster patch and text objects in a single undo step', () => {
    let restoredRasterX = -1;
    let restoredTextCount = -1;

    const dummyImageData = {} as ImageData;
    studioUndoStack.push({
      id: 'ocr-action',
      timestamp: Date.now(),
      description: 'Live AI Re-OCR',
      rasterPatch: {
        before: { x: 50, y: 60, width: 100, height: 100, patchImageData: dummyImageData },
        after: { x: 50, y: 60, width: 100, height: 100, patchImageData: dummyImageData },
      },
      textObjects: {
        before: [],
        after: [{ id: 'b-1', x: 50, y: 60, width: 80, height: 40, text: 'New', fontSize: 16, fontFamily: 'sans', color: '#000' }],
      },
    });

    studioUndoStack.undo({
      applyRasterPatch: (patch) => {
        restoredRasterX = patch.x;
      },
      applyTextObjects: (objs) => {
        restoredTextCount = objs.length;
      },
    });

    expect(restoredRasterX).toBe(50);
    expect(restoredTextCount).toBe(0);
  });

  it('manages OCR settings state with scanSource, translate, and inpaint toggles', () => {
    expect(studioStore.getState().ocrSettings.scanSource).toBe('original');
    expect(studioStore.getState().ocrSettings.translate).toBe(true);
    expect(studioStore.getState().ocrSettings.inpaint).toBe(true);

    studioStore.setState({
      ocrSettings: {
        ...studioStore.getState().ocrSettings,
        scanSource: 'background',
        translate: false,
        inpaint: false,
      },
    });

    expect(studioStore.getState().ocrSettings.scanSource).toBe('background');
    expect(studioStore.getState().ocrSettings.translate).toBe(false);
    expect(studioStore.getState().ocrSettings.inpaint).toBe(false);
  });
});
