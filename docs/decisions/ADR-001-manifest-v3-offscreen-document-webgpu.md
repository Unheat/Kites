# ADR-001: Persistent Offscreen Document for WebGPU & AI Runtimes

## Status
Accepted

## Context
Chrome Extensions running Manifest V3 (MV3) enforce strict runtime constraints:
1. **Ephemeral Background Service Workers:** Service workers are terminated by Chromium when idle or after long-running tasks exceed 30 seconds.
2. **Missing Web APIs in Service Workers:** Service workers lack DOM access (`document`, `HTMLCanvasElement`, `createImageBitmap` in older versions) and cannot reliably acquire WebGPU adapters across all operating systems.
3. **Hardware-Accelerated AI Requirements:** Kites requires persistent memory contexts for:
   - ONNX Runtime Web WebGPU JSEP shaders (PaddleOCR, LaMa Manga, AOT-GAN).
   - MLC WebLLM KV-cache buffers and WebGPU shaders.
   - 2D Canvas operations (perspective warping, bicubic scaling, font measurement).

A terminated worker during a 5-second neural inference run drops user translation jobs and corrupts in-flight WebGPU device buffers.

## Decision
Run all AI models, computer vision pipelines, and Canvas operations inside an **Offscreen Document** (`chrome.offscreen.createDocument`) under the `BLOBS` and `WORKERS` reasons.

The Offscreen Document acts as a dedicated computational sandbox:
- Maintains persistent WebGPU and WebAssembly runtime sessions.
- Listens for explicit RPC messages (`target: 'offscreen', source: 'background', request: true`).
- Dispatches periodic lightweight pings (`OFFSCREEN_PING`) to confirm liveness.
- Communicates completed translation plates back to the background worker via `chrome.runtime.sendMessage`.

## Consequences
### Positive
- **Un-throttled Execution:** Long neural inference runs (10–30s for large batches or slow GPUs) run to completion without worker termination.
- **Full DOM & Canvas Access:** Offscreen Canvas, custom `@font-face` font loading, and pixel-level image processing execute natively.
- **Single Process Isolation:** Heavy model memory and WebGPU allocations are isolated from the user's active webpage tabs and background extension logic.

### Trade-offs
- **Inter-Process Communication Overhead:** Image buffers and text arrays must be passed via Chrome's message bus (serialized as Blobs or ArrayBuffers).
- **Explicit RPC Discipline:** Requires strict message targeting (`target`, `source`, `request`) to prevent broadcast message collisions.

## Alternatives Considered
- **Web Workers inside Service Worker:** Rejected because Chrome MV3 Service Workers cannot spawn persistent nested dedicated workers with reliable WebGPU contexts.
- **Direct Content Script Execution:** Rejected because loading heavy 100MB+ model weights into every visited webpage tab severely degrades browser performance, risks DOM tampering by malicious scripts, and triggers strict site Content Security Policy (CSP) errors.
