import { afterEach, describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import GlossaryPanel from './GlossaryPanel';
import { MAX_GLOSSARY_ENTRIES, MAX_GLOSSARY_TERM_LENGTH } from '../../shared/glossary';

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((root) => root.unmount()); });
  document.body.replaceChildren();
});

describe('GlossaryPanel', () => {
  it('renders glossary toggle and list of entries', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <GlossaryPanel
          glossaryEnabled={true}
          glossaryEntries={[{ source: '先輩', target: 'Senpai' }]}
          updateState={updateState}
          onClose={onClose}
        />
      );
    });

    expect(container.textContent).toContain('Translation Glossary');
    expect(container.textContent).toContain('先輩');
    expect(container.textContent).toContain('Senpai');
    expect(container.textContent).toContain('Google Translate does not support glossary');
    expect(container.textContent).toContain('Do not add sensitive data');

    // Toggle switch test
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      checkbox.click();
    });
    expect(updateState).toHaveBeenCalledWith({ glossaryEnabled: false });

    // Close button test
    const closeBtn = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a new valid entry on button click', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();

    await act(async () => {
      root.render(
        <GlossaryPanel
          glossaryEnabled={false}
          glossaryEntries={[]}
          updateState={updateState}
          onClose={vi.fn()}
        />
      );
    });

    const inputs = container.querySelectorAll('input[type="text"]');
    const sourceInput = inputs[0] as HTMLInputElement;
    const targetInput = inputs[1] as HTMLInputElement;
    const addBtn = container.querySelector('button[title="Add glossary entry"]') as HTMLButtonElement;

    expect(addBtn.disabled).toBe(true);

    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await act(async () => {
      setInputValue(sourceInput, '先生');
      setInputValue(targetInput, 'Sensei');
    });

    expect(addBtn.disabled).toBe(false);

    await act(async () => {
      addBtn.click();
    });

    expect(updateState).toHaveBeenCalledWith({
      glossaryEntries: [{ source: '先生', target: 'Sensei' }],
    });
  });

  it('enforces entry capacity and input limits with accessible controls', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    await act(async () => {
      root.render(<GlossaryPanel glossaryEnabled={true} glossaryEntries={Array.from({ length: MAX_GLOSSARY_ENTRIES }, (_, i) => ({ source: `Name${i}`, target: `Target${i}` }))} updateState={updateState} onClose={vi.fn()} />);
    });
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Source"]')?.maxLength).toBe(MAX_GLOSSARY_TERM_LENGTH);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Preferred"]')?.maxLength).toBe(MAX_GLOSSARY_TERM_LENGTH);
    const add = container.querySelector<HTMLButtonElement>(`button[title="Maximum ${MAX_GLOSSARY_ENTRIES} entries reached"]`)!;
    expect(add.disabled).toBe(true);
    await act(async () => add.click());
    expect(updateState).not.toHaveBeenCalled();
  });

  it('removes an entry when trash button clicked', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();

    await act(async () => {
      root.render(
        <GlossaryPanel
          glossaryEnabled={true}
          glossaryEntries={[
            { source: 'A', target: '1' },
            { source: 'B', target: '2' },
          ]}
          updateState={updateState}
          onClose={vi.fn()}
        />
      );
    });

    const trashButtons = container.querySelectorAll('button[title="Remove entry"]');
    expect(trashButtons.length).toBe(2);

    await act(async () => {
      (trashButtons[0] as HTMLButtonElement).click();
    });

    expect(updateState).toHaveBeenCalledWith({
      glossaryEntries: [{ source: 'B', target: '2' }],
    });
  });
});
