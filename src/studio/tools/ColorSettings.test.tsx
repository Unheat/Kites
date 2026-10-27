import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorSettings } from './ColorSettings';
import { studioStore } from '../state/studioStore';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  studioStore.setState({
    selectedColorEngineId: 'manga-colorization-v2',
    downloadedModelIds: ['manga-colorization-v2', 'none'],
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ColorSettings Component', () => {
  it('renders title and uncolored status banner when isPageColorized is false', () => {
    act(() => {
      root.render(
        <ColorSettings
          onColorize={vi.fn()}
          isColorizing={false}
          isPageColorized={false}
        />
      );
    });

    expect(container.textContent).toContain('Manga Page Colorization');
    expect(container.textContent).toContain('Black & White Scan');
    expect(container.textContent).toContain('Colorize Manga Page');
  });

  it('renders colorized status banner and re-colorize label when isPageColorized is true', () => {
    act(() => {
      root.render(
        <ColorSettings
          onColorize={vi.fn()}
          isColorizing={false}
          isPageColorized={true}
        />
      );
    });

    expect(container.textContent).toContain('Page is Colorized');
    expect(container.textContent).toContain('Re-colorize Page');
    expect(container.textContent).toContain('Ctrl+Z to undo');
  });

  it('renders loading state and disables button when isColorizing is true', () => {
    act(() => {
      root.render(
        <ColorSettings
          onColorize={vi.fn()}
          isColorizing={true}
          isPageColorized={false}
        />
      );
    });

    expect(container.textContent).toContain('Colorizing Page…');
    const button = container.querySelector('button[disabled]');
    expect(button).not.toBeNull();
  });

  it('triggers onColorize when clicked', () => {
    const handleColorize = vi.fn();
    act(() => {
      root.render(
        <ColorSettings
          onColorize={handleColorize}
          isColorizing={false}
          isPageColorized={false}
        />
      );
    });

    // Find the main action button
    const buttons = Array.from(container.querySelectorAll('button'));
    const colorizeBtn = buttons.find((b) => b.textContent?.includes('Colorize Manga Page'));
    expect(colorizeBtn).toBeDefined();

    act(() => {
      colorizeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(handleColorize).toHaveBeenCalledTimes(1);
  });
});
