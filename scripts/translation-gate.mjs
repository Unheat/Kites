/**
 * Fails when the translation pipeline changed without fresh measurement.
 *
 * Why: every translation fix in this repo is accepted on numbers, and the unit suite cannot see a
 * quality change — it asserts plumbing, not whether the model still translates. Two regressions in
 * this project's history passed a green suite (a romaji answer counted as translated, and an Arabic
 * answer counted as Vietnamese), so "tests pass" is not evidence that translation still works.
 *
 * What it enforces:
 *   1. If the diff touches the translation pipeline, a receipt must exist under
 *      `docs/dev-history/receipts/translation-gate/`.
 *   2. The receipt must have been measured against *this* code: it stores a fingerprint of the
 *      pipeline files, and a stale fingerprint fails the gate.
 *   3. Per combo, failures may not exceed the recorded baseline by more than `--tolerance` slots.
 *      Equal is passing; the tolerance is the measured run-to-run swing of a stochastic model, not
 *      a licence to regress.
 *
 * CI cannot run the measurement itself: the local WebLLM path needs a GPU and WebGPU, and
 * GitHub-hosted runners have neither. So the receipt is produced where the hardware is and CI
 * verifies it — evidence, not theatre.
 *
 * Usage:
 *   npm run gate:translation                      # check against origin/main
 *   npm run gate:translation -- --base main --tolerance 2
 *   node scripts/translation-gate.mjs --record --from /tmp/kites-stress-stress-1.json --repeats 2
 *
 * Usage of --record writes the receipt for the current pipeline fingerprint, so the measurement it
 * came from must have been produced by the current build (rebuild and re-run before recording).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_DIR = join(REPO_ROOT, 'docs/dev-history/receipts/translation-gate');
const BASELINE_FILE = join(RECEIPT_DIR, 'baseline.json');
const RESULT_FILE = join(RECEIPT_DIR, 'latest.json');

/**
 * Paths whose contents decide whether text becomes the translation users see.
 *
 * OCR is included on purpose: a recognition change alters the strings the engine is asked to
 * translate, so it can regress translation quality without touching a translation file.
 */
const PIPELINE_PATHS = [
  'src/offscreen/engines/translation/',
  'src/offscreen/engines/ocr/',
  'src/offscreen/services/TranslationManager.ts',
  'src/offscreen/services/OcrManager.ts',
  'src/offscreen/services/PipelineOrchestrator.ts',
  'src/shared/translation/',
  'src/shared/utils/textCleaning.ts',
  'src/shared/utils/LanguageRegistry.ts',
  'src/shared/utils/sourceLanguageHint.ts',
  'src/shared/glossary.ts',
];

/**
 * Default allowed increase in failed slots per combo.
 *
 * Measured swing on identical code: `auto-vi-zh` moved 0/36 to 2/36 between runs of the same build,
 * and a single page re-run changed by one slot. Two slots absorbs sampling noise; anything larger is
 * a real change and must be explained in the receipt.
 */
const DEFAULT_TOLERANCE = 2;

/**
 * Minimum slots a combo needs before its comparison means anything.
 *
 * Measured need: `short-vi-zh` (16 slots at two repeats) moved 1/16 to 5/16 between runs of the
 * same build, with a pinned source the change under test could not touch — pure sampling noise.
 * Below this many slots a combo is reported, never failed.
 */
const MIN_SLOTS_FOR_COMPARISON = 36;

/**
 * Rate increase, in failed share of slots, that a combo must also exceed to fail.
 *
 * Both this and `--tolerance` must be exceeded: the absolute floor stops a tiny sample from failing
 * on one slot, and the rate floor stops a big page from failing on a difference that is rounding.
 */
const REGRESSION_RATE_TOLERANCE = 0.10;

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
    const name = token.slice(2);
    const next = argv[index + 1];
    flags.set(name, next && !next.startsWith('--') ? (index += 1, next) : 'true');
  }
  return flags;
}

