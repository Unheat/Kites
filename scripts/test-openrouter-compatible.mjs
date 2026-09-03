const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/free';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_SEGMENTS_PER_BATCH = 10;

const OCR_BLOCKS = [
  '22:48 0回',
  '然シ',
  '个',
  'CH Production',
  'ng chú',
  'Video',
  'Shorts',
  'Danh sách phát',
  'Mi nht',
  'Ph bin',
  'Cũ nht',
  'Khăp Xung Quanh - Thng & Chí Hùng 710 lưt xem · 3 gi trưc',
  'KHÄP XUNG OUANH',
  'Cá Hồi - Thng & Chí Hùng 9,9 N lưt xem · 2 ngày trưc',
  '0OO',
  'S',
  'CÃ HOI',
  'À i - Thng & Chí Hùng 10 N lưt xem · 3 gi trưc',
  'AOI',
  'Be Cool - Thng & Chí Hùng 15 N lưt xem · 4 ngày trưc',
  'BE COOL',
  'Cho Tôi Đi Theo - Thng & Chí Hùng 23 N lưt xem · 6 ngày trưc',
  'CHO TÔI DI THEO',
  'Không Làm Gì - Thng &',
  '十',
  'Trang ch',
  'Shorts',
  'Kênh đăng ký',
  'Bn',
];

/**
 * Masks sensitive response text while retaining enough information to diagnose protocol failures.
 *
 * @param {string} value - Value to redact.
 * @returns {string} Limited diagnostic preview.
 */
function preview(value) {
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 300);
}

/**
 * Sends one Kites-compatible delimiter batch to OpenRouter.
 *
 * @param {string[]} blocks - OCR strings in this batch.
 * @param {number} batchNumber - One-based batch index for diagnostics.
 * @param {string} apiKey - OpenRouter key.
 * @returns {Promise<string[]>} Translated delimiter-mapped lines.
 */
async function translateBatch(blocks, batchNumber, apiKey) {
  const taggedLines = blocks.map((text, index) => `<|${index + 1}|>${text}`).join('\n');
  const body = {
    model: MODEL,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: `Translate the following manga text lines from the detected source language to English. Keep the exact line number format (e.g. <|1|>, <|2|>) for every line. Do not add any conversational filler. Only output the translated lines.\n\n${taggedLines}`,
    }],
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kites.ai',
        'X-Title': 'Kites Manga Translator',
      },
      body: JSON.stringify(body),
    });
    const elapsedMs = performance.now() - startedAt;
    const rawText = await response.text();

    console.log(JSON.stringify({
      batchNumber,
      blocks: blocks.length,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      bodyPreview: preview(rawText),
    }, null, 2));

    if (!response.ok) throw new Error(`Batch ${batchNumber} failed with HTTP ${response.status}.`);
    const payload = JSON.parse(rawText);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error(`Batch ${batchNumber} did not contain choices[0].message.content.`);

    const lines = content.split(/<\|\d+\|>/).filter((line) => line.trim()).map((line) => line.trim());
    if (lines.length !== blocks.length) {
      throw new Error(`Batch ${batchNumber} expected ${blocks.length} delimiter-tagged translations, received ${lines.length}.`);
    }
    return lines;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Replays the exact OCR block set through Kites' sequential ten-line batching behavior.
 *
 * @returns {Promise<void>} Resolves after all batches complete.
 */
async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Set OPENROUTER_API_KEY before running this script. The key is never printed or saved.');
  }

  const totalStartedAt = performance.now();
  const translations = [];
  for (let offset = 0; offset < OCR_BLOCKS.length; offset += MAX_SEGMENTS_PER_BATCH) {
    const blocks = OCR_BLOCKS.slice(offset, offset + MAX_SEGMENTS_PER_BATCH);
    translations.push(...await translateBatch(blocks, Math.floor(offset / MAX_SEGMENTS_PER_BATCH) + 1, apiKey));
  }

  console.log(JSON.stringify({
    totalBlocks: OCR_BLOCKS.length,
    translatedBlocks: translations.length,
    totalElapsedMs: Number((performance.now() - totalStartedAt).toFixed(2)),
  }, null, 2));
}

main().catch((error) => {
  console.error('[OpenRouter diagnostic]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
