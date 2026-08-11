import fs from 'fs';
import path from 'path';

const srcDir = path.resolve('node_modules/onnxruntime-web/dist');
const destDir = path.resolve('public/ort-wasm');

try {
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    let count = 0;
    for (const file of files) {
      if (file.endsWith('.wasm') || file.endsWith('.mjs')) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        count++;
      }
    }
    console.log(`Successfully copied ${count} ORT WASM/MJS files to public/ort-wasm`);
  } else {
    console.warn(`Source dir ${srcDir} does not exist.`);
  }
} catch (err) {
  console.warn('Warning copying WASM files:', err.message);
}
