#!/usr/bin/env bash
#
# Sweeps the local model's sampling temperature and reports how many lines come back untranslated.
#
# Why this exists: raising the temperature looked like the obvious cure for a model that copies text
# back, and it is not. Measured on Qwen3.5-0.8B through the real extension, with the source language
# declared correctly (zh -> en), a hotter first pass copies far MORE text: 8/42 slots unchanged at
# temperature 0 versus 26/42 at 0.3, including whole pages. Temperature 0 is the accurate first pass;
# the hotter sample belongs to the recovery pass, which only runs after a page already failed.
#
# The recovery pass is disabled for the sweep so the numbers describe the first attempt alone.
# Every patched file is restored on exit, including on Ctrl-C.
#
# Usage:
#   ./scripts/benchmark-webllm-temperature.sh --pages scripts/fixtures/webllm-bench-pages-zh.json --source zh
#   ./scripts/benchmark-webllm-temperature.sh --temps "0 0.2" --repeats 3 --pages @my-pages.json
#
# Requires: npm run build works, and the WebLLM model is already cached (run
# scripts/webllm-local-run.mjs once first).
set -euo pipefail

cd "$(dirname "$0")/.."

ENGINE=src/offscreen/engines/translation/WebLLMEngine.ts
BASE=src/offscreen/engines/translation/BaseLlmTranslationEngine.ts
TEMPS="0 0.1 0.2 0.3 0.5"
REPEATS=2
SOURCE=auto
PAGES_FILE=scripts/fixtures/webllm-bench-pages-auto.json

while [ $# -gt 0 ]; do
  case "$1" in
    --temps) TEMPS="$2"; shift 2 ;;
    --repeats) REPEATS="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --pages) PAGES_FILE="${2#@}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Labels are partitioned per source language so a sweep never overwrites the other one's results.
PREFIX="bench$(echo "$SOURCE" | tr -d '[:punct:]')"
PAGES=$(cat "$PAGES_FILE")

cp "$ENGINE" /tmp/benchmark-webllm-temperature.engine.bak
cp "$BASE" /tmp/benchmark-webllm-temperature.base.bak
restore() {
  cp /tmp/benchmark-webllm-temperature.engine.bak "$ENGINE"
  cp /tmp/benchmark-webllm-temperature.base.bak "$BASE"
}
trap restore EXIT

for TEMP in $TEMPS; do
  python3 - "$TEMP" <<'PY'
import sys
temperature = sys.argv[1]
engine = 'src/offscreen/engines/translation/WebLLMEngine.ts'
base = 'src/offscreen/engines/translation/BaseLlmTranslationEngine.ts'
source = open(engine).read()
open(engine, 'w').write(source.replace('const WEBLLM_TEMPERATURE = 0;', f'const WEBLLM_TEMPERATURE = {temperature};'))
text = open(base).read()
open(base, 'w').write(text.replace('export const MAX_RETRY_REQUESTS = 1;', 'export const MAX_RETRY_REQUESTS = 0;'))
PY
  npm run build >/dev/null 2>&1

  for REPEAT in $(seq 1 "$REPEATS"); do
    KITES_SRC="$SOURCE" KITES_LABEL="${PREFIX}-t${TEMP}-r${REPEAT}" KITES_PAGES="$PAGES" \
      timeout 900 node scripts/webllm-local-run.mjs >/dev/null 2>&1 || echo "run failed: temp=$TEMP repeat=$REPEAT"
  done

  restore
  echo "temperature $TEMP done"
done

node - "$PREFIX" "$TEMPS" <<'JS'
const fs = require('node:fs');
const [prefix, temps] = process.argv.slice(2);
/** Reads one recorded run, or null when the sweep skipped it. */
const load = (label) => {
  const path = `/tmp/kites-${label}-result.json`;
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;
};
const rows = temps.split(' ').map((temperature) => {
  let slots = 0;
  let unchanged = 0;
  let failedPages = 0;
  let pages = 0;
  let ms = 0;
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    const run = load(`${prefix}-t${temperature}-r${repeat}`);
    if (!run) continue;
    for (const page of run) {
      pages += 1;
      ms += page.ms;
      let pageSame = 0;
      for (let slot = 0; slot < page.texts.length; slot += 1) {
        slots += 1;
        if (page.translated[slot] === page.texts[slot]) {
          unchanged += 1;
          pageSame += 1;
        }
      }
      if (pageSame === page.texts.length) failedPages += 1;
    }
  }
  return { temperature, unchanged: `${unchanged}/${slots}`, failedPages: `${failedPages}/${pages}`, avgMs: pages ? Math.round(ms / pages) : 0 };
});
console.table(rows);
JS
