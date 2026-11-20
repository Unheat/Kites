/** One OCR block as it moves through the pipeline: preserved, sent, returned, drawn. */
export interface AuditedBlock {
  /** OCR order index, the identity every downstream stage uses. */
  index: number;
  /** Text OCR read from the page. */
  text: string;
  /** Artwork classification, when the classifier made one. */
  kind?: string;
  /** Whether the preserve policy kept this block out of translation. */
  preserved: boolean;
  /** OCR confidence for the block. */
  score?: number;
  /** Box width in page pixels. */
  width?: number;
  /** Box height in page pixels. */
  height?: number;
  /** Writing direction OCR reported ('v', 'h'). */
  direction?: string;
  /** Text actually handed to the engine, when it was sent. */
  sentText?: string;
  /** Text the engine returned, when one came back. */
  translatedText?: string;
}

/**
 * Flag handed down with each job by the background.
 *
 * Module state because the pipeline reads it per page and the value only changes between jobs.
 */
let auditRequestedByJob = false;

/**
 * Records whether the job being processed asked for the stage audit.
 *
 * @param enabled - Whether the background read the debug flag as on for this job.
 */
export function setPipelineAuditFlag(enabled: boolean): void {
  auditRequestedByJob = enabled;
}

/**
 * Whether the stage audit should run for this page.
 *
 * Off by default: it prints one line per OCR block, which is noise for users and the only way to see
 * why a specific bubble was skipped. Development builds always run it; a packaged build runs it when
 * `chrome.storage.local.set({ kites_debug_pipeline_audit: true })` has been set.
 *
 * The flag arrives with the job rather than being read here: this code runs in the offscreen
 * document, where `chrome.storage` is undefined — measured, not assumed, `chrome.storage.local`
 * threw "Cannot read properties of undefined (reading 'local')" there while the same call worked
 * from the popup.
 *
 * @param devBuild - Whether this is a development build; defaults to the build mode, and is a
 *   parameter so the packaged-build branch can be exercised in tests.
 * @returns True when block-level audit lines should be printed.
 */
export async function isPipelineAuditEnabled(devBuild: boolean = import.meta.env.DEV): Promise<boolean> {
  return devBuild || auditRequestedByJob;
}

/**
 * Prints one line per OCR block: what was read, whether it was preserved, what the engine returned.
 *
 * The question it answers is "which stage dropped this bubble?" — a preserved block never reaches a
 * model, an empty answer means the engine dropped it, and a translation that is not drawn means the
 * layout stage rejected it.
 *
 * @param jobId - Job being processed, so lines from concurrent runs can be told apart.
 * @param blocks - Blocks with their resolved stage outcomes.
 */
export function logPipelineAudit(jobId: number, blocks: readonly AuditedBlock[]): void {
  console.log(`[PipelineAudit] job ${jobId}: ${blocks.length} block(s), one line each`);
  for (const block of blocks) {
    const size = block.width && block.height ? `${Math.round(block.width)}x${Math.round(block.height)}` : '?';
    const confidence = typeof block.score === 'number' ? block.score.toFixed(2) : '?';
    const stage = block.preserved
      ? 'preserved'
      : block.sentText === undefined
        ? 'not-sent'
        : block.translatedText === undefined || block.translatedText === ''
          ? 'empty-answer'
          : block.translatedText.trim() === block.text.trim()
            ? 'echoed'
            : 'translated';
    const detail = stage === 'translated' || stage === 'echoed'
      ? ` out="${truncate(block.translatedText ?? '')}"`
      : '';
    console.log(
      `[PipelineAudit] job ${jobId} #${String(block.index).padStart(2, '0')} ` +
      `${stage.padEnd(12)} ${block.preserved ? (block.kind ?? 'artwork') : 'dialogue'.padEnd(8)} ` +
      `${size} ${block.direction ?? '?'} score=${confidence} "${truncate(block.text)}"${detail}`
    );
  }
}

/**
 * Shortens long lines so one block stays on one log line.
 *
 * @param text - Text to shorten.
 * @returns The text, truncated to 40 characters with an ellipsis when longer.
 */
function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 40 ? trimmed : `${trimmed.slice(0, 40)}…`;
}
