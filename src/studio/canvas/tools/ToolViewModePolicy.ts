import type { StudioTool, StudioViewMode } from '../../types';

/**
 * Strategy defining which tools can interactively execute in each Studio presentation view mode.
 */
export class ToolViewModePolicy {
  /**
   * Map of permissible presentation modes per tool.
   * - 'ocr' & 'inpaint': Active in all modes ('original', 'inpainted', 'translated').
   * - 'erase': Disabled in pristine 'original' mode (as requested), active in 'inpainted' and 'translated'.
   * - 'paint': Disabled in pristine 'original' mode, active in 'inpainted' and 'translated'.
   * - 'select', 'text', 'warp', 'image': Active only in 'translated' mode where text boxes and stickers are visible.
   */
  private static readonly ALLOWED_MODES: Record<StudioTool, readonly StudioViewMode[]> = {
    ocr: ['original', 'inpainted', 'translated'],
    inpaint: ['original', 'inpainted', 'translated'],
    erase: ['inpainted', 'translated'],
    paint: ['inpainted', 'translated'],
    select: ['translated'],
    text: ['translated'],
    warp: ['translated'],
    image: ['translated'],
  };

  /**
   * Evaluates if a given tool can initiate interactive gestures in the specified view mode.
   *
   * @param tool - Current active studio tool.
   * @param viewMode - Current active canvas view mode.
   * @returns True if interaction is permitted, false otherwise.
   */
  public static isToolAllowed(tool: StudioTool, viewMode: StudioViewMode): boolean {
    const allowed = this.ALLOWED_MODES[tool];
    return allowed ? allowed.includes(viewMode) : false;
  }

  /**
   * Determines if text furniture or selection handles should be displayed on overlay.
   *
   * @param viewMode - Current active canvas view mode.
   * @returns True if text overlay furniture should be active.
   */
  public static shouldShowTextFurniture(viewMode: StudioViewMode): boolean {
    return viewMode === 'translated';
  }
}
