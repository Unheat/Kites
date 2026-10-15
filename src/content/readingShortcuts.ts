/** State is read at dispatch time so React listeners never act on stale render state. */
export interface ReadingShortcutContext<T> {
  enabled: boolean;
  busy: boolean;
  target: T | null;
}

export interface ReadingShortcutActions<T> {
  getContext: () => ReadingShortcutContext<T>;
  hasTranslation: (target: T) => boolean;
  toggleOriginal: (target: T) => void;
  translate: (target: T) => void;
  startAreaSelection: () => void;
  repeatLastScreenCrop?: () => void;
  openChapterReader?: () => void;
}

// F is deliberately the only page-level shortcut. Space must retain page scrolling.
const TOGGLE_ORIGINAL_KEY = 'f';
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

let lastToggleDownTime = 0;
let isHoldPeeking = false;

/**
 * Detects form controls and editable ancestors, crossing shadow-root host boundaries.
 * @param target - A node from the keyboard event's composed path.
 * @returns Whether typing at this node must remain owned by the page.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  let node = target instanceof Node ? target : null;
  while (node) {
    if (node instanceof Element) {
      const editable = node.getAttribute('contenteditable');
      if (EDITABLE_TAGS.has(node.tagName) ||
          (editable !== null && editable.toLowerCase() !== 'false') ||
          (node instanceof HTMLElement && node.isContentEditable)) return true;
    }
    const root = node.getRootNode();
    node = node.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

/**
 * Matches a single unmodified F press outside editable composed-path ancestors.
 * @param event - Page keydown event, including any cancellation by page listeners.
 * @returns True only when this event may toggle an already-translated hovered image.
 */
export function matchesReadingToggle(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === TOGGLE_ORIGINAL_KEY &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    !event.repeat && !event.defaultPrevented && !event.isComposing &&
    ![event.target, ...event.composedPath()].some(isEditableTarget);
}

/**
 * Matches action shortcut modifiers: Alt+Shift or Ctrl+Shift (excluding Meta/Command to avoid OS/browser conflicts).
 * Guarded against editable elements, IME composition, key repetition, and canceled events.
 * @param event - Page keydown event.
 * @returns Whether the event carries valid action modifiers outside editable inputs.
 */
export function matchesActionModifier(event: KeyboardEvent): boolean {
  const hasModifier = (event.altKey || event.ctrlKey) && event.shiftKey && !event.metaKey;
  return hasModifier &&
    !event.repeat &&
    !event.defaultPrevented &&
    !event.isComposing &&
    ![event.target, ...event.composedPath()].some(isEditableTarget);
}

/**
 * Handles in-page keyboard shortcuts:
 * - Unmodified 'F': toggles original/translated view for the hovered translated image.
 * - Ctrl/Alt + Shift + Z: translates the hovered image.
 * - Ctrl/Alt + Shift + X: starts screen crop area selection.
 * - Ctrl/Alt + Shift + M: opens distraction-free chapter reader.
 *
 * @param event - Page keydown event; untouched when no action is possible.
 * @param actions - Live state and content action callbacks.
 * @returns Whether the event matched and executed an action.
 */
export function handleReadingKeydown<T>(event: KeyboardEvent, actions: ReadingShortcutActions<T>): boolean {
  if (matchesReadingToggle(event)) {
    const { enabled, busy, target } = actions.getContext();
    if (!enabled || busy || target === null || !actions.hasTranslation(target)) return false;
    lastToggleDownTime = Date.now();
    isHoldPeeking = true;
    actions.toggleOriginal(target);
    event.preventDefault();
    return true;
  }

  if (matchesActionModifier(event)) {
    const { enabled, busy, target } = actions.getContext();
    if (!enabled || busy) return false;

    // Translate hovered image or toggle view if already translated (KeyZ)
    if (event.code === 'KeyZ' || event.key.toLowerCase() === 'z') {
      if (target === null) return false;
      if (actions.hasTranslation(target)) {
        lastToggleDownTime = Date.now();
        isHoldPeeking = true;
        actions.toggleOriginal(target);
      } else {
        actions.translate(target);
      }
      event.preventDefault();
      return true;
    }

    // Screen crop selection (KeyX)
    if (event.code === 'KeyX' || event.key.toLowerCase() === 'x') {
      actions.startAreaSelection();
      event.preventDefault();
      return true;
    }

    // Repeat last screen crop (KeyC)
    if (event.code === 'KeyC' || event.key.toLowerCase() === 'c') {
      if (actions.repeatLastScreenCrop) {
        actions.repeatLastScreenCrop();
        event.preventDefault();
        return true;
      }
    }

    // Open chapter reader (KeyM)
    if (event.code === 'KeyM' || event.key.toLowerCase() === 'm') {
      if (!actions.openChapterReader) return false;
      actions.openChapterReader();
      event.preventDefault();
      return true;
    }
  }

  return false;
}

/**
 * Handles keyup events to support "Hold-to-Peek" original image:
 * If user held the toggle key (F or Alt+Shift+Z) for > 200ms, releasing it reverts to the translated view.
 * If tapped (< 200ms), the toggle remains permanent.
 */
export function handleReadingKeyup<T>(event: KeyboardEvent, actions: ReadingShortcutActions<T>): boolean {
  if (isHoldPeeking) {
    const isF = event.key.toLowerCase() === TOGGLE_ORIGINAL_KEY;
    const isZ = event.code === 'KeyZ' || event.key.toLowerCase() === 'z';
    if (isF || isZ) {
      isHoldPeeking = false;
      const holdDuration = Date.now() - lastToggleDownTime;
      if (holdDuration > 200) {
        const { enabled, target } = actions.getContext();
        if (enabled && target && actions.hasTranslation(target)) {
          actions.toggleOriginal(target);
          event.preventDefault();
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Dispatches extension commands through existing content actions, not a new pipeline.
 * @param message - Runtime message received by the content listener.
 * @param actions - Live state, target resolution, and existing action callbacks.
 * @returns Whether a recognized command was received (even when safely ignored).
 */
export function handleReadingCommand<T>(message: unknown, actions: ReadingShortcutActions<T>): boolean {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  if (
    message.type !== 'TRANSLATE_HOVERED_IMAGE' &&
    message.type !== 'START_AREA_SELECTION' &&
    message.type !== 'REPEAT_SCREEN_CROP' &&
    message.type !== 'OPEN_CHAPTER_READER'
  ) return false;
  const { enabled, busy, target } = actions.getContext();
  if (!enabled || busy) return true;
  if (message.type === 'START_AREA_SELECTION') actions.startAreaSelection();
  else if (message.type === 'REPEAT_SCREEN_CROP') actions.repeatLastScreenCrop?.();
  else if (message.type === 'OPEN_CHAPTER_READER') actions.openChapterReader?.();
  else if (target !== null) {
    if (actions.hasTranslation(target)) {
      actions.toggleOriginal(target);
    } else {
      actions.translate(target);
    }
  }
  return true;
}
