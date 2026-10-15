// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleReadingCommand,
  handleReadingKeydown,
  handleReadingKeyup,
  matchesActionModifier,
  matchesReadingToggle,
  type ReadingShortcutActions,
} from './readingShortcuts';

/**
 * Builds live-state action spies for a hovered translated image.
 * @param overrides - Optional action/state replacements for negative-path tests.
 * @returns Independently spyable shortcut actions.
 */
function createActions(overrides: Partial<ReadingShortcutActions<string>> = {}): ReadingShortcutActions<string> {
  return {
    getContext: vi.fn(() => ({ enabled: true, busy: false, target: 'page.png' })),
    hasTranslation: vi.fn(() => false),
    toggleOriginal: vi.fn(),
    translate: vi.fn(),
    startAreaSelection: vi.fn(),
    repeatLastScreenCrop: vi.fn(),
    openChapterReader: vi.fn(),
    ...overrides,
  };
}

/**
 * Dispatches a real keyboard event so target/composedPath match browser event semantics.
 * @param target - Page element receiving the key event.
 * @param init - Event key/modifier/cancellation options.
 * @returns Whether the event matched while its composed path was available.
 */
function matchAt(target: Element, init: KeyboardEventInit = {}): boolean {
  let matches = false;
  target.addEventListener('keydown', (event) => { matches = matchesReadingToggle(event as KeyboardEvent); }, { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, composed: true, cancelable: true, ...init }));
  return matches;
}

beforeEach(() => { document.body.replaceChildren(); });

describe('reading toggle matching', () => {
  it.each(['f', 'F'])('accepts unmodified %s (including Caps Lock)', (key) => {
    expect(matchAt(document.body, { key })).toBe(true);
  });

  it.each([' ', 'Space', 'g', 'Escape', 'Dead'])('leaves %s to the page', (key) => {
    expect(matchAt(document.body, { key })).toBe(false);
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'repeat', 'isComposing'] as const)('ignores %s', (flag) => {
    expect(matchAt(document.body, { [flag]: true })).toBe(false);
  });

  it('respects defaultPrevented', () => {
    const event = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    event.preventDefault();
    expect(matchesReadingToggle(event)).toBe(false);
  });

  it.each(['input', 'textarea', 'select'])('ignores %s and descendants', (tag) => {
    const control = document.createElement(tag);
    const child = document.createElement('span');
    control.append(child);
    document.body.append(control);
    expect(matchAt(control)).toBe(false);
    expect(matchAt(child)).toBe(false);
  });

  it.each(['', 'true', 'plaintext-only'])('ignores contenteditable=%s ancestors', (value) => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', value);
    const child = document.createElement('span');
    editor.append(child);
    document.body.append(editor);
    expect(matchAt(child)).toBe(false);
  });

  it('does not classify standalone contenteditable=false as editable', () => {
    const element = document.createElement('div');
    element.setAttribute('contenteditable', 'false');
    document.body.append(element);
    expect(matchAt(element)).toBe(true);
  });

  it('ignores contenteditable=false descendants inside an editor', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    child.setAttribute('contenteditable', 'false');
    editor.append(child);
    document.body.append(editor);
    expect(matchAt(child)).toBe(false);
  });

  it('checks composedPath when shadow input retargets to a noneditable host', () => {
    const host = document.createElement('div');
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    document.body.append(host);
    let matches = true;
    document.addEventListener('keydown', (event) => {
      expect(event.target).toBe(host);
      matches = matchesReadingToggle(event);
    }, { once: true });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, composed: true }));
    expect(matches).toBe(false);
  });

  it('walks shadow hosts to editable ancestors', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const host = document.createElement('div');
    const child = document.createElement('span');
    host.attachShadow({ mode: 'open' }).append(child);
    editor.append(host);
    document.body.append(editor);
    expect(matchAt(child)).toBe(false);
  });
});

