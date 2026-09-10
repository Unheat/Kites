import { prebuiltAppConfig } from '@mlc-ai/web-llm';

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
    const res = await fetch(url, { method: useRange ? 'GET' : 'HEAD', headers });
    if (res.ok || (useRange && res.status === 206)) {
      return { ok: true, status: res.status };
    }
    // Fallback GET if HEAD is not allowed
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
    id: model.model_id,
    vram: model.vram_required_MB ? `~${model.vram_required_MB.toFixed(0)} MB` : '~2500 MB',
    lowResource: model.low_resource_required ?? false,
    allPassed,
    checks: {
      wasm: wasmCheck.ok ? '200 OK' : `FAIL (${wasmCheck.status || wasmCheck.error})`,
      config: configCheck.ok ? '200 OK' : `FAIL (${configCheck.status || configCheck.error})`,
      tensorCache: tensorCheck.ok ? '200 OK' : `FAIL (${tensorCheck.status || tensorCheck.error})`,
      shard0: shardCheck.ok ? '200 OK' : `FAIL (${shardCheck.status || shardCheck.error})`,
    },
  };
}

async function run() {
  console.log('=== SCREENING MULTILINGUAL TRANSLATION CANDIDATES ===');
  const allModels = prebuiltAppConfig.model_list;
  console.log(`Total models in prebuiltAppConfig: ${allModels.length}`);

  // Filtering rules:
  // 1. Multilingual instruction families only
  // 2. Quantized 4-bit only (q4f16_1 or q4f32_1)
  // 3. Exclude: Math, Coder, Embed, Base, Llama-2, RedPajama, TinyLlama, WizardMath
  // 4. VRAM <= 6500 MB

  const candidateModels = allModels.filter((m) => {
    const id = m.model_id;
    if (!id.includes('q4f16_1') && !id.includes('q4f32_1')) return false;
    if (id.includes('embed') || id.includes('Math') || id.includes('Coder') || id.includes('Base')) return false;
    if (id.includes('Llama-2') || id.includes('RedPajama') || id.includes('TinyLlama') || id.includes('Wizard')) return false;
    if (m.vram_required_MB && m.vram_required_MB > 6500) return false;

    return (
      id.startsWith('Qwen2.5-') ||
      id.startsWith('Llama-3.2-') ||
      id.startsWith('Llama-3.1-') ||
      id.startsWith('gemma-2-') ||
      id.startsWith('Phi-3.5-mini-') ||
      id.startsWith('Mistral-7B-Instruct-v0.3') ||
      id.startsWith('DeepSeek-R1-Distill-Qwen') ||
      id.startsWith('SmolLM2-1.7B-Instruct')
    );
  });

  console.log(`Candidates passing multilingual criteria: ${candidateModels.length}\n`);

  console.log('=== FAST FILE & URL INTEGRITY CHECK (HEAD / Range) ===');
  const verified = [];
  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    process.stdout.write(`[${i + 1}/${candidateModels.length}] Checking ${model.model_id}... `);
    const res = await verifyModel(model);
    if (res.allPassed) {
      console.log(`✓ 200 OK (${res.vram})`);
      verified.push(res);
    } else {
      console.log(`✗ FAIL (${JSON.stringify(res.checks)})`);
    }
    await sleep(150); // Be polite to HuggingFace CDN
  }

  console.log('\n=== VERIFICATION RESULTS ===');
  console.log(`Total Tested: ${candidateModels.length}`);
  console.log(`Total Healthy: ${verified.length}`);
  console.log(JSON.stringify(verified, null, 2));
}

run();
