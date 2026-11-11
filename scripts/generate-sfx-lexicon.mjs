#!/usr/bin/env node
/**
 * Regenerates `src/shared/sfx/onomatopoeiaLexicon.ts` from the upstream J-Ono dataset.
 *
 * Only kana forms and English equivalents are retained: the upstream JSON also carries sample
 * images, contributor prose, and screenshot references, which are covered by a separate licence and
 * must not be copied into this repository. See `src/shared/sfx/ATTRIBUTION.md`.
 *
 * Usage: node scripts/generate-sfx-lexicon.mjs
 */
import { writeFileSync } from 'node:fs';

/** Upstream dataset (MIT, Copyright (c) 2022 Chinchbug). */
const SOURCE_URL = 'https://raw.githubusercontent.com/ObakeConstructs/j-ono-data/main/json/j-ono-data.json';
const OUTPUT_PATH = 'src/shared/sfx/onomatopoeiaLexicon.ts';
const MIN_FORM_LENGTH = 2;
const MAX_EQUIVALENTS = 3;

/**
 * Normalizes kana the same way the runtime classifier does.
 *
 * @param {string} text - Raw kana form.
 * @returns {string} Katakana folded to hiragana, marks and punctuation removed, lowercased.
 */
function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[っッー、。！？!?「」『』…・\s]/g, '')
    .toLowerCase();
}

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to download lexicon source: HTTP ${response.status}`);
}
const entries = await response.json();

const rows = [];
for (const entry of entries) {
  const forms = [...new Set([...(entry.hiragana ?? []), ...(entry.katakana ?? [])].map(normalize))]
    .filter((form) => form.length >= MIN_FORM_LENGTH);
  if (forms.length === 0) continue;
  const equivalents = [];
  for (const equivalent of (entry.definition?.[0]?.equivalent ?? []).slice(0, MAX_EQUIVALENTS)) {
    const trimmed = equivalent.trim();
    if (trimmed && !equivalents.includes(trimmed)) equivalents.push(trimmed);
  }
  if (equivalents.length === 0) continue;
  rows.push({ id: entry.id, forms, en: equivalents });
}

const lines = [
  '/**',
  ' * Japanese onomatopoeia lexicon, generated from the J-Ono dataset.',
  ' *',
  ' * Source: https://github.com/ObakeConstructs/j-ono-data (JSON collection), MIT License,',
  ' * Copyright (c) 2022 Chinchbug. Only the kana forms and English equivalents are retained;',
  ' * samples, images, and per-entry prose are not copied. See ./ATTRIBUTION.md.',
  ' *',
  ' * Regenerate with scripts/generate-sfx-lexicon.mjs rather than editing by hand.',
  ' */',
  '',
  '/** One dictionary entry: normalized kana forms that denote it, and its English equivalents. */',
  'export interface OnomatopoeiaEntry {',
  '  /** Stable identifier from the source dataset. */',
  '  readonly id: string;',
  '  /** Kana forms, normalized (katakana folded to hiragana, long marks and small tsu removed). */',
  '  readonly forms: readonly string[];',
  '  /** Preferred English equivalents, most common first. */',
  '  readonly en: readonly string[];',
  '}',
  '',
  '/** Kana-normalized onomatopoeia entries used for sound-effect classification. */',
  'export const ONOMATOPOEIA_LEXICON: readonly OnomatopoeiaEntry[] = [',
  ...rows.map((row) => {
    const forms = row.forms.map((form) => JSON.stringify(form)).join(', ');
    const english = row.en.map((word) => JSON.stringify(word)).join(', ');
    return `  { id: ${JSON.stringify(row.id)}, forms: [${forms}], en: [${english}] },`;
  }),
  '];',
  '',
];

writeFileSync(OUTPUT_PATH, lines.join('\n'));
console.log(`Wrote ${rows.length} entries to ${OUTPUT_PATH}`);
