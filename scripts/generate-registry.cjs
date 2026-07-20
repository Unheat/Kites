const fs = require('fs');

async function generateRegistry() {
  console.log('Fetching all Xenova translation models from Hugging Face...');
  
  let allModels = [];
  let nextUrl = 'https://huggingface.co/api/models?author=Xenova&pipeline_tag=translation&limit=100';
  
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
        if (name.includes('opus-mt-')) {
          const parts = name.split('opus-mt-')[1].split('-');
          name = `Marian-MT (${parts[0].toUpperCase()} to ${parts[1].toUpperCase()})`;
        } else if (name.includes('nllb')) {
          name = `NLLB-200 (${model.id.split('/').pop()})`;
        }
        
        allModels.push({
          id: model.id,
          name: name
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
    
    console.log(`Found ${allModels.length} models total.`);
    
    // Write to onnx-registry.json
    fs.writeFileSync('onnx-registry.json', JSON.stringify(allModels, null, 2));
    console.log('Successfully wrote to onnx-registry.json');
    
  } catch (error) {
    console.error('Failed to generate registry:', error);
  }
}

generateRegistry();
