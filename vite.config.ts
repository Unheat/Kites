/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import manifest from './manifest.json' with { type: 'json' }

import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
  return {
    server: {
      port: 5173,
      strictPort: true
    },
    plugins: [
      react(),
      tailwindcss(),
      crx({ manifest }),
    ],
    optimizeDeps: {
      entries: [
        'popup.html',
        'index.html',
        'src/offscreen/offscreen.html',
        'src/content/index.tsx',
        'src/background/index.ts',
      ],
      exclude: [
        '@napi-rs/canvas',
        '@napi-rs/canvas-darwin-arm64',
        'canvas',
        'ppu-paddle-ocr',
        'onnxruntime-node'
      ]
    },
    build: {
      minify: isProd,
      modulePreload: false,
      rollupOptions: {
        external: [
          'ppu-paddle-ocr',
          'ppu-paddle-ocr/node',
          '@napi-rs/canvas',
          '@napi-rs/canvas-darwin-arm64',
          'canvas',
          'onnxruntime-node'
        ],
        input: {
          offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
          popup: resolve(__dirname, 'popup.html'),
          dashboard: resolve(__dirname, 'index.html'),
        },
      },
    },
    test: {
      environment: 'jsdom',
      exclude: [
        '**/node_modules/**', 
        '**/dist/**', 
        '**/docs/reference/**'
      ],
      setupFiles: ['./test.setup.ts']
    }
  }
})
