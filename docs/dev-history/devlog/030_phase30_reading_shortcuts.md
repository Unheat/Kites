# Devlog 030 --- Reading Shortcuts: Keyboard Commands for Translation Workflow

**Date:** 2026-10-13
**Status:** Implemented and integrated on `feat/in-page-reading-shortcuts`, stacked above the glossary branch. Helper tests, source suite, production build, and popup preview verification are recorded below; native extension-command delivery remains a manual browser QA boundary.

---

## Problem

Kites had no keyboard shortcuts. Users relied exclusively on mouse hover and click to trigger translations or toggle originals. Power readers working through dozens of manga pages needed faster ergonomics: one key to translate the hovered panel, one key to start area crop, and one key to flip between original and translated artwork without touching the mouse button.

---

## Design Decisions

### Command Shortcuts (Manifest)

Two Chrome extension commands registered in `manifest.json`:

| Command                  | Default Key       | Content Message           |
|--------------------------|-------------------|---------------------------|
| `translate-hovered-image`| `Alt+Shift+Z`     | `TRANSLATE_HOVERED_IMAGE` |
| `start-screen-crop`      | `Alt+Shift+X`     | `START_AREA_SELECTION`    |

These defaults use Chrome-supported `Alt` + `Shift` + letter combinations. Chrome does not require `Alt` specifically: extension shortcuts must include `Ctrl` or `Alt` (with platform-specific mappings), while `Shift` is optional. Users can reassign the two command combinations at `chrome://extensions/shortcuts`; the content-side unmodified F key is fixed and is not listed there.

### Content Reading Helper Key

**Chosen key: F (unmodified)**. Rationale:

- **Space rejected**: would steal page scrolling on every translated-image hover, breaking fundamental browser UX. Manga readers scroll constantly; hijacking Space would be a usability disaster.
- **F is reachable**: the key sits under the left index finger, giving readers a single-key toggle. Page-specific F bindings can still conflict; the helper respects `defaultPrevented` but cannot guarantee that every reader leaves F unused.
- **Context-gated activation**: F only fires when all conditions are met simultaneously (translated image hovered, extension enabled, not busy, no editable ancestor). Outside that context, the helper leaves the event untouched.

### Guard Chain (Content-Side F Key)

The `matchesReadingToggle` function applies a strict filter chain before `handleReadingKeydown` acts:

1. **Exact key match**: `event.key.toLowerCase() === 'f'` (covers Caps Lock)
2. **No modifiers**: `!altKey && !ctrlKey && !metaKey && !shiftKey`
3. **No repeats**: `!event.repeat`
4. **Not pre-consumed**: `!event.defaultPrevented`
5. **Not composing**: `!event.isComposing` (IME input)
6. **No editable ancestor**: walks `event.composedPath()` plus shadow-root hosts checking `INPUT`, `TEXTAREA`, `SELECT`, `contenteditable` (excluding explicit `contenteditable="false"`).
7. **State gates**: extension enabled, not busy translating, a hovered target exists, and that target has a translated record.

Only after all 7 gates pass does the handler call `toggleOriginal(target)` and `event.preventDefault()`.

### Architecture: No New Pipeline

Reading shortcuts reuse existing content-script state and callbacks:

- **Commands path**: `chrome.commands.onCommand` in background routes to `tabs.sendMessage(tabId, message, { frameId: 0 })`. Content script's existing `onMessage` listener receives `TRANSLATE_HOVERED_IMAGE` (mapped to `requestTranslation`) or `START_AREA_SELECTION` (mapped to `setIsSnipping(true)`).
- **F key path**: `handleReadingKeydown` calls `toggleOriginal(target)` which maps directly to the existing `toggleImageDisplay(target, !currentShowOriginal)`.

No new translation logic, no new message types, no new state management. The reading module is a thin dispatch layer over existing functions.

### Backend Command Router

`src/background/readingCommands.ts` owns the `chrome.commands` registration independently:

- `readingCommandMessage(command)`: maps manifest names to content message vocabulary, returns null for unknown commands.
- `routeReadingCommand(command, api)`: queries active tab, sends to `frameId: 0` (top frame only; crop UI must open once). Gracefully handles missing tabs, restricted pages, and extension invalidation.
- `registerReadingCommands(api)`: synchronous one-liner for service-worker init.

