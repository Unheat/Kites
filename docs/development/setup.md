# Development Environment & Setup Guide 🛠️

This guide walks you through setting up your local environment to develop, build, and debug **Kites**.

---

## 💻 Prerequisites

| Requirement | Recommended Version | Notes |
| :--- | :--- | :--- |
| **Node.js** | **`v22.14.0 LTS`** | Pinned in `.nvmrc`. Node 20.19+ or 22.12+ is required by Vite 8. |
| **npm** | `v10.x` or later | Bundled with Node.js. |
| **Chromium Browser** | Latest Google Chrome / Brave / Edge | Must support Manifest V3 and WebGPU. |
| **Operating System** | macOS (Apple Silicon/Intel), Linux, Windows 11 | GPU hardware acceleration required for WebGPU tests. |

---

## 🚀 Step-by-Step Installation

### 1. Clone the Repository
```bash
git clone https://github.com/Unheat/Kites.git
cd Kites
```

### 2. Node.js Version Check
If you use `nvm` (Node Version Manager):
```bash
nvm use
```
Or verify manually:
```bash
node -v  # Should output v22.14.0 or compatible
```

### 3. Install Dependencies
Always use `npm ci` to guarantee identical dependency trees from `package-lock.json`:
```bash
npm ci
```

### 4. Build Extension Artifacts
Building the extension runs the WASM copy step, TypeScript type-check, and Vite/Rolldown compilation:
```bash
npm run build
```
The compiled, ready-to-load extension will be located in the `dist/` directory.

---

## 🔌 Loading the Extension into Chrome

1. Open your Chromium browser and go to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the `dist/` directory inside your cloned `Kites` project folder.
5. You should now see **Kites: Local-First Manga Translator** in your extension list!
6. Click the extension puzzle piece in the toolbar and pin **Kites**.

---

## ⚡ Enabling WebGPU Hardware Acceleration

To run local ONNX Runtime Web and WebLLM models on your GPU:

1. Open `chrome://flags/` in your browser.
2. Search for:
   - **`#enable-unsafe-webgpu`** $\to$ Set to **Enabled**.
   - **`#enable-webgpu-developer-features`** $\to$ Set to **Enabled** (useful for shader debugging).
3. Relaunch your browser.
4. Verify WebGPU status by navigating to `chrome://gpu/` and confirming **WebGPU: Hardware accelerated**.

---

## 🔄 Daily Development Workflow

### Starting the Vite Dev Server
```bash
npm run dev
```
- Starts the Vite server at `http://localhost:5173/`.
- Hot Module Replacement (HMR) will update UI files in `src/popup/` and `src/App.tsx`.
- **Note on Extension Reloading:** Whenever you modify files in `src/background/` or `src/content/`, click the 🔄 **Refresh icon** on the Kites card in `chrome://extensions/` to reload the extension context in Chrome.

### Running Quick Quality Checks
```bash
# Check code syntax and rules with Oxlint
npm run lint

# Run Vitest automated test suite
npm test
```

---

## ☁️ (Optional) Cloudflare Shared Pool Backend

If you want to test or run the multi-provider community fallback pool:

```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars

# Fill in your test provider API keys in .dev.vars
npm run dev
```
For production deployment notes, see [`worker/WAF_RULES.md`](../../worker/WAF_RULES.md).
