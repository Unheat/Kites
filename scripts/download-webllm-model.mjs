/**
 * Downloads a real MLC/WebLLM model repo from Hugging Face into test/model/<modelId>/.
 *
 * This is a reference/fixture copy for local inspection and offline debugging.
 * The extension itself never reads from this folder -- when the e2e script runs,
 * WebLLM downloads the same files straight from Hugging Face into the browser's
 * own Cache Storage, exactly like a real user's first run would.
 *
 * Usage: node scripts/download-webllm-model.mjs [modelId]
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Smallest model in the app's WebLLM registry (src/shared/models-registry.json) --
// picked so the download/debug loop stays fast.
const DEFAULT_MODEL_ID = 'SmolLM2-135M-Instruct-q0f16-MLC';
const HF_REPO = `mlc-ai/${process.argv[2] || DEFAULT_MODEL_ID}`;

async function main() {
  const modelId = process.argv[2] || DEFAULT_MODEL_ID;
  const outDir = path.join(__dirname, '..', 'test', 'model', modelId);
  await mkdir(outDir, { recursive: true });

  console.log(`[Download] Fetching file list for ${HF_REPO}...`);
  const metaRes = await fetch(`https://huggingface.co/api/models/${HF_REPO}`);
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch model metadata: HTTP ${metaRes.status}`);
  }
  const meta = await metaRes.json();
  const files = (meta.siblings || [])
    .map((s) => s.rfilename)
    .filter((name) => name !== '.gitattributes');

  if (files.length === 0) {
    throw new Error('No files found in repo metadata.');
  }

  console.log(`[Download] ${files.length} files to fetch into ${outDir}`);

  for (const file of files) {
    const url = `https://huggingface.co/${HF_REPO}/resolve/main/${file}`;
    process.stdout.write(`[Download] ${file} ... `);
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`FAILED (HTTP ${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path.join(outDir, file), buf);
    console.log(`OK (${(buf.length / 1024).toFixed(1)} KB)`);
  }

  console.log(`\n[Download] Done. Model reference copy saved at test/model/${modelId}/`);
  console.log(`[Download] Note: the browser downloads its own copy from Hugging Face on first use -- this folder is a local fixture only.`);
}

main().catch((err) => {
  console.error('[Download] Failed:', err);
  process.exit(1);
});
