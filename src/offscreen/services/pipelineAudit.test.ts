import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPipelineAuditEnabled, logPipelineAudit, setPipelineAuditFlag } from './pipelineAudit';

describe('pipelineAudit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setPipelineAuditFlag(false);
  });

  it('classifies the stage that stopped each block', () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(String(line)));

    logPipelineAudit(42, [
      { index: 0, text: '站住！', preserved: false, score: 0.97, width: 40, height: 160, direction: 'v', sentText: '站住！', translatedText: 'Stop!' },
      { index: 1, text: '好嫩有大小头怎样', kind: 'display-lettering', preserved: true, score: 0.19, width: 167, height: 401, direction: 'v' },
      { index: 2, text: '本当', preserved: false, score: 0.8, width: 30, height: 60, direction: 'v', sentText: '本当' },
      { index: 3, text: 'はい', preserved: false, score: 0.9, width: 30, height: 60, direction: 'v', sentText: 'はい', translatedText: '' },
      { index: 4, text: 'はい', preserved: false, score: 0.9, width: 30, height: 60, direction: 'v', sentText: 'はい', translatedText: 'はい' },
    ]);

    const body = logged.slice(1);
    expect(body[0]).toContain('translated');
    expect(body[0]).toContain('out="Stop!"');
    expect(body[1]).toContain('preserved');
    expect(body[1]).toContain('display-lettering');
    expect(body[2]).toContain('empty-answer');
    expect(body[3]).toContain('empty-answer');
    expect(body[4]).toContain('echoed');
    // A preserved block is never reported as sent, even if the caller passed text anyway.
    expect(body[1]).not.toContain('out=');
  });

  it('follows the flag the background sent with the job', async () => {
    // The offscreen document has no chrome.storage (measured), so the flag rides on the job payload
    // and is recorded here before the pipeline runs.
    setPipelineAuditFlag(false);
    await expect(isPipelineAuditEnabled(false)).resolves.toBe(false);

    setPipelineAuditFlag(true);
    await expect(isPipelineAuditEnabled(false)).resolves.toBe(true);

    // A development build always audits, whatever the job said.
    setPipelineAuditFlag(false);
    await expect(isPipelineAuditEnabled(true)).resolves.toBe(true);
  });
});
