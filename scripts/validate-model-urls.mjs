import fs from 'fs';

/**
 * Registries containing on-demand external model downloads.
 */
const REGISTRIES = [
  { name: 'Inpaint', file: 'src/offscreen/engines/inpaint/inpaintRegistry.ts' },
  { name: 'Bubble', file: 'src/offscreen/engines/bubble/bubbleRegistry.ts' },
  { name: 'Color', file: 'src/offscreen/engines/color/colorRegistry.ts' },
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function validateUrl(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use redirect: 'manual' to validate that HuggingFace resolver finds the file (302 redirect)
      // without triggering downstream AWS/Cloudflare CDN rate limits (HTTP 429).
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });

      // 200 (direct hit) or 300-308 (valid resolve redirect to storage backend)
      const isValid = res.status === 200 || (res.status >= 300 && res.status < 400);

      if (isValid) {
        return { ok: true, status: res.status };
      }

      if (res.status === 404) {
        return { ok: false, status: 404, error: 'File or repository does not exist (404)' };
      }

      // Transient rate limits or server errors: retry with backoff
      if (attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500)) {
        console.log(`  ⚠️ Attempt ${attempt} returned HTTP ${res.status}, retrying in ${RETRY_DELAY_MS * attempt}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }

      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.log(`  ⚠️ Attempt ${attempt} failed (${err.message}), retrying in ${RETRY_DELAY_MS * attempt}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'Max retries exceeded' };
}

let totalChecked = 0;
let totalFailed = 0;

console.log('--- Validating External Model Registry URLs ---\n');

for (const registry of REGISTRIES) {
  if (!fs.existsSync(registry.file)) {
    console.warn(`⚠️ Registry file not found: ${registry.file}`);
    continue;
  }

  const content = fs.readFileSync(registry.file, 'utf8');
  const urls = [...content.matchAll(/https:\/\/huggingface\.co\/[^\s'"]+/g)].map((m) => m[0]);

  console.log(`[${registry.name} Registry] (${urls.length} URLs in ${registry.file}):`);

  if (urls.length === 0) {
    console.log('  (no HuggingFace URLs found)');
    continue;
  }

  for (const url of urls) {
    totalChecked++;
    process.stdout.write(`  Validating ${url}... `);
    const result = await validateUrl(url);
    if (result.ok) {
      console.log(`✅ OK (${result.status})`);
    } else {
      console.log(`❌ FAILED (${result.error || `HTTP ${result.status}`})`);
      totalFailed++;
    }
  }
  console.log('');
}

console.log(`Summary: ${totalChecked} checked, ${totalChecked - totalFailed} passed, ${totalFailed} failed.`);

if (totalFailed > 0) {
  console.error('\n❌ One or more model URLs failed validation.');
  process.exit(1);
} else {
  console.log('\n✅ All external model registry URLs validated successfully.');
}
