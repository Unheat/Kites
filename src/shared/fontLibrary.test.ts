import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCatalogFont, sha256Hex } from './fontLibrary';
import { FONT_CATALOG, type FontCatalogEntry } from './fontCatalog';

// db is stubbed: the service must persist through db.fonts.put and register in-document.
const putMock = vi.fn(async (record: unknown) => record);
vi.mock('../db', () => ({
  db: {
    fonts: {
      put: (record: unknown) => putMock(record),
      get: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn(async () => []),
    },
  },
}));

// Minimal FontFace/document harness: a face "loads" unless the bytes are the
// sentinel invalid payload, mirroring real browser rejection of corrupt files.
// A zero-length buffer stands in for corrupt/unparseable font data.
const INVALID_FONT_BYTES = new ArrayBuffer(0);
vi.stubGlobal('FontFace', class {
  family: string;
  source: ArrayBuffer;
  constructor(family: string, source: ArrayBuffer) {
    this.family = family;
    this.source = source;
  }
  load(): Promise<this> {
    if (this.source.byteLength === 0) return Promise.reject(new Error('Invalid font data'));
    return Promise.resolve(this);
  }
});
vi.stubGlobal('document', { fonts: { add: vi.fn() } });

const fixtureBytes = new TextEncoder().encode('kites');
// sha256("kites"), precomputed with shasum -a 256
const FIXTURE_SHA256 = '8bf991c1d3ded9ce1991eb8df42c04e1ffd4f7e744a72af9f5d6c7d5167b1305';

/** @returns A catalog entry whose pinned hash matches the fixture bytes. */
function fixtureEntry(overrides: Partial<FontCatalogEntry> = {}): FontCatalogEntry {
  return { ...FONT_CATALOG[0], id: 'fixture', family: 'Fixture Font', label: 'Fixture Font', sha256: FIXTURE_SHA256, ...overrides };
}

describe('fontLibrary', () => {
  beforeEach(() => {
    putMock.mockClear();
  });

  it('computes the hex SHA-256 of raw bytes', async () => {
    expect(await sha256Hex(fixtureBytes.buffer as ArrayBuffer)).toBe(FIXTURE_SHA256);
  });

  it('downloads, verifies, persists, and registers a matching catalog font', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => fixtureBytes.buffer })));
    const installed = await downloadCatalogFont(fixtureEntry());
    expect(installed).toEqual({ id: 'fixture', family: 'Fixture Font', label: 'Fixture Font', source: 'catalog' });
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it('refuses the install when bytes do not match the pinned hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('tampered').buffer })));
    await expect(downloadCatalogFont(fixtureEntry())).rejects.toThrow(/integrity check failed/i);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('exposes a zero-length sentinel that FontFace.load rejects (corrupt-file gate)', async () => {
    const probe = new FontFace('Broken Font', INVALID_FONT_BYTES);
    await expect(probe.load()).rejects.toThrow(/Invalid font data/);
  });

  it('refuses the install when the download HTTP status is not OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(downloadCatalogFont(FONT_CATALOG[0])).rejects.toThrow(/HTTP 404/);
    expect(putMock).not.toHaveBeenCalled();
  });
});
