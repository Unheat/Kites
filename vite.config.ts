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
    // WORKAROUND: @crxjs/vite-plugin 2.7.1 only discovers extra extension
    // entries from build.rollupOptions during serve. Explicit entries prevent Vite 8
    // from discovering dependencies after Chrome starts the MV3 worker, which can
    // return 504 Outdated Optimize Dep and abort service-worker registration.
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
      // WORKAROUND: Keep deprecated rollupOptions until CRXJS reads Vite 8's
      // rolldownOptions in its raw config hook. Vite 8 aliases this internally.
      // Native Node dependencies must stay external so Rolldown never parses .node
      // binaries or bundles ppu-paddle-ocr's desktop/OpenCV fallback.
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
        '**/docs/reference/**',
        '**/scratches/**'
      ],
      setupFiles: ['./test.setup.ts']
    }
  }
})
