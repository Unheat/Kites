/**
 * @file fontLibrary.ts
 * On-demand font library: catalog downloads with pinned-hash verification, user file
 * imports, IndexedDB persistence, and FontFace registration in the current document.
 * The offscreen bake document registers persisted faces at boot so typeset measurement
 * always sees the exact bytes the selection refers to.
 */

import { db } from '../db';
import type { FontRecord } from '../db';
import { FONT_CATALOG, findCatalogEntryByFamily, type FontCatalogEntry } from './fontCatalog';

/** A font face available in the current document. */
export interface InstalledFont {
  id: string;
  family: string;
  label: string;
  source: 'catalog' | 'import';
}

const registeredFamilies = new Set<string>();
let registrationPromise: Promise<void> | null = null;

/**
 * Registers raw bytes as a document font face under the given family name.
 * Idempotent per family within the document.
 *
 * @param family - CSS family name to register under.
 * @param data - Raw font bytes (woff2/ttf/otf).
 * @returns Resolves when the face is loaded and added to document.fonts.
 */
export async function registerFontFace(family: string, data: ArrayBuffer): Promise<void> {
  if (registeredFamilies.has(family)) return;
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  registeredFamilies.add(family);
}

/**
 * Registers every persisted library font in the current document. Safe to call
 * repeatedly; the work is shared across callers via a single in-flight promise.
 *
 * @returns Resolves when all persisted faces are registered (failures logged per face).
 */
export function ensureFontsRegistered(): Promise<void> {
  registrationPromise ??= (async () => {
    const records = await db.fonts.toArray();
    for (const record of records) {
      try {
        await registerFontFace(record.family, record.data);
      } catch (err) {
        console.warn(`[FontLibrary] Failed to register persisted font "${record.family}":`, err);
      }
    }
  })();
  return registrationPromise;
}

/**
 * Computes the hex SHA-256 of raw bytes (catalog downloads are pinned to hashes).
 *
 * @param data - Downloaded font bytes.
 * @returns Lowercase hex digest.
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads a catalog font, verifies its pinned SHA-256, persists it, and registers
 * it in the current document.
 *
 * @param entry - Catalog entry to download.
 * @returns Resolves with the installed descriptor.
 * @throws When the download fails or the bytes do not match the pinned hash.
 */
export async function downloadCatalogFont(entry: FontCatalogEntry): Promise<InstalledFont> {
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`Font download failed (HTTP ${response.status}) for "${entry.family}".`);
  }
  const data = await response.arrayBuffer();
  const hash = await sha256Hex(data);
  if (hash !== entry.sha256) {
    throw new Error(`Font integrity check failed for "${entry.family}" — refusing to install unverified bytes.`);
  }
  const record: FontRecord = {
    id: entry.id,
    family: entry.family,
    label: entry.label,
    source: 'catalog',
    data,
    addedAt: Date.now(),
  };
  await db.fonts.put(record);
  await registerFontFace(record.family, record.data);
  return { id: record.id, family: record.family, label: record.label, source: 'catalog' };
}

/**
 * Validates and imports a user-provided font file. The bytes must parse as a real
 * font face (FontFace.load rejects otherwise); import fonts render only on machines
 * that carry them, which pickers must surface as a caveat.
 *
 * @param file - Font file (.woff2/.woff/.ttf/.otf) chosen by the user.
 * @returns Resolves with the installed descriptor.
 * @throws When the file is not a loadable font or cannot be persisted.
 */
export async function importFontFile(file: File): Promise<InstalledFont> {
  const data = await file.arrayBuffer();
  const family = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '_').trim() || 'Imported Font';
  // Validation gate: a file that cannot shape as a font never enters the library.
  const probe = new FontFace(family, data);
  await probe.load();
  const record: FontRecord = {
    id: `import-${family.replace(/\s+/g, '_')}-${Date.now()}`,
    family,
    label: family,
    source: 'import',
    data,
    addedAt: Date.now(),
  };
  await db.fonts.put(record);
  await registerFontFace(record.family, record.data);
  return { id: record.id, family: record.family, label: record.label, source: 'import' };
}

/**
 * Deletes a persisted font. Any text still selecting the family silently falls back.
 *
 * @param id - Library record id.
 */
export async function deleteFont(id: string): Promise<void> {
  const record = await db.fonts.get(id);
  await db.fonts.delete(id);
  if (record) registeredFamilies.delete(record.family);
}

/**
 * Lists installed library fonts and the catalog entries not yet downloaded.
 *
 * @returns Installed descriptors plus pending catalog entries for pickers.
 */
export async function listLibrary(): Promise<{ installed: InstalledFont[]; pending: FontCatalogEntry[] }> {
  await ensureFontsRegistered();
  const records = await db.fonts.toArray();
  const installed = records
    .map((record) => ({ id: record.id, family: record.family, label: record.label, source: record.source }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const installedFamilies = new Set(installed.map((f) => f.family));
  const pending = FONT_CATALOG.filter((entry) => !installedFamilies.has(entry.family));
  return { installed, pending };
}

/** @param family - CSS family name. @returns The catalog entry when the family comes from the catalog. */
export function catalogEntryFor(family: string): FontCatalogEntry | undefined {
  return findCatalogEntryByFamily(family);
}
