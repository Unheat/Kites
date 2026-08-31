import { describe, it, expect } from 'vitest';
import { detectBcp47Language } from './languageDetector';

describe('languageDetector utility', () => {
  it('detects Japanese text using script heuristic when Chrome AI is unavailable', async () => {
    await expect(detectBcp47Language(['こんにちは', 'これはテストです'])).resolves.toBe('ja');
  });

  it('detects Korean text using script heuristic', async () => {
    await expect(detectBcp47Language(['안녕하세요', '반갑습니다'])).resolves.toBe('ko');
  });

  it('detects Chinese Hanzi text using script heuristic', async () => {
    await expect(detectBcp47Language(['你好世界', '这里是测试'])).resolves.toBe('zh-CN');
  });

  it('defaults to Japanese for empty comic OCR input', async () => {
    await expect(detectBcp47Language([])).resolves.toBe('ja');
  });
});
