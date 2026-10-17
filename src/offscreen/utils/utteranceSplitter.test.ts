import { describe, it, expect } from 'vitest';
import {
  clusterLinesIntoUtterances,
  endsWithTerminalPunctuation,
  type InputLine
} from './utteranceSplitter';

describe('utteranceSplitter', () => {
  describe('endsWithTerminalPunctuation', () => {
    it('detects CJK and ASCII terminal punctuation', () => {
      expect(endsWithTerminalPunctuation('可恶…')).toBe(true);
      expect(endsWithTerminalPunctuation('敌人太强了…!')).toBe(true);
      expect(endsWithTerminalPunctuation('不行！')).toBe(true);
      expect(endsWithTerminalPunctuation('なんだ…')).toBe(true);
      expect(endsWithTerminalPunctuation('Hello world.')).toBe(false);
      expect(endsWithTerminalPunctuation('こんにちは')).toBe(false);
    });
  });

  describe('clusterLinesIntoUtterances', () => {
    it('returns single line unchanged', () => {
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 50 },
            { x: 10, y: 50 }
          ],
          text: 'こんにちは'
        }
      ];
      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1);
    });

    it('splits staggered double-box utterances with terminal punctuation (User Image 2)', () => {
      // Line 1: '可恶…' at (x: 100..125, y: 50..100) -> ends with '…'
      // Line 2: '敌人太强了…!' staggered at (x: 50..75, y: 120..220)
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 100, y: 50 },
            { x: 125, y: 50 },
            { x: 125, y: 100 },
            { x: 100, y: 100 }
          ],
          text: '可恶…'
        },
        {
          id: 1,
          polygon: [
            { x: 50, y: 120 },
            { x: 75, y: 120 },
            { x: 75, y: 220 },
            { x: 50, y: 220 }
          ],
          text: '敌人太强了…!'
        }
      ];

      // Vertical CJK reading
      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(2);
      expect(result[0][0].text).toBe('可恶…');
      expect(result[1][0].text).toBe('敌人太强了…!');
    });

    it('preserves unified multi-column bubble when lines are continuous without gaps', () => {
      // Two adjacent vertical columns of the same sentence
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 80, y: 50 },
            { x: 100, y: 50 },
            { x: 100, y: 120 },
            { x: 80, y: 120 }
          ],
          text: '今日はとても良い' // "Today is very good"
        },
        {
          id: 1,
          polygon: [
            { x: 55, y: 50 },
            { x: 75, y: 50 },
            { x: 75, y: 120 },
            { x: 55, y: 120 }
          ],
          text: '天気ですね' // "weather, isn't it"
        }
      ];

      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(2);
    });

    it('splits horizontal paragraphs separated by substantial vertical gap', () => {
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 10, y: 20 },
            { x: 120, y: 20 },
            { x: 120, y: 40 },
            { x: 10, y: 40 }
          ],
          text: '第一段落の内容です。'
        },
        {
          id: 1,
          polygon: [
            { x: 10, y: 80 }, // Gap of 40px (> 1.1x line height)
            { x: 120, y: 80 },
            { x: 120, y: 100 },
            { x: 10, y: 100 }
          ],
          text: '第二段落の内容です。'
        }
      ];

      const result = clusterLinesIntoUtterances(lines, true, false);
      expect(result).toHaveLength(2);
    });

    it('splits staggered multi-box continuous sentence without terminal punctuation (user image)', () => {
      // Top-right box: 3 columns, ending with '聞かせられる' (hiragana 'る', no terminal punctuation)
      // Bottom-left box: 2 columns, starting with '特権が' shifted down by 190px
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 250, y: 160 },
            { x: 275, y: 160 },
            { x: 275, y: 280 },
            { x: 250, y: 280 }
          ],
          text: 'なんでも'
        },
        {
          id: 1,
          polygon: [
            { x: 215, y: 160 },
            { x: 240, y: 160 },
            { x: 240, y: 440 },
            { x: 215, y: 440 }
          ],
          text: '言うことを'
        },
        {
          id: 2,
          polygon: [
            { x: 180, y: 160 },
            { x: 205, y: 160 },
            { x: 205, y: 500 },
            { x: 180, y: 500 }
          ],
          text: '聞かせられる' // ends with 'る' -> no terminal punctuation!
        },
        {
          id: 3,
          polygon: [
            { x: 145, y: 350 },
            { x: 170, y: 350 },
            { x: 170, y: 500 },
            { x: 145, y: 500 }
          ],
          text: '特権が'
        },
        {
          id: 4,
          polygon: [
            { x: 110, y: 350 },
            { x: 135, y: 350 },
            { x: 135, y: 920 },
            { x: 110, y: 920 }
          ],
          text: '与えられるから困るんだよ' // pure plain text, no punctuation
        }
      ];

      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(2);
      // First box
      expect(result[0].map((l) => l.text)).toEqual(['なんでも', '言うことを', '聞かせられる']);
      // Second box
      expect(result[1].map((l) => l.text)).toEqual(['特権が', '与えられるから困るんだよ']);
    });

    it('preserves single bubble with top-aligned short column next to long column (pure plain text, no punctuation)', () => {
      // Column 1 (right): '逆らえる' (4 chars, top-aligned: y: 100..220)
      // Column 2 (left): 'わけがないじゃないか本当に' (13 chars, top-aligned: y: 100..550, pure plain text)
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 80, y: 100 },
            { x: 105, y: 100 },
            { x: 105, y: 220 },
            { x: 80, y: 220 }
          ],
          text: '逆らえる'
        },
        {
          id: 1,
          polygon: [
            { x: 50, y: 100 },
            { x: 75, y: 100 },
            { x: 75, y: 550 },
            { x: 50, y: 550 }
          ],
          text: 'わけがないじゃないか本当に'
        }
      ];

      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(2);
      expect(result[0].map((l) => l.text)).toEqual(['逆らえる', 'わけがないじゃないか本当に']);
    });

    it('preserves single oval bubble with uneven line lengths (guards against false positive splits)', () => {
      // Normal oval bubble where middle line is tall and side lines are short and centered vertically
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 80, y: 140 },
            { x: 100, y: 140 },
            { x: 100, y: 215 },
            { x: 80, y: 215 }
          ],
          text: 'なんだ' // 3 chars
        },
        {
          id: 1,
          polygon: [
            { x: 55, y: 65 },
            { x: 75, y: 65 },
            { x: 75, y: 290 },
            { x: 55, y: 290 }
          ],
          text: 'そんなこと言われても困る' // 9 chars
        },
        {
          id: 2,
          polygon: [
            { x: 30, y: 130 },
            { x: 50, y: 130 },
            { x: 50, y: 230 },
            { x: 30, y: 230 }
          ],
          text: 'わけだし' // 4 chars
        }
      ];

      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(3);
    });

    it('splits upward box translation across staggered dialogue boxes', () => {
      // Reading R-to-L: first box is bottom-right (y: 300..450), second box is top-left (y: 100..250)
      const lines: InputLine[] = [
        {
          id: 0,
          polygon: [
            { x: 120, y: 300 },
            { x: 145, y: 300 },
            { x: 145, y: 450 },
            { x: 120, y: 450 }
          ],
          text: '下側のセリフ'
        },
        {
          id: 1,
          polygon: [
            { x: 50, y: 100 },
            { x: 75, y: 100 },
            { x: 75, y: 250 },
            { x: 50, y: 250 }
          ],
          text: '上側に続くセリフ'
        }
      ];

      const result = clusterLinesIntoUtterances(lines, true, true);
      expect(result).toHaveLength(2);
      expect(result[0][0].text).toBe('下側のセリフ');
      expect(result[1][0].text).toBe('上側に続くセリフ');
    });
  });
});
