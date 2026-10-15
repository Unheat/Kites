import { describe, expect, it } from 'vitest';
import { ToolViewModePolicy } from './ToolViewModePolicy';
import type { StudioTool } from '../../types';

describe('ToolViewModePolicy', () => {
  it('allows OCR and inpaint brushes across all three view presentation modes', () => {
    const aiTools: StudioTool[] = ['ocr', 'inpaint'];
    for (const tool of aiTools) {
      expect(ToolViewModePolicy.isToolAllowed(tool, 'original')).toBe(true);
      expect(ToolViewModePolicy.isToolAllowed(tool, 'inpainted')).toBe(true);
      expect(ToolViewModePolicy.isToolAllowed(tool, 'translated')).toBe(true);
    }
  });

  it('prohibits erase and paint in pristine original mode but permits them in inpainted and translated modes', () => {
    expect(ToolViewModePolicy.isToolAllowed('erase', 'original')).toBe(false);
    expect(ToolViewModePolicy.isToolAllowed('erase', 'inpainted')).toBe(true);
    expect(ToolViewModePolicy.isToolAllowed('erase', 'translated')).toBe(true);

    expect(ToolViewModePolicy.isToolAllowed('paint', 'original')).toBe(false);
    expect(ToolViewModePolicy.isToolAllowed('paint', 'inpainted')).toBe(true);
    expect(ToolViewModePolicy.isToolAllowed('paint', 'translated')).toBe(true);
  });

  it('restricts typography and object interaction tools to translated mode only', () => {
    const objectTools: StudioTool[] = ['select', 'text', 'warp', 'image'];
    for (const tool of objectTools) {
      expect(ToolViewModePolicy.isToolAllowed(tool, 'original')).toBe(false);
      expect(ToolViewModePolicy.isToolAllowed(tool, 'inpainted')).toBe(false);
      expect(ToolViewModePolicy.isToolAllowed(tool, 'translated')).toBe(true);
    }
  });

  it('specifies text furniture visibility strictly in translated mode', () => {
    expect(ToolViewModePolicy.shouldShowTextFurniture('original')).toBe(false);
    expect(ToolViewModePolicy.shouldShowTextFurniture('inpainted')).toBe(false);
    expect(ToolViewModePolicy.shouldShowTextFurniture('translated')).toBe(true);
  });
});
