import { comicBreakPenalty } from '../typography/tokenizer';
import { buildContourSegments } from '../typography/contourSegments';
import { INSERTED_HYPHEN } from '../typography/textUnwrap';
import type { SegmentTemplate, SegmentMeasure } from './types';
import { add, sub, f32, sum } from './numeric';

/**
 * Analyze source exactly once per policy. UTF-16 ranges preserve original whitespace.
 * @param text Original source. @param allowHyphenation Enable dictionary opportunities.
 * @param targetLang Dictionary language. @returns Size-independent source templates.
 */
export function buildSegmentTemplates(text: string, allowHyphenation: boolean, targetLang = 'en'): SegmentTemplate[] {
  return buildContourSegments(text, targetLang, { hyphenate: allowHyphenation }).map((segment) => {
    const sourceText = text.slice(segment.range.start, segment.range.end);
    return { ...segment, sourceText, text: sourceText.trimEnd(), trailingSpace: /\s$/u.test(sourceText),
      hyphenSuffix: segment.breakSuffix !== null, isHyphenBreak: segment.breakSuffix !== null,
      breakPenalty: comicBreakPenalty(text, segment.nextOffset) };
  });
}

/**
 * Measure source pieces, trailing invisible whitespace, and synthetic suffix separately.
 * @param templates Source templates, or legacy utility templates. @param measure Width provider.
 * @returns Measured source stream rounded to f32 at shaping boundary.
 */
export function measureSegments(templates: SegmentTemplate[], measure: (text: string) => number): SegmentMeasure[] {
  return templates.map((template) => {
    const sourceText = template.sourceText;
    if (sourceText !== undefined) {
      const visible = sourceText.trimEnd();
      const trailing = sourceText.slice(visible.length);
      return { text: template.text, sourceText, advance: f32(measure(sourceText)),
        trailingAdvance: trailing ? f32(measure(trailing)) : 0,
        breakSuffixAdvance: template.hyphenSuffix ? f32(measure('-')) : 0,
        breakSuffix: template.breakSuffix, isMandatory: template.isMandatory ?? false,
        isHyphenBreak: template.isHyphenBreak, breakPenalty: f32(template.breakPenalty) };
    }
    const space = template.trailingSpace ? f32(measure(' ')) : 0;
    return { text: template.text, advance: add(measure(template.text), space), trailingAdvance: space,
      breakSuffixAdvance: template.hyphenSuffix ? f32(measure('-')) : 0,
      isMandatory: template.isMandatory ?? false, isHyphenBreak: template.isHyphenBreak,
      breakPenalty: f32(template.breakPenalty) };
  });
}

/** Build templates and measure them. @param text Source. @param measure Width callback.
 * @param allowHyphenation Dictionary toggle. @param targetLang Language. @returns Measured segments. */
export function buildSegmentMeasures(text: string, measure: (text: string) => number,
  allowHyphenation: boolean, targetLang = 'en'): SegmentMeasure[] {
  return measureSegments(buildSegmentTemplates(text, allowHyphenation, targetLang), measure);
}

/** Sum visible line advance, excluding final whitespace. @param segments Stream.
 * @param start Inclusive index. @param end Exclusive index. @returns f32 width. */
export function lineAdvance(segments: SegmentMeasure[], start: number, end: number): number {
  const last = segments[end - 1];
  const advance = sub(sum(segments.slice(start, end).map((segment) => segment.advance)), last.trailingAdvance);
  return end < segments.length ? add(advance, last.breakSuffixAdvance) : advance;
}

/** Materialize selected source ranges without inventing spaces or losing hard hyphens.
 * @param segments Measured stream. @param breaks Exclusive end indices. @returns Line text. */
export function materializeLines(segments: SegmentMeasure[], breaks: number[]): string[] {
  let start = 0;
  return breaks.map((end) => {
    let text = '';
    for (let index = start; index < end; index++) {
      const segment = segments[index];
      const final = index === end - 1;
      text += segment.sourceText !== undefined
        ? (final ? segment.sourceText.trimEnd() : segment.sourceText)
        : segment.text + (!final && segment.trailingAdvance > 0 ? ' ' : '');
    }
    const last = segments[end - 1];
    if (end < segments.length && !last.isMandatory && last.breakSuffixAdvance > 0) text += INSERTED_HYPHEN;
    start = end;
    return text;
  });
}
