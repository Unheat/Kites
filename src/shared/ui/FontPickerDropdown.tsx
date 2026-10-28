import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, Search, Trash2, Upload } from 'lucide-react';
import MiniSearch from 'minisearch';
import { RENDER_FONT_PRESETS } from '../renderFontPresets';
import { FONT_CATALOG, type FontCatalogEntry } from '../fontCatalog';
import {
  deleteFont,
  downloadCatalogFont,
  importFontFile,
  listLibrary,
  type InstalledFont,
} from '../fontLibrary';

/** A font chosen in the picker: a registered preset, or a library family. */
export type FontSelection =
  | { type: 'preset'; presetId: string }
  | { type: 'family'; family: string };

interface PickerItem {
  key: string;
  label: string;
  family: string;
  kind: 'preset' | 'installed' | 'catalog';
  presetId?: string;
  catalog?: FontCatalogEntry;
  installed?: InstalledFont;
  sizeBytes?: number;
}

interface FontPickerDropdownProps {
  /** Current selection (drives the trigger label and check marks). */
  selection: FontSelection;
  /** Selection change callback; hosts map it to their own state shape. */
  onSelect: (selection: FontSelection) => void;
  /** Visual system to use. */
  variant: 'popup' | 'studio';
  /** Accessible label for the trigger. */
  ariaLabel?: string;
}

const TRIGGER_CLASS: Record<FontPickerDropdownProps['variant'], string> = {
  popup: 'w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer',
  studio: 'w-full flex items-center justify-between px-2.5 py-1.5 bg-[#090a0f] border border-[#282d3f] rounded-lg hover:border-slate-500 transition-colors cursor-pointer',
};

const PANEL_CLASS: Record<FontPickerDropdownProps['variant'], string> = {
  popup: 'mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden z-50',
  studio: 'mt-1 bg-[#0b0d14] border border-[#282d3f] rounded-lg shadow-lg overflow-hidden z-50',
};

const ROW_CLASS: Record<FontPickerDropdownProps['variant'], string> = {
  popup: 'w-full flex items-center justify-between p-2 text-left rounded-sm transition-colors hover:bg-[var(--color-vellum)] cursor-pointer',
  studio: 'w-full flex items-center justify-between px-2 py-1.5 text-left rounded-sm transition-colors hover:bg-[#141824] cursor-pointer',
};

const ACTIVE_ROW_CLASS: Record<FontPickerDropdownProps['variant'], string> = {
  popup: 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold',
  studio: 'bg-[#141824] text-[#f4446d] font-semibold',
};

const SECTION_LABEL_CLASS: Record<FontPickerDropdownProps['variant'], string> = {
  popup: 'px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-[var(--color-dust)]',
  studio: 'px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-slate-500',
};

