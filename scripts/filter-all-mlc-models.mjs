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
    if (!useRange) {
      await sleep(500);
      try {
        const retryRes = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-10' } });
        if (retryRes.ok || retryRes.status === 206) return { ok: true, status: retryRes.status };
      } catch {}
    }
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
  const lower = id.toLowerCase();

  // 1. Exclude embeddings (cannot generate text)
  if (lower.includes('embed')) return { keep: false, reason: 'embedding model' };

  // 2. Exclude vision-language models (different input schema / multimodal pipeline)
  if (lower.includes('vision')) return { keep: false, reason: 'vision multimodal model' };

  // 3. Exclude code specialists (not for natural language translation)
  if (lower.includes('coder') || lower.includes('codellama')) return { keep: false, reason: 'code specialist' };

  // 4. Exclude math specialists
  if (lower.includes('math')) return { keep: false, reason: 'math specialist' };

  // 5. Exclude reasoning models (unsuited for strict JSON schema translation)
  if (lower.includes('reasoning') || lower.includes('r1')) return { keep: false, reason: 'reasoning model' };

  // 6. Must be 4-bit (or 3-bit) quantized. Reject unquantized float models (q0f16, q0f32)
  const isQuantized = lower.includes('q4f16') || lower.includes('q4f32') || lower.includes('q3f16');
  if (!isQuantized) return { keep: false, reason: 'unquantized float weights' };

  // 7. Instruction/chat tuned model required (not a raw base model or reasoning model)
  const isInstructOrChat = lower.includes('instruct') || lower.includes('chat') || lower.includes('-it');
  if (!isInstructOrChat) {
    return { keep: false, reason: 'raw base model without instruction tuning' };
  }

  // 8. Reject explicit Base tags even if another word matches
  if (lower.includes('-base-')) return { keep: false, reason: 'explicit base model' };

  // 9. Multilingual Translation Capability Filtering:
  // Reject architectures that lack multilingual training or have zero CJK tokenizer support.
  // Kites requires models capable of translating across our supported languages (ja, zh, ko, en, fr, de, es, it, pt, ru, ar, vi, th, etc.).
  if (lower.includes('tinyllama')) return { keep: false, reason: 'English-only pretraining (SlimPajama, no CJK vocab)' };
  if (lower.includes('redpajama')) return { keep: false, reason: 'English-only pretraining (archaic 2023 model)' };
  if (lower.includes('smollm')) return { keep: false, reason: 'English-only pretraining (FineWeb-Edu, non-multilingual)' };
  if (lower.includes('olmo')) return { keep: false, reason: 'English-only pretraining (Dolma dataset)' };
  if (lower.includes('stablelm')) return { keep: false, reason: 'European only (0 Asian/CJK tokens in vocabulary)' };
  if (lower.includes('llama-2-')) return { keep: false, reason: 'English-only (89.7% English, obsolete Llama-2)' };
  if (lower.includes('gemma-2b-it')) return { keep: false, reason: 'English-only (Gemma 1, superseded by Gemma 2)' };
  if (lower.includes('hermes')) return { keep: false, reason: 'English agentic fine-tune (catastrophic multilingual forgetting)' };
  if (id.startsWith('Llama-3-')) return { keep: false, reason: 'English-primary (superseded by multilingual Llama 3.1)' };
  if (lower.includes('mistral-7b-instruct-v0.2')) return { keep: false, reason: 'superseded by v0.3' };
  if (lower.includes('phi-1') || lower.includes('phi-2') || id.startsWith('Phi-3-')) {
    return { keep: false, reason: 'English-only (superseded by multilingual Phi-3.5/Phi-4)' };
  }

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