The API surface is injectable for testing: `ReadingCommandsApi` accepts mock Chrome objects without the full `chrome` global.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/content/readingShortcuts.ts` | Content-side F-key matching + command dispatch (generic over target type) |
| `src/content/readingShortcuts.test.ts` | 40 tests: key matching, editable exclusion, shadow DOM, state gates |
| `src/background/readingCommands.ts` | Background command router with injectable Chrome API |
| `src/background/readingCommands.test.ts` | 18 tests: command mapping, tab routing, error handling |
| `src/popup/components/ReadingShortcutsHelp.tsx` | Collapsible shortcut reference card for popup settings; native button with `aria-expanded`, stable `useId`/`aria-controls` target, hidden collapsed content, defined paper keycap color token, and explicit command-only configurability |

## Files Modified

| File | Change |
|------|--------|
| `manifest.json` | Added `commands` block with two shortcuts |

---

## Integration Design and Implemented Wiring

### 1. `src/background/index.ts` --- Add Import and Startup Registration

The coordinator added this after the glossary commit. Registration runs synchronously at module scope, not inside an asynchronous startup callback or `onInstalled`, so the service worker can receive commands after waking.

```typescript
import { registerReadingCommands } from './readingCommands';
// At top-level (service-worker init):
registerReadingCommands();
```

### 2. `src/content/index.tsx` --- Wire Reading Shortcuts into GlobalOverlay

Inside `GlobalOverlay()`, the coordinator wired the helper to the existing event/message lifecycle. Pointer tracking works in both Hover and Persistent modes; each dispatch resolves media at the latest live cursor instead of trusting `activeImgRef.current`. Leaving the document clears the pointer. The page-scoped translated registry supplies only current-document records. The original callback sketch below remains as design history, not paste-ready code; the actual implementation uses `MediaTarget` and the live cursor resolver.

Additional integration requirements:

- Read current enablement and busy state at dispatch time; busy includes translation, snipping, and crop activity.
- Synchronize the existing `TranslateButton` local original/translated display state after `toggleImageDisplay` changes the registry and DOM. Otherwise an F toggle leaves the button label stale; the main integration will use a small display-change event subscription.
- Use only one handling path for `START_AREA_SELECTION`, preserving the enabled/busy guards. Adding a second listener beside the existing crop listener can run the action twice or bypass those guards.
- Do not return `handleReadingCommand`'s recognition boolean directly from a Chrome runtime listener. `true` has a separate Chrome meaning: it keeps the response channel open for an asynchronous `sendResponse`. A side-effect-only listener should return nothing unless it intentionally responds.

Original callback-shape sketch (replace its target/busy lookup and merge its command branch into the existing listener as described above):

```typescript
import { handleReadingKeydown, handleReadingCommand, type ReadingShortcutActions } from './readingShortcuts';

// Inside GlobalOverlay, after existing useEffect hooks:
useEffect(() => {
  if (!isEnabled) return;

  const actions: ReadingShortcutActions<OverlayImage> = {
    getContext: () => ({
      enabled: isEnabled,
      busy: translatingUrlsRef.current.size > 0,
      target: activeImgRef.current,
    }),
    hasTranslation: (target) => translatedRegistry.has(target.srcUrl),
    toggleOriginal: (target) => {
      const record = translatedRegistry.get(target.srcUrl);
      if (record) toggleImageDisplay(target, !record.showOriginal);
    },
    translate: (target) => requestTranslation(target.srcUrl, target),
    startAreaSelection: () => setIsSnipping(true),
  };

  const onKeydown = (event: KeyboardEvent) => handleReadingKeydown(event, actions);
  document.addEventListener('keydown', onKeydown);

  const onMessage = (message: unknown) => { handleReadingCommand(message, actions); };
  chrome.runtime.onMessage.addListener(onMessage);

  return () => {
    document.removeEventListener('keydown', onKeydown);
    chrome.runtime.onMessage.removeListener(onMessage);
  };
}, [isEnabled]);
```

**Note**: The existing `handleMessage` listener already handles `START_AREA_SELECTION`. Route that message through one guarded branch, not both the existing handler and a new listener; a no-op callback in the helper does not guard an independent legacy handler. The command router sends to `frameId: 0` only, so `all_frames` children will not receive these commands. The `TRANSLATE_HOVERED_IMAGE` message is new and must be caught by the integrated reading command branch.

### 3. `src/popup/components/SettingsView.tsx` --- Add Help Panel

```typescript
import ReadingShortcutsHelp from './ReadingShortcutsHelp';

// Inside the return JSX, after the History Retention div:
<ReadingShortcutsHelp />
```

---

## Test Results

```
Command: node_modules/.bin/vitest run --root /Users/dangtruongan/study/Kites src/background/readingCommands.test.ts src/content/readingShortcuts.test.ts

 ✓ src/background/readingCommands.test.ts (18 tests) 7ms
 ✓ src/content/readingShortcuts.test.ts (40 tests) 16ms

 Test Files  2 passed (2)
      Tests  58 passed (58)
   Duration  804ms
```

Follow-up checks:

- Targeted Oxlint across the help component and four helper/test files: 0 warnings, 0 errors.
- `ReadingShortcutsHelp` static-render smoke: 9 assertions passed for a stable controls target, collapsed `aria-expanded`/`hidden` state, explicit button type, defined paper token, and configurable-command/fixed-F copy. The standalone TSX harness supplied React explicitly because it does not use Vite's automatic JSX transform.
- `git diff --check`: passed.
- The coordinator completed background registration, live-target content wiring, one guarded crop-command path, display-change synchronization, and popup help placement. No helper behavior changes were needed after review and the focused tests.
- Native Chrome command delivery requires an extension-capable browser; the available in-app preview verifies popup interaction/layout, not extension installation or OS shortcut dispatch.

References checked for this follow-up: [WAI-ARIA disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) and [Chrome Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands).