const flags = parseFlags();
const recordMode = flags.has('record');
const base = flags.get('base') ?? 'origin/main';
const tolerance = Number(flags.get('tolerance') ?? DEFAULT_TOLERANCE);

/**
 * Runs a git command and returns trimmed stdout.
 *
 * @param args - Arguments passed to `git`.
 * @returns Command output.
 */
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/**
 * Whether a repository-relative path is part of the translation pipeline.
 *
 * @param path - Path relative to the repository root.
 * @returns True when the path decides translation input, prompting, or failure accounting.
 */
function isPipelinePath(path) {
  // A test file documents behaviour; it cannot change what a user's page receives.
  if (path.endsWith('.test.ts')) return false;
  return PIPELINE_PATHS.some((prefix) => path.startsWith(prefix));
}

/**
 * Lists files changed between the base branch and the working tree.
 *
 * @returns Repository-relative paths.
 * @throws When the base ref is unavailable, so a shallow clone cannot pass silently.
 */
function changedFiles() {
  try {
    git(['rev-parse', '--verify', base]);
  } catch {
    throw new Error(
      `Cannot resolve base ref "${base}". Fetch it first (git fetch origin main) or pass --base. ` +
      'A gate that cannot see the diff must not report success.'
    );
  }
  const diff = git(['diff', '--name-only', `${base}...HEAD`]);
  const uncommitted = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...diff.split('\n'), ...uncommitted.split('\n'), ...untracked.split('\n')])].filter(Boolean);
}

/**
 * Fingerprints the pipeline files, so a receipt proves it measured the code being shipped.
 *
 * @returns Hex SHA-256 over the tracked pipeline files and their contents.
 */
function pipelineFingerprint() {
  const files = git(['ls-files', ...PIPELINE_PATHS]).split('\n').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(REPO_ROOT, file)));
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), files: files.length };
}

/**
 * Converts a matrix or stress result file into per-combo totals.
 *
 * Both runners write the same shape: runs[] each carrying a combo id and pages[] with a `failed`
 * count and a `slots` count, so one reader serves both.
 *
 * @param resultPath - Path to a `kites-matrix-*.json` or `kites-stress-*.json` file.
 * @returns Per-combo slots and failures.
 */
function readResultFile(resultPath) {
  const raw = JSON.parse(readFileSync(resultPath, 'utf8'));
  const combos = new Map();
  for (const run of raw.runs ?? []) {
    const entry = combos.get(run.combo) ?? { slots: 0, failed: 0 };
    for (const page of run.pages ?? []) {
      entry.slots += page.slots ?? 0;
      entry.failed += page.failed ?? 0;
    }
    combos.set(run.combo, entry);
  }
  return { model: raw.model ?? 'unknown', seed: raw.seed ?? null, combos };
}

/**
 * Writes the receipt for the current pipeline fingerprint.
 *
 * @throws When the measurement file is missing.
 */
