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
}

// F is deliberately the only page-level shortcut. Space must retain page scrolling.
const TOGGLE_ORIGINAL_KEY = 'f';
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Detects form controls and editable ancestors, crossing shadow-root host boundaries.
 * @param target - A node from the keyboard event's composed path.
 * @returns Whether typing at this node must remain owned by the page.
 */
function isEditableTarget(target: EventTarget | null): boolean {
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
 * Toggles only a ready, hovered, translated image using the existing display callback.
 * @param event - Page keydown event; untouched when no action is possible.
 * @param actions - Live state and existing content translation/display callbacks.
 * @returns Whether the event performed an image toggle.
 */
export function handleReadingKeydown<T>(event: KeyboardEvent, actions: ReadingShortcutActions<T>): boolean {
  if (!matchesReadingToggle(event)) return false;
  const { enabled, busy, target } = actions.getContext();
  if (!enabled || busy || target === null || !actions.hasTranslation(target)) return false;
  actions.toggleOriginal(target);
  event.preventDefault();
  return true;
}

/**
 * Dispatches extension commands through existing content actions, not a new pipeline.
 * @param message - Runtime message received by the content listener.
 * @param actions - Live state, target resolution, and existing action callbacks.
 * @returns Whether a recognized command was received (even when safely ignored).
 */
export function handleReadingCommand<T>(message: unknown, actions: ReadingShortcutActions<T>): boolean {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  if (message.type !== 'TRANSLATE_HOVERED_IMAGE' && message.type !== 'START_AREA_SELECTION') return false;
  const { enabled, busy, target } = actions.getContext();
  if (!enabled || busy) return true;
  if (message.type === 'START_AREA_SELECTION') actions.startAreaSelection();
  else if (target !== null) actions.translate(target);
  return true;
}
