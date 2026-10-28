import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontPickerDropdown } from './FontPickerDropdown';

// Library mock resolves asynchronously with an installed face, replaying the live
// sequence that previously crashed the picker: open → installed resolves → items
// change → search index rebuilt. MiniSearch.add throws on duplicate ids, so the
// old addAll-on-items-change pattern unmounted the whole popup.
const listLibraryMock = vi.fn(async () => ({
  installed: [{ id: 'bangers', family: 'Bangers', label: 'Bangers', source: 'catalog' as const }],
  pending: [],
}));

vi.mock('../fontLibrary', () => ({
  listLibrary: (...args: unknown[]) => listLibraryMock(...(args as [])),
  downloadCatalogFont: vi.fn(),
  importFontFile: vi.fn(),
  deleteFont: vi.fn(),
  ensureFontsRegistered: vi.fn(async () => undefined),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  listLibraryMock.mockClear();
});

describe('FontPickerDropdown', () => {
  it('survives the async library refresh after opening and lists installed faces', async () => {
    await act(async () => {
      root.render(
        <FontPickerDropdown
          variant="popup"
          ariaLabel="Font"
          selection={{ type: 'preset', presetId: 'standard' }}
          onSelect={() => {}}
        />,
      );
    });

    const trigger = container.querySelector('button[aria-label="Font"]') as HTMLButtonElement;
    await act(async () => { trigger.click(); });
    // Flush the library promise + re-render with installed faces.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // The picker did not unmount its host (no duplicate-id index crash)…
    expect(container.querySelector('input[placeholder="Search fonts…"]')).not.toBeNull();
    // …and the installed face plus catalog entries are listed.
    expect(container.textContent).toContain('Bangers');
    expect(container.textContent).toContain('Comic Neue');
  });
});
