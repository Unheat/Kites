import { useEffect } from 'react';
import { studioStore } from './studioStore';
import type { TextObject } from '../types';
import { loadHyphenationLanguage } from '../../offscreen/utils/hyphenation';
import { ensureFontsRegistered } from '../../shared/fontLibrary';
import { isLayoutStillPending, snapshotLayoutRecords, subscribeGeneratedLayouts, type LayoutRecord } from './layoutGenerations';
import { reflowTextObject } from '../canvas/studioTypeset';

/**
 * Re-flows the layouts captured in a snapshot, using the current store contents.
 *
 * Only objects that still carry exactly the snapshot layout are replaced. Because the
 * replacement spreads the live object, position, rotation, paint, visibility, and any
 * non-layout edits survive; edited resized objects and undo restores are left untouched.
 * No undo entry is created because this bypasses the undo stack entirely.
 *
 * @param snapshot - Layout records captured before the resource wait.
 * @returns Number of objects re-flowed.
 */
export function retryPendingLayouts(snapshot: Map<string, LayoutRecord>): number {
  const current = studioStore.getState().textObjects;
  const replacements = new Map<string, { source: TextObject; next: TextObject }>();
  for (const obj of current) {
    if (!isLayoutStillPending(obj, snapshot.get(obj.id))) continue;
    replacements.set(obj.id, { source: obj, next: reflowTextObject(obj, obj.typesetMode ?? 'balloon') });
  }
  if (replacements.size === 0) return 0;

  // Replace by object identity: if the store holds a different reference (edit, resize,
  // undo, or a second reflow) the live object wins and the retry is discarded.
  studioStore.setState((state) => ({
    textObjects: state.textObjects.map((obj) => {
      const candidate = replacements.get(obj.id);
      return candidate && candidate.source === obj ? candidate.next : obj;
    }),
  }));
  return replacements.size;
}

/**
 * Waits for hyphenation and font resources, then re-runs layout only for objects whose
 * lines were measured during the wait with the same layout inputs and payload.
 *
 * Non-blocking lifecycle: nothing runs on draws, selection, or pointer moves. Only one
 * awaited resource check runs per dependency change; failures end the retry explicitly
 * instead of looping. Retries never reset persisted/pipeline lines, never overwrite
 * newer edits, resizes, or undo restores, and never push undo entries.
 *
 * @param targetLang - Active job's translation language (hyphenation dictionary), if any.
 * @param ready - Optional extra dependency values; re-runs the check when they change.
 */
export function useLayoutReadiness(targetLang: string | undefined, ...ready: unknown[]): void {
  useEffect(() => {
    let cancelled = false;

    // Snapshot only objects whose lines this session generated (persisted rows have no
    // record and must keep their exact baked layout).
    const snapshot = snapshotLayoutRecords(studioStore.getState().textObjects);
    // Edits and legacy initialization can happen after this effect mounts. Track their
    // latest generated identity until both resources settle, without subscribing to draws.
    const manuallyResized = new Set<string>();
    const unsubscribe = subscribeGeneratedLayouts((object, record) => {
      const previous = snapshot.get(object.id);
      if (previous && (previous.width !== record.width || previous.height !== record.height)) {
        // A manual resize has its own layout/undo transaction. Never silently replace
        // that transaction when this older resource wait completes.
        manuallyResized.add(object.id);
        snapshot.delete(object.id);
      }
      if (!manuallyResized.has(object.id)) snapshot.set(object.id, record);
    });

    const settleAndRetry = async (): Promise<void> => {
      try {
        await Promise.all([
          loadHyphenationLanguage(targetLang ?? 'en'),
          ensureFontsRegistered(),
        ]);
      } catch (error) {
        // Boundary failure: stop retrying loudly instead of reflowing forever.
        console.error('[Studio] Layout resources failed to load; keeping current layout:', error);
        unsubscribe();
        return;
      }
      unsubscribe();
      // A job switch or unmount cancels the previous wait; never apply it to the new page.
      if (cancelled || snapshot.size === 0) return;
      retryPendingLayouts(snapshot);
    };

    void settleAndRetry();
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLang, ...ready]);
}