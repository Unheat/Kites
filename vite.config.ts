/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import manifest from './manifest.json' with { type: 'json' }

import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      external: [
        'ppu-paddle-ocr/node',
        '@napi-rs/canvas',
        '@napi-rs/canvas-darwin-arm64'
      ],
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        popup: resolve(__dirname, 'popup.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**', 
      '**/dist/**', 
      '**/docs/reference/**'
    ]
  }
})
