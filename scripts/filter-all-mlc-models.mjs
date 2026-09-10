import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const registryPath = path.resolve(__dirname, '../src/shared/models-registry.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRawBaseUrl(modelUrl) {
  let url = modelUrl.trim();
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.includes('huggingface.co') && !url.includes('/resolve/')) {
    url = `${url}/resolve/main/`;
  } else if (!url.endsWith('/')) {
    url = `${url}/`;
  }
  return url;
}

async function checkUrl(url, useRange = false) {
  try {
    const headers = useRange ? { Range: 'bytes=0-10' } : {};
    let res = await fetch(url, { method: useRange ? 'GET' : 'HEAD', headers });
    if (res.ok || (useRange && res.status === 206)) {
      return { ok: true, status: res.status };
    }
    // Fallback to GET with Range if HEAD rejected
    if (!useRange && (res.status === 403 || res.status === 405 || res.status === 400)) {
      const getRes = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-10' } });
      return { ok: getRes.ok || getRes.status === 206, status: getRes.status };
    }
    return { ok: false, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function verifyModel(model) {
  const rawBase = getRawBaseUrl(model.model);
  const wasmUrl = model.model_lib;
  const configUrl = `${rawBase}mlc-chat-config.json`;
  const tensorCacheUrl = `${rawBase}ndarray-cache.json`;
  const shard0Url = `${rawBase}params_shard_0.bin`;

  const [wasmCheck, configCheck, tensorCheck, shardCheck] = await Promise.all([
    checkUrl(wasmUrl),
    checkUrl(configUrl),
    checkUrl(tensorCacheUrl),
    checkUrl(shard0Url, true),
  ]);

  const allPassed = wasmCheck.ok && configCheck.ok && tensorCheck.ok && shardCheck.ok;
  return {
    allPassed,
    checks: {
      wasm: wasmCheck.ok ? '200 OK' : `FAIL (${wasmCheck.status || wasmCheck.error})`,
      config: configCheck.ok ? '200 OK' : `FAIL (${configCheck.status || configCheck.error})`,
      tensorCache: tensorCheck.ok ? '200 OK' : `FAIL (${tensorCheck.status || tensorCheck.error})`,
      shard0: shardCheck.ok ? '200 OK' : `FAIL (${shardCheck.status || shardCheck.error})`,
    },
  };
}

// Programmatic filter rules
function isCandidateForTranslation(model) {
  const id = model.model_id;

  // 1. Exclude embeddings (cannot generate text)
  if (id.includes('embed')) return { keep: false, reason: 'embedding model' };

  // 2. Exclude code specialists (not for natural language translation)
  if (id.includes('Coder') || id.includes('CodeLlama')) return { keep: false, reason: 'code specialist' };

  // 3. Exclude math specialists
  if (id.includes('Math')) return { keep: false, reason: 'math specialist' };

  // 4. Must be 4-bit (or 3-bit) quantized. Reject unquantized float models (q0f16, q0f32)
  const isQuantized = id.includes('q4f16') || id.includes('q4f32') || id.includes('q3f16');
  if (!isQuantized) return { keep: false, reason: 'unquantized float weights' };

  // 5. Must fit within browser WebGPU allocations (<= 6500 MB VRAM)
  if (model.vram_required_MB && model.vram_required_MB > 6500) {
    return { keep: false, reason: `VRAM exceeds WebGPU allocation limit (${model.vram_required_MB.toFixed(0)} MB)` };
  }

  // 6. Must be an instruction/chat tuned model (not a raw base model)
  const isInstructOrChat =
    id.includes('Instruct') ||
    id.includes('Chat') ||
    id.includes('chat') ||
    id.includes('-it') ||
    id.includes('zephyr') ||
    id.includes('Hermes');

  if (!isInstructOrChat) {
    return { keep: false, reason: 'raw base model without instruction tuning' };
  }

  // 7. Reject explicit Base tags even if another word matches
  if (id.includes('-Base-')) return { keep: false, reason: 'explicit base model' };

  return { keep: true };
}

async function run() {
  const allModels = prebuiltAppConfig.model_list;
  console.log(`\n======================================================`);
  console.log(`Processing complete raw WebLLM catalog (${allModels.length} models)...`);
  console.log(`======================================================\n`);

  const candidates = [];
  const rejected = [];

  for (const model of allModels) {
    const filter = isCandidateForTranslation(model);
    if (filter.keep) {
      candidates.push(model);
    } else {
      rejected.push({ id: model.model_id, reason: filter.reason });
    }
  }

  console.log(`Programmatic Filter Results:`);
  console.log(`- Candidates to verify: ${candidates.length}`);
  console.log(`- Filtered out: ${rejected.length}\n`);

  console.log(`Starting live HTTP file integrity checks on ${candidates.length} candidate models...`);
  const verifiedModels = [];

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${model.model_id}... `);
    const verify = await verifyModel(model);

    if (verify.allPassed) {
      const vramStr = model.vram_required_MB ? `~${model.vram_required_MB.toFixed(0)} MB` : '~2500 MB';
      console.log(`✓ 200 OK (${vramStr})`);
      verifiedModels.push({
        id: model.model_id,
        name: model.model_id,
        vramEstimate: vramStr,
        engine: 'webllm',
        lowResource: model.low_resource_required ?? false,
      });
    } else {
      console.log(`✗ FAILED: ${JSON.stringify(verify.checks)}`);
    }

    await sleep(100); // Be polite to CDN
  }

  console.log(`\n======================================================`);
  console.log(`VERIFICATION SUMMARY:`);
  console.log(`- Total catalog: ${allModels.length}`);
  console.log(`- Programmatically selected: ${candidates.length}`);
  console.log(`- Live 200 OK verified: ${verifiedModels.length}`);
  console.log(`- Stripped: ${allModels.length - verifiedModels.length}`);
  console.log(`======================================================\n`);

  // Write verified models to registry
  // Clean format for models-registry.json (id, name, vramEstimate, engine)
  const cleanRegistry = verifiedModels.map(({ id, name, vramEstimate, engine }) => ({
    id,
    name,
    vramEstimate,
    engine,
  }));

  fs.writeFileSync(registryPath, JSON.stringify(cleanRegistry, null, 2) + '\n');
  console.log(`Successfully updated ${registryPath} with ${cleanRegistry.length} verified models.`);
}

run().catch((err) => {
  console.error('Fatal error filtering models:', err);
  process.exit(1);
});
