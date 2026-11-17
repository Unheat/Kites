/**
 * Documentation gate: the undocumented-symbol count may not grow.
 *
 * TypeDoc reports every exported symbol that lacks a documentation comment. The engine and shared
 * layers still carry a large historical backlog, so this gate does not demand zero: it records the
 * current count in `docs/api-undocumented-baseline.json` and fails when the count increases. New code
 * therefore has to be documented, while the backlog can only shrink.
 *
 * Usage: node scripts/check-docs.mjs [--update]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BASELINE_PATH = 'docs/api-undocumented-baseline.json';
const COUNT_PATTERN = /does not have any documentation/;

/**
 * Runs TypeDoc with the undocumented-symbol validation and counts its reports.
 *
 * @returns Total undocumented symbols and the per-area breakdown.
 */
function measure() {
  // TypeDoc writes its warnings to stderr, so both streams are parsed.
  const run = spawnSync('npx', ['typedoc', '--validation.notDocumented'], { encoding: 'utf8' });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  // A TypeDoc error (a syntax it cannot parse, a broken project) produces no warnings at all, which
  // would read as "nothing undocumented" and silently pass the gate. Fail loudly instead.
  if (/\[error\]/.test(output)) {
    console.error('[docs] TypeDoc reported errors, so the undocumented count is meaningless:');
    console.error(output.split('\n').filter((line) => line.includes('[error]') || line.includes('error TS')).join('\n'));
    process.exit(1);
  }
  const lines = output.split('\n').filter((line) => COUNT_PATTERN.test(line));
  const counts = { offscreen: 0, shared: 0, other: 0 };
  for (const line of lines) {
    if (line.includes('/src/offscreen/')) counts.offscreen += 1;
    else if (line.includes('/src/shared/')) counts.shared += 1;
    else counts.other += 1;
  }
  return { total: lines.length, ...counts };
}

const current = measure();
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ ...current, recordedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`[docs] baseline updated: ${current.total} undocumented symbols`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const delta = current.total - baseline.total;
console.log(`[docs] undocumented symbols: ${current.total} (baseline ${baseline.total}, delta ${delta >= 0 ? '+' : ''}${delta})`);
if (delta > 0) {
  console.error('[docs] Documentation regression: document the new exported symbols, or run `npm run docs:check -- --update` only when the backlog genuinely grew.');
  process.exit(1);
}
