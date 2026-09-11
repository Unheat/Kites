import fs from 'fs';

const content = fs.readFileSync('src/offscreen/engines/inpaint/inpaintRegistry.ts', 'utf8');
const urls = [...content.matchAll(/https:\/\/huggingface\.co\/[^\s'"]+/g)].map(m => m[0]);

if (urls.length === 0) {
  console.error('❌ No HuggingFace URLs found in inpaintRegistry.ts');
  process.exit(1);
}

console.log(`Found ${urls.length} URLs to validate:\n${urls.join('\n')}\n`);

let failed = false;

for (const url of urls) {
  process.stdout.write(`Validating ${url}... `);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      redirect: 'follow'
    });
    if (res.ok) {
      console.log(`✅ OK (${res.status})`);
    } else {
      console.log(`❌ FAILED (HTTP ${res.status})`);
      failed = true;
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('\n❌ One or more inpaint model URLs failed validation.');
  process.exit(1);
} else {
  console.log('\n✅ All inpaint model URLs validated successfully.');
}
