import React, { useState, useEffect } from 'react';
import {
  Info,
  Cpu,
  Layers,
  Type,
  Copy,
  Check,
  CheckCircle2,
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db, type TranslationJob, type ImageRecord, type TextBlock } from '../../db';
import { useStudioStore } from '../state/studioStore';
import { RENDER_FONT_PRESETS } from '../../shared/renderFontPresets';
import { COLOR_TIER_CATALOG } from '../../shared/colorTiers';

export interface PageInfoSettingsProps {
  jobId?: number;
  onBack?: () => void;
}

interface PageData {
  job: TranslationJob | null;
  image: ImageRecord | null;
  blocks: TextBlock[];
}

/**
 * Resolves a human-readable display label for the OCR engine ID.
 * @param id - Engine identifier from database.
 * @returns Formatted label.
 */
function resolveOcrLabel(id?: string): string {
  switch (id) {
    case 'v6-small':
      return 'Paddle OCR v6 Small';
    case 'v6-large':
      return 'Paddle OCR v6 Large';
    case 'manga-ocr':
      return 'Manga-OCR (ViT)';
    default:
      return id || 'Paddle OCR v6';
  }
}

/**
 * Resolves a human-readable display label for the Color tier ID.
 * @param id - Color tier identifier from database.
 * @returns Formatted label.
 */
function resolveColorLabel(id?: string): string {
  if (!id || id === 'none') {
    return 'Disabled (Original B&W)';
  }
  const found = COLOR_TIER_CATALOG.find((t) => t.id === id);
  return found ? found.name : id;
}

/**
 * Resolves a human-readable display label for the Inpainting tier.
 * @param id - Inpaint tier identifier from database.
 * @returns Formatted label.
 */
function resolveInpaintLabel(id?: string): string {
  switch (id) {
    case 'lama-manga':
      return 'LaMa Manga Inpaint (WebGPU)';
    case 'lama-manga-fast':
      return 'LaMa Manga Fast';
    case 'lama-base':
      return 'LaMa Base Inpaint';
    case 'aotgan':
    case 'aot':
      return 'AOT-GAN Dynamic Inpaint';
    case 'simple':
      return 'Simple Inpaint (Color Fill)';
    case 'none':
      return 'Disabled (No Inpaint)';
    default:
      return id || 'LaMa Manga';
  }
}

/**
 * Resolves a human-readable display label for the Translation engine.
 * @param id - Translation engine identifier from database.
 * @returns Formatted label.
 */
function resolveTranslationLabel(id?: string): string {
  switch (id) {
    case 'gg-translate':
      return 'Google Translate';
    case 'cloudflare-translate':
      return 'Cloudflare AI Translator';
    default:
      return id || 'Google Translate';
  }
}

/**
 * Resolves a human-readable display label for the Bubble mode.
 * @param mode - Bubble detection mode identifier.
 * @returns Formatted label.
 */
function resolveBubbleLabel(mode?: string): string {
  switch (mode) {
    case 'neural':
      return 'Neural Balloon (YOLO)';
    case 'heuristic':
      return 'Heuristic Geometry';
    case 'off':
    default:
      return 'Disabled (Cotrans Box)';
  }
}

/**
 * Resolves a human-readable display label for font presets.
 * @param presetId - Preset identifier from database.
 * @returns Formatted font preset name.
 */
function resolveFontLabel(presetId?: string): string {
  const found = RENDER_FONT_PRESETS.find((p) => p.id === presetId);
  return found?.label || 'CC Wild Words (Comic)';
}

/**
 * React hook observing the active translation job and related page records via Dexie liveQuery.
 * @param jobId - Numeric ID of the translation job.
 * @returns Live reactive page data.
 */
function useLivePageData(jobId?: number): PageData {
  const [data, setData] = useState<PageData>({ job: null, image: null, blocks: [] });

  useEffect(() => {
    if (!jobId) {
      setData({ job: null, image: null, blocks: [] });
      return;
    }

    const observable = liveQuery(async () => {
      const job = await db.translationJobs.get(jobId);
      const image = await db.images.where({ jobId }).first();
      const blocks = image?.id ? await db.textBlocks.where({ imageId: image.id }).toArray() : [];
      return { job: job ?? null, image: image ?? null, blocks };
    });

    const subscription = observable.subscribe({
      next: (val) => setData(val),
      error: (err) => console.error('[PageInfoSettings] Dexie query error:', err),
    });

    return () => subscription.unsubscribe();
  }, [jobId]);

  return data;
}

