import { defineConfig } from 'vitest/config';

// Keep worker tests independent of the extension's CRX/Vite plugins and DOM setup.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
