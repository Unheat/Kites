import { describe, it, expect } from 'vitest';
import { detectBcp47Language, detectNllbLanguage } from './languageDetector';

describe('languageDetector utility', () => {
  it('detects Japanese text using script heuristic when Chrome AI is unavailable', async () => {
    const textSample = ['こんにちは', 'これはテストです'];
    const detected = await detectBcp47Language(textSample);
    expect(detected).toBe('ja');

    const nllbCode = await detectNllbLanguage(textSample);
    expect(nllbCode).toBe('jpn_Jpan');
  });

  it('detects Korean text using script heuristic', async () => {
    const textSample = ['안녕하세요', '반갑습니다'];
    const detected = await detectBcp47Language(textSample);
    expect(detected).toBe('ko');

    const nllbCode = await detectNllbLanguage(textSample);
    expect(nllbCode).toBe('kor_Hang');
  });

  it('detects Chinese Hanzi text using script heuristic', async () => {
    const textSample = ['你好世界', '这里是测试'];
    const detected = await detectBcp47Language(textSample);
    expect(detected).toBe('zh-CN');

    const nllbCode = await detectNllbLanguage(textSample);
    expect(nllbCode).toBe('zho_Hans');
  });

  it('defaults to Japanese for Latin/empty inputs in comic context', async () => {
    const detected = await detectBcp47Language([]);
    expect(detected).toBe('ja');

    const nllbCode = await detectNllbLanguage([]);
    expect(nllbCode).toBe('jpn_Jpan');
  });
});
