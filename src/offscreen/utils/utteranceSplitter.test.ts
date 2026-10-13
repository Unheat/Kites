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
  });
});