describe('reading key dispatch', () => {
  it('toggles a translated target once and consumes only that successful event', () => {
    const actions = createActions({ hasTranslation: () => true });
    const event = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.toggleOriginal).toHaveBeenCalledExactlyOnceWith('page.png');
    expect(event.defaultPrevented).toBe(true);
    expect(handleReadingKeydown(event, actions)).toBe(false);
    expect(actions.translate).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: false, busy: false, target: 'page.png' },
    { enabled: true, busy: true, target: 'page.png' },
    { enabled: true, busy: false, target: null },
  ])('leaves event untouched for blocked state %j', (context) => {
    const actions = createActions({ hasTranslation: () => true, getContext: () => context });
    const event = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(false);
    expect(actions.toggleOriginal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not toggle or translate an original image without a translated record', () => {
    const actions = createActions({ hasTranslation: () => false });
    const event = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(false);
    expect(actions.toggleOriginal).not.toHaveBeenCalled();
    expect(actions.translate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('reads current state on every invocation', () => {
    let enabled = true;
    const actions = createActions({ hasTranslation: () => true, getContext: () => ({ enabled, busy: false, target: 'page.png' }) });
    expect(handleReadingKeydown(new KeyboardEvent('keydown', { key: 'f' }), actions)).toBe(true);
    enabled = false;
    expect(handleReadingKeydown(new KeyboardEvent('keydown', { key: 'f' }), actions)).toBe(false);
    expect(actions.toggleOriginal).toHaveBeenCalledTimes(1);
  });
});

describe('action shortcut modifier matching', () => {
  it.each([
    { altKey: true, shiftKey: true },
    { ctrlKey: true, shiftKey: true },
  ])('accepts valid modifier combos %j', (flags) => {
    const event = new KeyboardEvent('keydown', { ...flags, code: 'KeyZ' });
    expect(matchesActionModifier(event)).toBe(true);
  });

  it.each([
    { altKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { metaKey: true, shiftKey: true },
    { metaKey: true, altKey: true, shiftKey: true },
    { repeat: true, altKey: true, shiftKey: true },
    { isComposing: true, altKey: true, shiftKey: true },
  ])('rejects invalid or conflicting combos %j', (flags) => {
    const event = new KeyboardEvent('keydown', { ...flags, code: 'KeyZ' });
    expect(matchesActionModifier(event)).toBe(false);
  });

  it('rejects action modifiers inside editable inputs', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    let matched = true;
    input.addEventListener('keydown', (event) => {
      matched = matchesActionModifier(event as KeyboardEvent);
    });
    input.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyZ', bubbles: true }));
    expect(matched).toBe(false);
  });
});

describe('action keydown dispatch', () => {
  it.each([
    { altKey: true, shiftKey: true },
    { ctrlKey: true, shiftKey: true },
  ])('dispatches translation on KeyZ with %j', (modifiers) => {
    const actions = createActions();
    const event = new KeyboardEvent('keydown', { ...modifiers, code: 'KeyZ', key: 'Z', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.translate).toHaveBeenCalledExactlyOnceWith('page.png');
    expect(event.defaultPrevented).toBe(true);
  });

  it('handles macOS Option+Shift+Z typographic glyph substitution', () => {
    const actions = createActions();
    // On macOS, Option+Shift+Z outputs '¸' as event.key, but event.code remains 'KeyZ'
    const event = new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyZ', key: '¸', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.translate).toHaveBeenCalledExactlyOnceWith('page.png');
    expect(event.defaultPrevented).toBe(true);
  });

  it('toggles original view on KeyZ when target is already translated (dual-action)', () => {
    const actions = createActions({ hasTranslation: () => true });
    const event = new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyZ', key: 'Z', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.toggleOriginal).toHaveBeenCalledExactlyOnceWith('page.png');
    expect(actions.translate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('dispatches repeatLastScreenCrop on KeyC', () => {
    const actions = createActions();
    const event = new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyC', key: 'C', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.repeatLastScreenCrop).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('handles hold-to-peek keyup reversion after prolonged hold', () => {
    const actions = createActions({ hasTranslation: () => true });
    // Simulate keydown
    const downEvent = new KeyboardEvent('keydown', { key: 'f', cancelable: true });
    handleReadingKeydown(downEvent, actions);
    expect(actions.toggleOriginal).toHaveBeenCalledTimes(1);

    // Fast-forward 300ms
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300);

    // Simulate keyup
    const upEvent = new KeyboardEvent('keyup', { key: 'f', cancelable: true });
    expect(handleReadingKeyup(upEvent, actions)).toBe(true);
    // Toggled back to restore translated view
    expect(actions.toggleOriginal).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it('dispatches startAreaSelection on KeyX', () => {
    const actions = createActions();
    const event = new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyX', key: 'X', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.startAreaSelection).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('dispatches openChapterReader on KeyM', () => {
    const actions = createActions();
    const event = new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, code: 'KeyM', key: 'M', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(true);
    expect(actions.openChapterReader).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores KeyZ when no image is hovered', () => {
    const actions = createActions({ getContext: () => ({ enabled: true, busy: false, target: null }) });
    const event = new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyZ', cancelable: true });
    expect(handleReadingKeydown(event, actions)).toBe(false);
    expect(actions.translate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores action shortcuts when disabled or busy', () => {
    for (const context of [
      { enabled: false, busy: false, target: 'page.png' },
      { enabled: true, busy: true, target: 'page.png' },
    ]) {
      const actions = createActions({ getContext: () => context });
      const event = new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyX', cancelable: true });
      expect(handleReadingKeydown(event, actions)).toBe(false);
      expect(actions.startAreaSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    }
  });
});

describe('content reading command dispatch', () => {
  it('reuses injected translation callback', () => {
    const actions = createActions();
    expect(handleReadingCommand({ type: 'TRANSLATE_HOVERED_IMAGE' }, actions)).toBe(true);
    expect(actions.translate).toHaveBeenCalledExactlyOnceWith('page.png');
    expect(actions.toggleOriginal).not.toHaveBeenCalled();
  });

  it('dispatches REPEAT_SCREEN_CROP command', () => {
    const actions = createActions();
    expect(handleReadingCommand({ type: 'REPEAT_SCREEN_CROP' }, actions)).toBe(true);
    expect(actions.repeatLastScreenCrop).toHaveBeenCalledOnce();
  });

  it('toggles original on TRANSLATE_HOVERED_IMAGE when target already translated', () => {
    const actions = createActions({ hasTranslation: () => true });
    expect(handleReadingCommand({ type: 'TRANSLATE_HOVERED_IMAGE' }, actions)).toBe(true);
    expect(actions.toggleOriginal).toHaveBeenCalledExactlyOnceWith('page.png');
    expect(actions.translate).not.toHaveBeenCalled();
  });

  it('uses the existing START_AREA_SELECTION message, even without an image', () => {
    const actions = createActions({ getContext: () => ({ enabled: true, busy: false, target: null }) });
    expect(handleReadingCommand({ type: 'START_AREA_SELECTION' }, actions)).toBe(true);
    expect(actions.startAreaSelection).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { type: 'START_SCREEN_CROP' }, { type: 'IMAGE_TRANSLATED' }, 'TRANSLATE_HOVERED_IMAGE'])('ignores unknown messages %j', (message) => {
    const actions = createActions();
    expect(handleReadingCommand(message, actions)).toBe(false);
    expect(actions.getContext).not.toHaveBeenCalled();
  });

  it.each(['TRANSLATE_HOVERED_IMAGE', 'START_AREA_SELECTION'])('blocks %s while disabled or busy', (type) => {
    for (const context of [
      { enabled: false, busy: false, target: 'page.png' },
      { enabled: true, busy: true, target: 'page.png' },
    ]) {
      const actions = createActions({ getContext: () => context });
      expect(handleReadingCommand({ type }, actions)).toBe(true);
      expect(actions.translate).not.toHaveBeenCalled();
      expect(actions.startAreaSelection).not.toHaveBeenCalled();
    }
  });

  it('ignores translate command without a hovered target', () => {
    const actions = createActions({ getContext: () => ({ enabled: true, busy: false, target: null }) });
    handleReadingCommand({ type: 'TRANSLATE_HOVERED_IMAGE' }, actions);
    expect(actions.translate).not.toHaveBeenCalled();
  });
});
