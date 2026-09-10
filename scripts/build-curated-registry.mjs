import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const registryPath = path.resolve(__dirname, '../src/shared/models-registry.json');

// Ordered list of verified model IDs (Recommended lightweight first, then high-fidelity)
const approvedModelIds = [
  // Current multilingual models, ordered by translation usefulness and browser cost.
  'Qwen3.5-2B-q4f16_1-MLC',
  'Qwen3-1.7B-q4f16_1-MLC',
  'Qwen3.5-0.8B-q4f16_1-MLC',
  'gemma3-1b-it-q4f16_1-MLC',
  'Qwen3-4B-q4f16_1-MLC',
  'Qwen3.5-4B-q4f16_1-MLC',
  'Phi-4-mini-instruct-q4f16_1-MLC',
  'Qwen3-8B-q4f16_1-MLC',

  // Float32 compatibility variants for adapters without shader-f16.
  'Qwen3.5-2B-q4f32_1-MLC',
  'Qwen3-1.7B-q4f32_1-MLC',
  'Qwen3.5-0.8B-q4f32_1-MLC',
  'Qwen3-4B-q4f32_1-MLC',
  'Qwen3.5-4B-q4f32_1-MLC',
  'Phi-4-mini-instruct-q4f32_1-MLC',
];

const modelMap = new Map();
for (const model of prebuiltAppConfig.model_list) {
  modelMap.set(model.model_id, model);
}

const curatedRegistry = [];
for (const id of approvedModelIds) {
  const meta = modelMap.get(id);
  if (!meta) {
    console.warn(`Warning: Model ${id} not found in prebuiltAppConfig`);
    continue;
  }
  curatedRegistry.push({
    id: meta.model_id,
    name: meta.model_id,
    vramEstimate: meta.vram_required_MB ? `~${meta.vram_required_MB.toFixed(0)} MB` : '~2500 MB',
    engine: 'webllm',
  });
}

fs.writeFileSync(registryPath, JSON.stringify(curatedRegistry, null, 2) + '\n');
console.log(`Successfully wrote ${curatedRegistry.length} verified models to ${registryPath}`);