export const PageInfoSettings: React.FC<PageInfoSettingsProps> = ({ jobId, onBack }) => {
  const { job, blocks } = useLivePageData(jobId);
  const textObjects = useStudioStore((s) => s.textObjects);
  const originalImage = useStudioStore((s) => s.originalImage);

  const [copiedUrl, setCopiedUrl] = useState(false);

  const imageWidth = originalImage?.naturalWidth || 0;
  const imageHeight = originalImage?.naturalHeight || 0;
  const activeBlockCount = textObjects.length > 0 ? textObjects.length : blocks.length;

  const handleCopyUrl = () => {
    if (!job?.srcUrl) return;
    navigator.clipboard.writeText(job.srcUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const formattedDate = job?.completedAt
    ? new Date(job.completedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : job?.timestamp
    ? new Date(job.timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown date';

  return (
    <div className="space-y-3.5 text-xs text-slate-200">
      {/* Header */}
      <div className="pb-2 border-b border-[#282d3f] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#f4446d]/15 text-[#f4446d]">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-slate-100">Page & Translation Info</h3>
            <p className="text-[10px] text-slate-400">Database metadata & live AI pipeline config</p>
          </div>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded bg-[#090a0f] border border-[#262a3b] hover:bg-[#1c1f2e] transition"
          >
            Close
          </button>
        )}
      </div>

      {/* Status & Timing Banner */}
      <div className="p-3 rounded-xl bg-[#090a0f] border border-[#262a3b] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-300">
            {jobId ? `Job #${jobId}` : 'Current Page'}
          </span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>{job?.status ? job.status.toUpperCase() : 'COMPLETED'}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1c1f2e] text-[11px]">
          <div>
            <span className="text-slate-400 block text-[10px]">Total Runtime</span>
            <span className="font-mono text-slate-100 font-medium">
              {job?.durationMs ? `${job.durationMs.toLocaleString()} ms` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">Processed At</span>
            <span className="text-slate-200 truncate block" title={formattedDate}>
              {formattedDate}
            </span>
          </div>
        </div>
      </div>

      {/* AI Pipeline Architecture */}
      <div className="p-3 rounded-xl bg-[#090a0f] border border-[#262a3b] space-y-2.5">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
          <Cpu className="w-3.5 h-3.5 text-[#f4446d]" />
          <span>AI Pipeline Engines</span>
        </div>

        <div className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Language Pair</span>
            <span className="font-mono text-slate-100 font-semibold uppercase">
              {job?.sourceLang || 'auto'} → {job?.targetLang || 'en'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">OCR Recognition</span>
            <span className="text-slate-200 font-medium">{resolveOcrLabel(job?.ocrEngineId)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Colorization Engine</span>
            <span className="text-slate-200 font-medium">{resolveColorLabel(job?.colorTier)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Translation Model</span>
            <span className="text-slate-200 font-medium">{resolveTranslationLabel(job?.translationEngineId)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Inpainting Engine</span>
            <span className="text-slate-200 font-medium">{resolveInpaintLabel(job?.inpaintTier)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Bubble Detection</span>
            <span className="text-slate-200 font-medium">{resolveBubbleLabel(job?.bubbleMode)}</span>
          </div>
        </div>
      </div>

      {/* Typography Configuration */}
      <div className="p-3 rounded-xl bg-[#090a0f] border border-[#262a3b] space-y-2">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
          <Type className="w-3.5 h-3.5 text-[#f4446d]" />
          <span>Render Typography</span>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Font Preset</span>
            <span className="text-slate-200 font-medium">{resolveFontLabel(job?.renderFontPresetId)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Default Weight</span>
            <span className="font-semibold text-slate-200">
              {job?.renderFontBold ? (
                <span className="text-[#f4446d]">Bold (Enabled)</span>
              ) : (
                <span className="text-slate-400">Regular (Unbold)</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Page & Content Statistics */}
      <div className="p-3 rounded-xl bg-[#090a0f] border border-[#262a3b] space-y-2">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
          <Layers className="w-3.5 h-3.5 text-[#f4446d]" />
          <span>Page Content</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-400 block text-[10px]">Dimensions</span>
            <span className="font-mono text-slate-200">
              {imageWidth > 0 && imageHeight > 0 ? `${imageWidth} × ${imageHeight} px` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">Dialogue Bubbles</span>
            <span className="font-mono text-slate-200">{activeBlockCount} detected</span>
          </div>
        </div>
      </div>

      {/* Source & Storage */}
      {job?.srcUrl && (
        <div className="p-3 rounded-xl bg-[#090a0f] border border-[#262a3b] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-medium">Source Image</span>
            <button
              onClick={handleCopyUrl}
              className="flex items-center gap-1 text-[10px] text-[#f4446d] hover:underline"
            >
              {copiedUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copiedUrl ? 'Copied' : 'Copy Source'}
            </button>
          </div>
          <p className="text-[11px] text-slate-300 break-all font-mono line-clamp-2">
            {job.srcUrl}
          </p>
          <div className="pt-1 text-[10px] text-slate-500">
            Stored locally in browser IndexedDB
          </div>
        </div>
      )}
    </div>
  );
};
