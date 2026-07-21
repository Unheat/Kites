import { vi } from 'vitest';

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
    }
  },
  offscreen: {
    hasDocument: vi.fn().mockResolvedValue(false),
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: { WORKERS: 'WORKERS' }
  }
});
