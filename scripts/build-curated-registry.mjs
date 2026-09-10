import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const registryPath = path.resolve(__dirname, '../src/shared/models-registry.json');

// Ordered list of verified model IDs (Recommended lightweight first, then high-fidelity)
const approvedModelIds = [
  // Tier 1: Recommended Fast & Lightweight (Under 2.5 GB VRAM)
  'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  'gemma-2-2b-jpn-it-q4f16_1-MLC',
  'gemma-2-2b-it-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
  'Phi-3.5-mini-instruct-q4f16_1-MLC-1k',

  // Tier 2: High Fidelity (4 GB - 5.5 GB VRAM)
  'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
  'Qwen2.5-7B-Instruct-q4f16_1-MLC',
  'Llama-3.1-8B-Instruct-q4f16_1-MLC-1k',
  'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',

  // Compatibility float32 fallbacks (for GPUs without shader-f16 support)
  'Qwen2.5-3B-Instruct-q4f32_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  'Llama-3.2-3B-Instruct-q4f32_1-MLC',
  'gemma-2-2b-jpn-it-q4f32_1-MLC',
  'gemma-2-2b-it-q4f32_1-MLC',
  'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
  'SmolLM2-1.7B-Instruct-q4f32_1-MLC',
  'Phi-3.5-mini-instruct-q4f32_1-MLC-1k',
  'DeepSeek-R1-Distill-Qwen-7B-q4f32_1-MLC',
  'Qwen2.5-7B-Instruct-q4f32_1-MLC',
  'Llama-3.1-8B-Instruct-q4f32_1-MLC-1k',
  'Mistral-7B-Instruct-v0.3-q4f32_1-MLC',
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
