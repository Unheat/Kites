import { useId, useState, useMemo } from 'react';
import { Keyboard, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Describes one keyboard shortcut for display in the help panel.
 * @property keys - Readable key combo, e.g. "Ctrl / Alt + Shift + Z".
 * @property label - Short purpose description for the end user.
 * @property note - Optional extra context shown below the label.
 */
export interface ShortcutEntry {
  keys: string;
  label: string;
  note?: string;
}

/**
 * Builds reading shortcuts tailored to the operating system (macOS vs Windows/Linux).
 * @returns Array of shortcut entries with platform-aware key labels.
 */
export function getPlatformShortcuts(): ShortcutEntry[] {
  const isMac = typeof navigator !== 'undefined' &&
    Boolean(navigator.userAgent?.includes('Mac') || navigator.platform?.includes('Mac'));

  const mod = isMac ? '⌃ / ⌥ + ⇧' : 'Ctrl / Alt + Shift';

  return [
    {
      keys: `${mod} + Z`,
      label: 'Translate hovered image',
      note: 'Hover a manga panel, press the shortcut to queue it.',
    },
    {
      keys: `${mod} + X`,
      label: 'Screen crop selection',
      note: 'Draw a rectangle on screen to capture and translate.',
    },
    {
      keys: `${mod} + M`,
      label: 'Open Chapter Reader',
      note: 'Launch fullscreen distraction-free reader for translated pages.',
    },
    {
      keys: 'F',
      label: 'Toggle original / translated',
      note: 'Only active when hovering a translated image. Ignored inside text fields.',
    },
  ];
}

/**
 * Collapsible keyboard-shortcut reference card for the popup settings view.
 *
 * @returns A disclosure panel listing every reading shortcut with key combos.
 */
export default function ReadingShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const shortcuts = useMemo(() => getPlatformShortcuts(), []);

  return (
    <div className="pt-2 border-t border-[var(--color-dust)] border-opacity-30">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Keyboard size={16} className="text-[var(--color-dust)]" />
          <span className="font-medium text-sm">Keyboard Shortcuts</span>
        </div>
        {open
          ? <ChevronUp size={14} className="text-[var(--color-dust)]" />
          : <ChevronDown size={14} className="text-[var(--color-dust)]" />}
      </button>

      <div id={panelId} hidden={!open} className={open ? 'mt-2 flex flex-col gap-2' : undefined}>
        {shortcuts.map(({ keys, label, note }) => (
          <div
            key={keys}
            className="flex items-start gap-3 p-2 rounded bg-[var(--color-vellum)] border border-[var(--color-dust)] border-opacity-40"
          >
            <kbd className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-[var(--color-ink)] text-[var(--color-paper)] whitespace-nowrap">
              {keys}
            </kbd>
            <div className="min-w-0">
              <span className="text-sm font-medium">{label}</span>
              {note && <p className="text-[11px] text-[var(--color-dust)] mt-0.5">{note}</p>}
            </div>
          </div>
        ))}

        <p className="text-[10px] text-[var(--color-dust)] px-1 leading-relaxed">
          Action shortcuts work in-page with both Ctrl and Alt/Option. Global browser shortcuts can be customized at{' '}
          <span className="font-mono text-[var(--color-ink)]">chrome://extensions/shortcuts</span>.
          {' '}The unmodified F key is fixed.
        </p>
      </div>
    </div>
  );
}
