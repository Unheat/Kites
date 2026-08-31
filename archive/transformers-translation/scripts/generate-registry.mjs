import fs from 'fs';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateRegistry() {
  console.log('Fetching all models and generating unified static registry...');
  
  let allModels = [];

  // 1. Process WebLLM Models
  console.log('Processing WebLLM models from prebuiltAppConfig...');
  for (const model of prebuiltAppConfig.model_list) {
    allModels.push({
      id: model.model_id,
      name: model.model_id,
      vramEstimate: model.vram_required_MB ? `~${model.vram_required_MB} MB` : '~4000 MB',
      engine: 'webllm'
    });
  }

  // 2. Process Transformers.js ONNX Models
  const authors = ['Xenova', 'onnx-community'];
  for (const author of authors) {
    let nextUrl = `https://huggingface.co/api/models?author=${author}&pipeline_tag=translation&limit=100`;
    
    try {
      while (nextUrl) {
        console.log(`Fetching: ${nextUrl}`);
        const response = await fetch(nextUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        for (const model of data) {
          // Format the name nicely
          let name = model.id;
          let vramEstimate = '~200 MB';

          if (name.includes('opus-mt-')) {
            const parts = name.split('opus-mt-')[1].split('-');
            name = `Marian-MT (${parts[0].toUpperCase()} to ${parts[1].toUpperCase()})`;
            vramEstimate = '~70 MB';
          } else if (name.includes('nllb')) {
            name = `NLLB-200 (${model.id.split('/').pop()})`;
            vramEstimate = '~600 MB';
          }
          
          allModels.push({
            id: model.id,
            name: name,
            vramEstimate: vramEstimate,
            engine: 'transformers'
          });
        }
        
        // Check for pagination link
        const linkHeader = response.headers.get('link');
        nextUrl = null;
        if (linkHeader) {
          const links = linkHeader.split(',');
          const nextLink = links.find(link => link.includes('rel="next"'));
          if (nextLink) {
            const match = nextLink.match(/<([^>]+)>/);
            if (match) {
              nextUrl = match[1];
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to fetch ONNX registry for ${author}:`, error);
    }
  }

  console.log(`Found ${allModels.length} models total.`);
  
  // Write to src/shared/models-registry.json
  const outputPath = path.resolve(__dirname, '../src/shared/models-registry.json');
  fs.writeFileSync(outputPath, JSON.stringify(allModels, null, 2));
  console.log(`Successfully wrote unified registry to ${outputPath}`);
}

generateRegistry();