/** @param stack - CSS font-family stack. @returns First family token, de-quoted, for display. */
function displayFamily(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? stack;
  return first.replace(/^['"]|['"]$/g, '') || stack;
}

/**
 * Shared searchable font picker (popup + Studio): presets, on-demand catalog
 * downloads with pinned-hash verification, persisted user imports, and search.
 * Library faces register in the current document so previews are live.
 */
export const FontPickerDropdown: React.FC<FontPickerDropdownProps> = ({ selection, onSelect, variant, ariaLabel }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [installed, setInstalled] = useState<InstalledFont[]>([]);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(() => {
    void listLibrary().then(({ installed: installedFonts }) => setInstalled(installedFonts)).catch((err) => {
      console.warn('[FontPicker] Failed to list font library:', err);
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      refresh();
    }
  }, [isOpen, refresh]);

  const items = useMemo<PickerItem[]>(() => {
    const list: PickerItem[] = RENDER_FONT_PRESETS.map((preset) => ({
      key: `preset:${preset.id}`,
      label: preset.label,
      family: displayFamily(preset.fontFamily),
      kind: 'preset' as const,
      presetId: preset.id,
    }));
    for (const font of installed) {
      list.push({ key: `installed:${font.id}`, label: font.label, family: font.family, kind: 'installed', installed: font });
    }
    const installedFamilies = new Set(installed.map((f) => f.family));
    for (const entry of FONT_CATALOG) {
      if (!installedFamilies.has(entry.family)) {
        list.push({ key: `catalog:${entry.id}`, label: entry.label, family: entry.family, kind: 'catalog', catalog: entry, sizeBytes: entry.sizeBytes });
      }
    }
    return list;
  }, [installed]);

  const searchIndex = useMemo(() => new MiniSearch({
    idField: 'key',
    fields: ['label', 'family'],
    storeFields: ['key'],
    searchOptions: { fuzzy: 0.2, prefix: true },
  }), []);

  useEffect(() => {
    searchIndex.addAll(items.map((item) => ({ ...item })));
  }, [items, searchIndex]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const hits = new Set(searchIndex.search(searchQuery).map((hit) => String(hit.key)));
    return items.filter((item) => hits.has(item.key));
  }, [items, searchQuery, searchIndex]);

  const grouped = useMemo(() => ({
    presets: filtered.filter((item) => item.kind === 'preset'),
    installed: filtered.filter((item) => item.kind === 'installed'),
    catalog: filtered.filter((item) => item.kind === 'catalog'),
  }), [filtered]);

  const isSelected = (item: PickerItem): boolean => {
    if (selection.type === 'preset') return item.kind === 'preset' && item.presetId === selection.presetId;
    return item.kind !== 'preset' && item.family === selection.family;
  };

  const handleDownload = async (entry: FontCatalogEntry): Promise<void> => {
    setDownloading((prev) => new Set(prev).add(entry.id));
    setError(null);
    try {
      await downloadCatalogFont(entry);
      refresh();
      onSelect({ type: 'family', family: entry.family });
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const handleImport = async (file: File): Promise<void> => {
    setError(null);
    try {
      const installedFont = await importFontFile(file);
      refresh();
      onSelect({ type: 'family', family: installedFont.family });
    } catch (err: any) {
      setError(`Could not load that file as a font: ${err?.message || String(err)}`);
    }
  };

  const handleDelete = async (font: InstalledFont): Promise<void> => {
    await deleteFont(font.id);
    refresh();
  };

  const triggerLabel = selection.type === 'preset'
    ? RENDER_FONT_PRESETS.find((preset) => preset.id === selection.presetId)?.label ?? selection.presetId
    : selection.family;

  const triggerFamily = selection.type === 'preset'
    ? RENDER_FONT_PRESETS.find((preset) => preset.id === selection.presetId)?.fontFamily ?? 'sans-serif'
    : selection.family;

  const rowClass = (active: boolean): string =>
    `${ROW_CLASS[variant]} ${active ? ACTIVE_ROW_CLASS[variant] : ''}`;

  const renderRow = (item: PickerItem) => {
    const active = isSelected(item);
    return (
      <button
        key={item.key}
        onClick={() => {
          if (item.kind === 'preset' && item.presetId) {
            onSelect({ type: 'preset', presetId: item.presetId });
          } else {
            onSelect({ type: 'family', family: item.family });
          }
          setIsOpen(false);
        }}
        className={rowClass(active)}
      >
        <div className="flex flex-col overflow-hidden">
          <span className={`truncate pr-2 text-sm ${variant === 'studio' ? 'text-slate-200' : ''}`} style={{ fontFamily: item.kind === 'preset' && item.presetId
            ? RENDER_FONT_PRESETS.find((preset) => preset.id === item.presetId)?.fontFamily
            : `"${item.family}", sans-serif` }}>
            {item.label}
          </span>
          {item.kind === 'catalog' && item.sizeBytes !== undefined && (
            <span className={`text-[11px] truncate ${variant === 'studio' ? 'text-slate-500' : 'text-[var(--color-dust)]'}`}>
              {Math.max(1, Math.round(item.sizeBytes / 1024))} KB · {item.catalog?.license}
            </span>
          )}
          {item.kind === 'installed' && item.installed?.source === 'import' && (
            <span className={`text-[11px] truncate ${variant === 'studio' ? 'text-slate-500' : 'text-[var(--color-dust)]'}`}>
              Imported · renders on this machine
            </span>
          )}
        </div>
        <div className="flex-shrink-0 ml-2 flex items-center gap-1">
          {item.kind === 'installed' && item.installed && (
            <span
              role="button"
              aria-label={`Remove ${item.label}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete(item.installed!);
              }}
              className={`p-1 rounded-sm hover:text-[var(--color-editorial)] ${variant === 'studio' ? 'text-slate-500 hover:text-[#f4446d]' : 'text-[var(--color-dust)]'}`}
            >
              <Trash2 size={13} />
            </span>
          )}
          {active ? <Check size={14} className="text-[var(--color-editorial)]" /> : null}
        </div>
      </button>
    );
  };

  return (
    <div className="relative flex flex-col">
      <button
        aria-label={ariaLabel ?? 'Font'}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={TRIGGER_CLASS[variant]}
      >
        <span className={`font-medium truncate pr-2 text-sm ${variant === 'studio' ? 'text-slate-200' : ''}`} style={{ fontFamily: triggerFamily }}>
          {triggerLabel}
        </span>
        <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className={PANEL_CLASS[variant]}>
          <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b ${variant === 'studio' ? 'border-[#282d3f]' : 'border-[var(--color-dust)]'}`}>
            <Search size={13} className={variant === 'studio' ? 'text-slate-500' : 'text-[var(--color-dust)]'} />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search fonts…"
              className={`w-full bg-transparent text-sm focus:outline-hidden ${variant === 'studio' ? 'text-slate-200 placeholder:text-slate-600' : ''}`}
            />
          </div>

          <div className="overflow-y-auto flex-1 p-1 custom-scrollbar max-h-[300px]">
            {error && (
              <p className={`px-2 py-1 text-[11px] ${variant === 'studio' ? 'text-[#f4446d]' : 'text-[var(--color-editorial)]'}`}>{error}</p>
            )}

            {grouped.presets.length > 0 && (
              <>
                <p className={SECTION_LABEL_CLASS[variant]}>Presets</p>
                {grouped.presets.map(renderRow)}
              </>
            )}
            {grouped.installed.length > 0 && (
              <>
                <p className={SECTION_LABEL_CLASS[variant]}>Installed</p>
                {grouped.installed.map(renderRow)}
              </>
            )}
            {grouped.catalog.length > 0 && (
              <>
                <p className={SECTION_LABEL_CLASS[variant]}>Available to download</p>
                {grouped.catalog.map((item) => (
                  <div key={item.key} className={`${ROW_CLASS[variant]} ${item.family === (selection.type === 'family' ? selection.family : '') ? ACTIVE_ROW_CLASS[variant] : ''}`}>
                    <div className="flex flex-col overflow-hidden">
                      <span className={`truncate pr-2 text-sm ${variant === 'studio' ? 'text-slate-200' : ''}`} style={{ fontFamily: `"${item.family}", sans-serif` }}>
                        {item.label}
                      </span>
                      <span className={`text-[11px] truncate ${variant === 'studio' ? 'text-slate-500' : 'text-[var(--color-dust)]'}`}>
                        {Math.max(1, Math.round((item.sizeBytes ?? 0) / 1024))} KB · {item.catalog?.license}
                      </span>
                    </div>
                    <button
                      aria-label={`Download ${item.label}`}
                      disabled={downloading.has(item.catalog?.id ?? '')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.catalog) void handleDownload(item.catalog);
                      }}
                      className={`p-1.5 rounded-sm ${variant === 'studio' ? 'text-slate-400 hover:text-[#f4446d]' : 'text-[var(--color-dust)] hover:text-[var(--color-editorial)]'} disabled:opacity-40`}
                    >
                      <Download size={14} className={downloading.has(item.catalog?.id ?? '') ? 'animate-pulse' : ''} />
                    </button>
                  </div>
                ))}
              </>
            )}
            {filtered.length === 0 && (
              <p className={`px-2 py-2 text-xs ${variant === 'studio' ? 'text-slate-500' : 'text-[var(--color-dust)]'}`}>No fonts match “{searchQuery}”.</p>
            )}
          </div>

          <div className={`border-t ${variant === 'studio' ? 'border-[#282d3f]' : 'border-[var(--color-dust)]'}`}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={rowClass(false)}
            >
              <div className="flex items-center gap-2">
                <Upload size={14} className={variant === 'studio' ? 'text-slate-400' : 'text-[var(--color-dust)]'} />
                <span className={`text-sm ${variant === 'studio' ? 'text-slate-300' : ''}`}>Import font file…</span>
              </div>
              <span className={`text-[11px] ${variant === 'studio' ? 'text-slate-500' : 'text-[var(--color-dust)]'}`}>.ttf .otf .woff</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