function record() {
  const from = flags.get('from');
  if (!from || from === 'true') throw new Error('Pass the result file to record: --from /tmp/kites-matrix-*.json');
  const measured = readResultFile(resolve(from));
  const fingerprint = pipelineFingerprint();
  const receipt = {
    recordedAt: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
    model: flags.get('model') ?? measured.model,
    seed: measured.seed,
    repeats: Number(flags.get('repeats') ?? 0),
    label: flags.get('label') ?? 'unlabelled',
    resultFile: relative(REPO_ROOT, resolve(from)),
    pipelineFingerprint: fingerprint.sha256,
    pipelineFiles: fingerprint.files,
    combos: Object.fromEntries([...measured.combos.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  mkdirSync(RECEIPT_DIR, { recursive: true });
  writeFileSync(RESULT_FILE, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`receipt written: ${relative(REPO_ROOT, RESULT_FILE)}`);
  console.log(`  fingerprint ${fingerprint.sha256.slice(0, 12)} over ${fingerprint.files} file(s)`);
  for (const [combo, entry] of Object.entries(receipt.combos)) {
    console.log(`  ${combo.padEnd(20)} ${entry.failed}/${entry.slots} failed`);
  }
  if (!existsSync(BASELINE_FILE)) {
    console.log('\nNo baseline yet. Promote this receipt: cp latest.json baseline.json (commit both).');
  }
}

/**
 * Checks the diff, the receipt freshness, and the per-combo comparison.
 */
function check() {
  const changed = changedFiles();
  const touched = changed.filter(isPipelinePath);
  if (touched.length === 0) {
    console.log('translation gate: no pipeline files changed, nothing to prove.');
    return;
  }

  console.log(`translation gate: ${touched.length} pipeline file(s) changed:`);
  for (const file of touched.slice(0, 12)) console.log(`  ${file}`);

  if (!existsSync(RESULT_FILE)) {
    throw new Error(
      `Pipeline changed but no receipt exists. Run the real-browser benchmark, then record it:\n` +
      `  npm run build\n` +
      `  npx tsx scripts/webllm-matrix.mjs --label gate --repeats 2\n` +
      `  node scripts/translation-gate.mjs --record --from /tmp/kites-matrix-gate.json\n` +
      `See docs/development/translation-gate.md for what counts as evidence.`
    );
  }

  const receipt = JSON.parse(readFileSync(RESULT_FILE, 'utf8'));
  const fingerprint = pipelineFingerprint();
  if (receipt.pipelineFingerprint !== fingerprint.sha256) {
    throw new Error(
      `The receipt is stale: it was measured against fingerprint ${String(receipt.pipelineFingerprint).slice(0, 12)}, ` +
      `the pipeline is now ${fingerprint.sha256.slice(0, 12)}. Re-run the benchmark and record again.`
    );
  }

  const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : null;
  if (!baseline) {
    console.log('translation gate: no baseline committed; treating the receipt as the first measurement.');
  }

  const problems = [];
  for (const [combo, entry] of Object.entries(receipt.combos ?? {})) {
    const reference = baseline?.combos?.[combo];
    const line = `${combo.padEnd(20)} ${entry.failed}/${entry.slots}`;
    if (!reference) {
      console.log(`  ${line}  (new combo, no baseline)`);
      continue;
    }
    if (entry.slots < MIN_SLOTS_FOR_COMPARISON) {
      console.log(`  ${line}  skipped: ${entry.slots} slot(s), need ${MIN_SLOTS_FOR_COMPARISON}`);
      continue;
    }
    const delta = entry.failed - reference.failed;
    const rateDelta = delta / entry.slots;
    const regressed = delta > tolerance && rateDelta > REGRESSION_RATE_TOLERANCE;
    const verdict = regressed
      ? 'REGRESSED'
      : delta < 0
        ? 'improved'
        : 'equal';
    const pct = `${(rateDelta * 100).toFixed(1)}%`;
    console.log(
      `  ${line}  vs baseline ${reference.failed}/${reference.slots}  delta ${delta >= 0 ? '+' : ''}${delta} (${pct})  ${verdict}`
    );
    if (regressed) {
      problems.push(
        `${combo}: ${entry.failed}/${entry.slots} failed vs baseline ${reference.failed}/${reference.slots} ` +
        `(+${delta}, ${pct}; both tolerance ${tolerance} and rate ${(REGRESSION_RATE_TOLERANCE * 100).toFixed(0)}% were exceeded)`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Translation regressed past tolerance:\n  ${problems.join('\n  ')}\n` +
      'Either fix the change, or record a deliberately accepted trade-off in the receipt and say so in the PR.'
    );
  }
  console.log(`translation gate: passed (tolerance ${tolerance} slot(s) per combo).`);
}

try {
  if (recordMode) record();
  else check();
} catch (error) {
  console.error(`\ntranslation gate: FAILED\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
