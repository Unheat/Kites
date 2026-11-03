# Contributing to Kites 🪁

Thank you for your interest in contributing to **Kites**! Whether you are fixing a bug, improving OCR dictionaries, optimizing inpainting shaders, tuning typesetting heuristics, or writing documentation, your help is warmly welcomed.

Kites is an open-source, local-first manga and comic translator built with **Manifest V3, React 19, TypeScript, WebGPU, and ONNX Runtime Web**.

---

## 🌟 Contributor Notice: Open to Contributions!

We actively encourage and welcome contributions from the community:
- 💡 **Feature Ideas & Discussion:** Open a [GitHub Discussion](https://github.com/Unheat/Kites/discussions) or issue to discuss new engines, UI improvements, or site support.
- 🐛 **Bug Reports:** If an image fails to translate, speech bubbles are clipped, or a site doesn't load controls, please submit an issue with a sample URL/screenshot.
- 🔤 **Language Dictionaries & Typography:** Help improve character recognition for Japanese Kanji, Korean Hangul, Chinese Hanzi, or Latin fonts.
- 🚀 **Pull Requests:** PRs of all sizes—from single-line bugfixes to major pipeline optimizations—are appreciated.

---

## 📚 Technical Documentation

Before diving into the code, please review our comprehensive architecture documentation:

- **[Documentation Hub](docs/README.md)** — Main entry point to Kites technical documentation.
- **[System Architecture](docs/architecture/overview.md)** — Chrome MV3 Service Worker, Content Scripts, WebGPU Offscreen Document, and IndexedDB persistence.
- **[Translation Pipeline & Algorithm Guide](docs/architecture/pipeline.md)** — Detailed breakdown of OCR detection, Kruskal-MST bubble grouping, neural inpainting, and binary-search typesetting.
- **[Interactive Pipeline Map (`workflow.html`)](docs/workflow.html)** — Standalone interactive visual workflow with pan/zoom and clickable node inspection.
- **[Development Setup Guide](docs/development/setup.md)** — Local environment prerequisites, build commands, and debugging flags.
- **[Testing Guide](docs/development/testing.md)** — Vitest unit tests, Puppeteer E2E tests, and visual model pipeline tests.
- **[Coding Standards & Invariants](docs/development/coding-standards.md)** — WebGPU memory invariants, defensive programming rules, and library workarounds.

---

## 🛠️ Quickstart: Setting Up for Development

### 1. Prerequisites
- **Node.js:** `22.14 LTS` (recommended via `nvm use`, or Node 20+)
- **npm:** `v10+`
- **Browser:** Google Chrome (or Chromium browser like Brave/Edge) with WebGPU hardware acceleration enabled.

### 2. Clone and Install
```bash
git clone https://github.com/Unheat/Kites.git
cd Kites

# Install exact dependencies
npm ci
```

### 3. Build the Extension
```bash
# Copies ONNX WASM binaries, runs TypeScript check, and builds with Vite
npm run build
```

### 4. Load Unpacked in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `dist/` directory generated in the project root.
5. The Kites icon will appear in your extension toolbar.

### 5. Running with Hot Reload (Dev Server)
```bash
npm run dev
```
*Note: Vite dev server runs at `localhost:5173`. When testing in-page content scripts and background messaging, load the generated extension in Chrome.*

---

## 🧪 Testing & Quality Gates

Before submitting a Pull Request, make sure all automated checks pass locally:

```bash
# 1. Syntax and safety linter
npm run lint

# 2. Automated unit test suite (Vitest)
npm test

# 3. Production build check (TypeScript + Vite)
npm run build
```

To run end-to-end browser tests:
```bash
# Launches Chromium and verifies translation on live web panels
npm run test:e2e
```

---

## 🌿 Branching & Commit Guidelines

### Branch Naming
- Features: `feat/short-description` (e.g., `feat/add-custom-font-preset`)
- Bug fixes: `fix/short-description` (e.g., `fix/bubble-split-overflow`)
- Documentation: `docs/short-description` (e.g., `docs/add-api-guide`)
- Maintenance: `chore/short-description`

### Commit Messages
We follow **Conventional Commits**:
- `feat(ocr): add support for PP-OCRv6 vertical crop homography`
- `fix(typeset): clamp minimum font size to 6px in narrow bubbles`
- `docs(readme): clarify WebGPU browser requirement`
- `test(inpaint): add regression tests for median color sampling`

*Note: Never use force flags (`git push -f`, `git add -f`) on public branches.*

---

## 🚀 Pull Request Process

1. **Verify your changes locally:**
   ```bash
   npm test          # Run automated unit tests
   npm run lint      # Run linter
   npm run build     # Verify TypeScript types and production bundle
   ```
   *(If modifying the translation worker, also run `npm run worker:test`)*
2. **Push your branch and open a PR** using the [Pull Request Template](.github/pull_request_template.md).
3. **Fill out the template completely:**
   - Include a brief summary of what changed and why.
   - Reference the issue number (`Closes #123`).
   - Detail the verification steps and attach screenshots/recordings for UI or layout changes.
4. **Confirm CI is green:** All automated checks in GitHub Actions must pass before review and merge.

---

## 📝 Pull Request Checklist

Before submitting for review, ensure:
- [ ] Follows project [Coding Standards](docs/development/coding-standards.md) (docstrings, named constants, defensive null checks).
- [ ] `npm test` passes with zero failures.
- [ ] `npm run lint` passes with zero errors.
- [ ] `npm run build` succeeds without TypeScript or bundling warnings.
- [ ] Preserves established library workarounds (Vite 8 config, popup RPC routing, LaMa cache reuse).
- [ ] PR description uses the [Pull Request Template](.github/pull_request_template.md).

---

## 💬 Getting Help

If you have questions or get stuck:
- Open an issue on [GitHub Issues](https://github.com/Unheat/Kites/issues).
- Check the [Development History Archive](docs/dev-history/) for past phase logs, research documents, and architecture decision context.

Thank you for making Kites better for comic readers everywhere! 🪁
