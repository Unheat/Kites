import { vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { HyphenationService } from './src/offscreen/utils/hyphenation/HyphenationService';

// Provide filesystem dictionary loader for Vitest Node runner without polluting browser bundle
HyphenationService.setCustomLoader(async (dictName: string) => {
  const candidatePaths = [
    path.resolve(process.cwd(), 'public/assets/hyphenation', `${dictName}.txt`),
    path.resolve(process.cwd(), 'dist/assets/hyphenation', `${dictName}.txt`),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return null;
});

vi.stubGlobal('chrome', {
  runtime: {
    getURL: vi.fn((path) => `mock-url-${path}`),
    sendMessage: vi.fn().mockImplementation((msg, callback) => {
      if (callback) callback({ popupState: {} });
      return Promise.resolve();
    }),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    }
  },
  offscreen: {
    hasDocument: vi.fn().mockResolvedValue(false),
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: { WORKERS: 'WORKERS' }
  }
});
