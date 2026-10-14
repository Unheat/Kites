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

  it('manages editingTextId and originalImage references in studioStore', () => {
    expect(studioStore.getState().editingTextId).toBeNull();
    expect(studioStore.getState().originalImage).toBeNull();

    studioStore.setState({ editingTextId: 'bubble-42' });
    expect(studioStore.getState().editingTextId).toBe('bubble-42');

    const dummyImg = { naturalWidth: 800, naturalHeight: 1200 } as unknown as HTMLImageElement;
    studioStore.setState({ originalImage: dummyImg });
    expect(studioStore.getState().originalImage).toBe(dummyImg);
  });

  it('allows updating dialogue text and restoring via undo stack', () => {
    const bubble: TextObject = {
      id: 'b-dialogue-1',
      x: 100,
      y: 150,
      width: 140,
      height: 50,
      text: 'ngọt ngào',
      originalText: '甘い...',
      fontSize: 20,
      fontFamily: 'WildWords',
      color: '#000000',
    };

    studioStore.setState({ textObjects: [bubble], selectedTextId: bubble.id });

    // Simulate user editing dialogue text
    const editedText = 'rất ngọt ngào';
    const nextObjects = studioStore.getState().textObjects.map((t) =>
      t.id === bubble.id ? { ...t, text: editedText, lines: undefined } : t
    );

    studioUndoStack.push({
      id: 'edit-dialogue-test',
      timestamp: Date.now(),
      description: 'Edit Dialogue Text',
      textObjects: { before: [bubble], after: nextObjects },
    });
    studioStore.setState({ textObjects: nextObjects });

    expect(studioStore.getState().textObjects[0].text).toBe('rất ngọt ngào');
    expect(studioStore.getState().textObjects[0].originalText).toBe('甘い...');

    // Undo dialogue edit
    studioUndoStack.undo({
      applyTextObjects: (objs) => studioStore.setState({ textObjects: objs }),
    });

    expect(studioStore.getState().textObjects[0].text).toBe('ngọt ngào');
  });

  it('reverts dialogue text back to original OCR text', () => {
    const bubble: TextObject = {
      id: 'b-dialogue-2',
      x: 50,
      y: 50,
      width: 120,
      height: 40,
      text: 'Changed text',
      originalText: '元のテキスト',
      fontSize: 16,
      fontFamily: 'WildWords',
      color: '#000000',
    };

    studioStore.setState({ textObjects: [bubble], selectedTextId: bubble.id });

    // Revert to original
    const reverted = studioStore.getState().textObjects.map((t) =>
      t.id === bubble.id ? { ...t, text: t.originalText!, lines: undefined } : t
    );
    studioStore.setState({ textObjects: reverted });

    expect(studioStore.getState().textObjects[0].text).toBe('元のテキスト');
  });

  it('allows correcting originalText OCR errors with undo tracking', () => {
    const bubble: TextObject = {
      id: 'b-dialogue-3',
      x: 50,
      y: 50,
      width: 120,
      height: 40,
      text: 'Translation',
      originalText: 'Typo in OCR',
      fontSize: 16,
      fontFamily: 'WildWords',
      color: '#000000',
    };

    studioStore.setState({ textObjects: [bubble], selectedTextId: bubble.id });

    const corrected = studioStore.getState().textObjects.map((t) =>
      t.id === bubble.id ? { ...t, originalText: 'Corrected OCR Text' } : t
    );

    studioUndoStack.push({
      id: 'edit-orig-test',
      timestamp: Date.now(),
      description: 'Update Original OCR Text',
      textObjects: { before: [bubble], after: corrected },
    });
    studioStore.setState({ textObjects: corrected });

    expect(studioStore.getState().textObjects[0].originalText).toBe('Corrected OCR Text');

    // Undo original OCR correction
    studioUndoStack.undo({
      applyTextObjects: (objs) => studioStore.setState({ textObjects: objs }),
    });
    expect(studioStore.getState().textObjects[0].originalText).toBe('Typo in OCR');
  });

  it('creates an empty text box without original OCR text mapping and supports full editing', () => {
    const emptyBox: TextObject = {
      id: 'b-empty-1',
      x: 120,
      y: 120,
      width: 140,
      height: 50,
      text: 'Manual Dialogue',
      originalText: undefined,
      fontSize: 18,
      fontFamily: 'WildWords',
      color: '#000000',
    };

    studioStore.setState({ textObjects: [emptyBox], selectedTextId: emptyBox.id, editingTextId: null });

    expect(studioStore.getState().textObjects[0].originalText).toBeUndefined();
    expect(studioStore.getState().textObjects[0].text).toBe('Manual Dialogue');
    expect(studioStore.getState().editingTextId).toBeNull(); // Starts transparent directly on canvas

    // Verify it acts like a normal text box with style updates
    const styled = studioStore.getState().textObjects.map((t) =>
      t.id === emptyBox.id ? { ...t, fontSize: 24, bold: true } : t
    );
    studioStore.setState({ textObjects: styled });

    expect(studioStore.getState().textObjects[0].fontSize).toBe(24);
    expect(studioStore.getState().textObjects[0].bold).toBe(true);
    expect(studioStore.getState().textObjects[0].originalText).toBeUndefined();

    // Verify deselecting
    studioStore.setState({ selectedTextId: null });
    expect(studioStore.getState().selectedTextId).toBeNull();
  });
});
