import { beforeEach, describe, expect, it } from 'vitest';
import type { TextObject } from '../types';
import {
  isLayoutStillPending,
  layoutFingerprint,
  recordGeneratedLayout,
  resetLayoutRecordsForTests,
  snapshotLayoutRecords,
} from './layoutGenerations';

const baseObject = (overrides: Partial<TextObject> = {}): TextObject => ({
  id: 'bubble-1',
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  text: 'Hello world from Studio',
  lines: ['Hello world', 'from Studio'],
  fontSize: 16,
  fontFamily: 'sans-serif',
  color: '#000000',
  ...overrides,
});

describe('Studio layout generation tracking', () => {
  beforeEach(() => resetLayoutRecordsForTests());

  it('excludes paint, selection, and position from the invalidation fingerprint', () => {
    const obj = baseObject();
    expect(layoutFingerprint({ ...obj, x: 500, y: -40 })).toBe(layoutFingerprint(obj));
    expect(layoutFingerprint({ ...obj, color: '#ff0000', isVisible: false })).toBe(layoutFingerprint(obj));
  });

  it('includes text, metrics, and box dimensions in the fingerprint', () => {
    const obj = baseObject();
    expect(layoutFingerprint({ ...obj, text: 'Changed' })).not.toBe(layoutFingerprint(obj));
    expect(layoutFingerprint({ ...obj, fontSize: 24 })).not.toBe(layoutFingerprint(obj));
    expect(layoutFingerprint({ ...obj, width: 260 })).not.toBe(layoutFingerprint(obj));
    expect(layoutFingerprint({ ...obj, targetLang: 'de' })).not.toBe(layoutFingerprint(obj));
  });

  it('keeps a moved object pending so readiness can retry it without losing the move', () => {
    const generated = baseObject();
    recordGeneratedLayout(generated);
    const snapshot = snapshotLayoutRecords([generated]);

    const moved = { ...generated, x: 999, y: 111 };
    expect(isLayoutStillPending(moved, snapshot.get(moved.id))).toBe(true);
  });

  it('rejects a manually resized object after the snapshot', () => {
    const generated = baseObject();
    recordGeneratedLayout(generated);
    const snapshot = snapshotLayoutRecords([generated]);

    const resized = { ...generated, width: 420 };
    expect(isLayoutStillPending(resized, snapshot.get(resized.id))).toBe(false);
  });

  it('rejects undo/restore that swaps in older lines with identical layout inputs', () => {
    const generated = baseObject();
    recordGeneratedLayout(generated);
    const snapshot = snapshotLayoutRecords([generated]);

    const olderPreLoadLayout = { ...generated, lines: ['Hello world from', 'Studio'] };
    expect(isLayoutStillPending(olderPreLoadLayout, snapshot.get(olderPreLoadLayout.id))).toBe(false);
  });

  it('rejects objects re-flowed a second time after the snapshot', () => {
    const generated = baseObject();
    recordGeneratedLayout(generated);
    const snapshot = snapshotLayoutRecords([generated]);

    const reflowed = { ...generated, lines: ['Hello', 'world from', 'Studio'] };
    recordGeneratedLayout(reflowed);
    expect(isLayoutStillPending(reflowed, snapshot.get(reflowed.id))).toBe(false);
  });

  it('ignores persisted/pipeline objects that have no generation record', () => {
    const persisted = baseObject();
    const snapshot = snapshotLayoutRecords([persisted]);
    expect(snapshot.size).toBe(0);
    expect(isLayoutStillPending(persisted, snapshot.get(persisted.id))).toBe(false);
  });

  it('does not confuse restored persisted lines with a generated layout sharing the same id', () => {
    const generated = baseObject();
    recordGeneratedLayout(generated);
    const persisted = { ...generated, lines: [...generated.lines!] };
    expect(snapshotLayoutRecords([persisted]).size).toBe(0);
  });
});
