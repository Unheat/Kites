import type { TextObject } from '../types';

/** A generated layout's exact identity and measured inputs, independent of paint/move edits. */
export interface LayoutRecord {
  generation: number;
  width: number;
  height: number;
  fingerprint: string;
  lines: string[];
  positionedLines: TextObject['positionedLines'];
}

/** Weak keys prevent persisted rows with reused ids and undo copies from looking generated. */
let layoutRecords = new WeakMap<string[], LayoutRecord>();
let generation = 0;
const listeners = new Set<(object: TextObject, record: LayoutRecord) => void>();

/**
 * Fingerprints measured inputs only; moves, rotation, paint and selection are not layout.
 * @param object - Current text object.
 * @returns Stable input signature for resource-ready retries.
 */
export function layoutFingerprint(object: TextObject): string {
  return JSON.stringify([
    object.text, object.textFromGeneratedLines, object.fontFamily, object.fontSize,
    object.bold, object.italic, object.uppercase, object.lowercase,
    object.width, object.height, object.letterSpacing, object.lineSpacing,
    object.isVertical, object.direction, object.targetLang, object.borderRadius,
    object.contourPoints, object.typesetMode, object.roundFit,
    (object.charStyles ?? []).map((style) =>
      style ? [style.bold, style.italic, style.fontFamily, style.fontSize] : null),
  ]);
}

/**
 * Records freshly generated lines and notifies only active resource waits.
 * @param object - Completed layout object; persisted lines never call this function.
 * @returns Nothing.
 */
export function recordGeneratedLayout(object: TextObject): void {
  if (!object.lines) return;
  const record: LayoutRecord = {
    generation: ++generation,
    width: object.width,
    height: object.height,
    fingerprint: layoutFingerprint(object),
    lines: object.lines,
    positionedLines: object.positionedLines,
  };
  layoutRecords.set(object.lines, record);
  listeners.forEach((listener) => listener(object, record));
}

/**
 * Listens for new layouts only while resource loading is pending; no draw subscriptions.
 * @param listener - Receives new layout and immutable fingerprint record.
 * @returns Cleanup function that detaches the listener.
 */
export function subscribeGeneratedLayouts(listener: (object: TextObject, record: LayoutRecord) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Snapshots generated identities currently mounted; baked/persisted rows stay excluded.
 * @param objects - Current page objects.
 * @returns Latest generated record for each current object id.
 */
export function snapshotLayoutRecords(objects: readonly TextObject[]): Map<string, LayoutRecord> {
  const snapshot = new Map<string, LayoutRecord>();
  for (const object of objects) {
    const record = object.lines ? layoutRecords.get(object.lines) : undefined;
    if (record && isLayoutStillPending(object, record)) snapshot.set(object.id, record);
  }
  return snapshot;
}

/**
 * Checks exact line/placement identities and text/metric inputs before replacing layout.
 * @param object - Live object (possibly moved, resized, deleted/recreated, or undone).
 * @param snapshot - Latest generation observed during this resource wait.
 * @returns True only when the live object still carries that generated layout.
 */
export function isLayoutStillPending(object: TextObject, snapshot: LayoutRecord | undefined): boolean {
  return Boolean(snapshot && object.lines === snapshot.lines &&
    object.positionedLines === snapshot.positionedLines &&
    layoutFingerprint(object) === snapshot.fingerprint);
}

/**
 * Clears weak generation records between isolated tests.
 * @returns Nothing.
 */
export function resetLayoutRecordsForTests(): void {
  layoutRecords = new WeakMap();
  generation = 0;
}
