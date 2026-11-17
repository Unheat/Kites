/**
 * Summarises one or more runs recorded by `scripts/webllm-local-run.mjs`.
 *
 * The runner already prints a human-readable page, but comparing builds is the actual job (a fix is
 * only interesting as before/after), so this reads the recorded artifacts back and prints a compact
 * table: per label, how many slots still hold their source text, how long each page took, and which
 * recovery warnings the engine emitted.
 *
 * Usage:
 *   node scripts/webllm-local-analyze.mjs before after
 *   node scripts/webllm-local-analyze.mjs --dir ./artifacts run-1 run-2
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Matches any Character the CJK-aware check below considers "not translated yet". */
const SCRIPT_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

/**
 * Reads `--name value` pairs from argv.
 *
 * @returns Map of flag name to value, without the leading dashes.
 */
function parseFlags() {
  const flags = new Map();
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    flags.set(token.slice(2), next && !next.startsWith('--') ? (index += 1, next) : 'true');
  }
  return flags;
}

const flags = parseFlags();
const dir = resolve(flags.get('dir') ?? process.env.KITES_OUT_DIR ?? '/tmp');
const labels = process.argv.slice(2).filter((token) => !token.startsWith('--') && token !== flags.get('dir'));

if (labels.length === 0) {
  console.error('Nothing to analyse. Pass one or more run labels, e.g. `node scripts/webllm-local-analyze.mjs after`.');
  process.exit(1);
}

let missing = false;
const rows = [];
for (const label of labels) {
  const resultPath = join(dir, `kites-${label}-result.json`);
  const logPath = join(dir, `kites-${label}-console.log`);
  if (!existsSync(resultPath)) {
    console.error(`missing ${resultPath}`);
    missing = true;
    continue;
  }

  const results = JSON.parse(readFileSync(resultPath, 'utf8'));
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  let slots = 0;
  let sourceScript = 0;
  let identical = 0;
  for (const pageResult of results) {
    for (const [slot, text] of pageResult.translated.entries()) {
      slots += 1;
      if (pageResult.texts[slot] === text) identical += 1;
      if (SCRIPT_RE.test(text)) sourceScript += 1;
    }
  }
  rows.push({
    label,
    pages: results.length,
    slots,
    identical,
    sourceScript,
    timings: results.map((pageResult) => pageResult.ms).join(' / '),
    warnings: log.split('\n').filter((line) => /Model (omitted|echoed)|Recovery attempt failed|interrupting/.test(line)).length,
  });
}

if (rows.length > 0) {
  const header = ['label', 'pages', 'slots', 'identical', 'source-script', 'ms per page', 'loss reports'];
  const table = rows.map((row) => [
    row.label,
    String(row.pages),
    String(row.slots),
    String(row.identical),
    String(row.sourceScript),
    row.timings,
    String(row.warnings),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...table.map((cells) => cells[column].length)));
  const format = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');
  console.log(format(header));
  for (const cells of table) console.log(format(cells));
}

process.exit(missing ? 1 : 0);
