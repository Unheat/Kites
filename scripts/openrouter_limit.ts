import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(__dirname, '.env'));
} catch {
  // If .env doesn't exist, rely on process.env
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('Missing OPENROUTER_API_KEY. Add it to scripts/.env or set process.env.OPENROUTER_API_KEY.');
  process.exit(1);
}

// ponytail: native fetch replaces @openrouter/sdk to avoid adding dependency for one script
const [keyRes, creditsRes] = await Promise.all([
  fetch('https://openrouter.ai/api/v1/auth/key', {
    headers: { Authorization: `Bearer ${apiKey}` },
  }),
  fetch('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${apiKey}` },
  }),
]);

const keyInfo = await keyRes.json();
const creditsInfo = await creditsRes.json();

console.log('Key info:', JSON.stringify(keyInfo, null, 2));
console.log('Credits:', JSON.stringify(creditsInfo, null, 2));