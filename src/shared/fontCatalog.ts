/**
 * @file fontCatalog.ts
 * Curated on-demand font catalog (single source of truth per AGENTS.md Section 3).
 *
 * Design mirrors the donor renderer's font architecture, scaled to a legally clean set:
 * every entry is an SIL Open Font License face with a versioned, immutable CDN URL and a
 * pinned SHA-256 so downloads are verified before registration. Fonts are downloaded on
 * demand (like OCR/translation models) — nothing here bloats the extension package.
 */

/** One downloadable font entry in the catalog. */
export interface FontCatalogEntry {
  /** Stable identifier used in persisted selections (`font:<family>` values key off family). */
  readonly id: string;
  /** CSS family name the face registers under (also the persisted selection key). */
  readonly family: string;
  /** Display label for pickers. */
  readonly label: string;
  /** Versioned CDN URL (Google Fonts gstatic — immutable per version). */
  readonly url: string;
  /** Pinned SHA-256 of the served woff2 bytes; downloads are rejected on mismatch. */
  readonly sha256: string;
  /** Byte size shown in pickers before download. */
  readonly sizeBytes: number;
  /** License SPDX identifier; only clearly redistributable faces are admitted. */
  readonly license: 'OFL';
  /** UI grouping hint. */
  readonly category: 'dialogue' | 'handwriting' | 'display';
}

/**
 * Curated comic-dialogue and handwriting faces. Latin subsets served by gstatic;
 * hashes pinned from the served bytes so a CDN change cannot silently alter typeset
 * metrics (line breaks derive from font metrics — see the font determinism devlog).
 */
export const FONT_CATALOG: readonly FontCatalogEntry[] = [
  {
    id: 'comic-neue', family: 'Comic Neue', label: 'Comic Neue', category: 'dialogue', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/comicneue/v9/4UaHrEJDsxBrF37olUeD96rp5w.woff2',
    sha256: 'b7753f30f8bd4925cf48a2ffe936c52ff1f16fe441f8c0245acf046296ac590f', sizeBytes: 19572,
  },
  {
    id: 'bangers', family: 'Bangers', label: 'Bangers', category: 'display', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/bangers/v25/FeVQS0BTqb0h60ACH55Q2A.woff2',
    sha256: '04f54ff42ea2b8fc50b4259c29c60b1e05e606b769c2fb541c98624346c9767c', sizeBytes: 23528,
  },
  {
    id: 'luckiest-guy', family: 'Luckiest Guy', label: 'Luckiest Guy', category: 'display', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/luckiestguy/v25/_gP_1RrxsjcxVyin9l9n_j2hTd52.woff2',
    sha256: '3877b522181765adf66ba89bd68d288ecb9f2483b441baab3424646b0c7aaa0a', sizeBytes: 17360,
  },
  {
    id: 'shantell-sans', family: 'Shantell Sans', label: 'Shantell Sans', category: 'dialogue', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/shantellsans/v13/FeUaS0pCoLIo-lcdY7kjvNoQqWVWB0qWpl29ajppTuUTu_kJKmHesPOL-maYi4xZeHCNQ09eBlmv2QcUzJ39-rAISYR8S1ixwv0.woff2',
    sha256: 'a8c243d16aee38b5d106791343c95e5e77d9ae7f5761d7d432de88e2904fa11f', sizeBytes: 47168,
  },
  {
    id: 'gochi-hand', family: 'Gochi Hand', label: 'Gochi Hand', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/gochihand/v27/hES06XlsOjtJsgCkx1Pkfon_-w.woff2',
    sha256: '8851738d8167bd0384db9dee1df6e5b5e2f9221e613e3466cdea19587a81d7b6', sizeBytes: 19908,
  },
  {
    id: 'schoolbell', family: 'Schoolbell', label: 'Schoolbell', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/schoolbell/v18/92zQtBZWOrcgoe-fgnJIZxUa6w.woff2',
    sha256: '9b308506b890f3b49de775d414f639dfd0a9c88dcc7944451292be56b57a4e77', sizeBytes: 21408,
  },
  {
    id: 'indie-flower', family: 'Indie Flower', label: 'Indie Flower', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/indieflower/v24/m8JVjfNVeKWVnh3QMuKkFcZVaUuH.woff2',
    sha256: 'cb57752edc96294323252e8d84fa25f975943b2ef3e87b2c984b15ca935d7657', sizeBytes: 19508,
  },
  {
    id: 'architects-daughter', family: 'Architects Daughter', label: 'Architects Daughter', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/architectsdaughter/v20/KtkxAKiDZI_td1Lkx62xHZHDtgO_Y-bvTYlg4w.woff2',
    sha256: '284a3c1856b253a681c180bf5328cae3b94d4aaab702f6385490ec4e1b449df3', sizeBytes: 13156,
  },
  {
    id: 'kalam', family: 'Kalam', label: 'Kalam', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/kalam/v18/YA9dr0Wd4kDdMthROCc.woff2',
    sha256: '954410601a823f37e219f7930b7446f86afa15621326a7078d56fb9c910135cb', sizeBytes: 22336,
  },
  {
    id: 'permanent-marker', family: 'Permanent Marker', label: 'Permanent Marker', category: 'display', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004La2Cfw.woff2',
    sha256: '4884fec2c73aa52a2461073c1b87d1ceb80f400520391b43f97ca7d3c39eeb24', sizeBytes: 29564,
  },
  {
    id: 'coming-soon', family: 'Coming Soon', label: 'Coming Soon', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/comingsoon/v20/qWcuB6mzpYL7AJ2VfdQR1t-VWDk.woff2',
    sha256: 'e975a6b393c298075c7b0a262fe46b0f1cb1a9f408cc3a48360a12d897364500', sizeBytes: 21432,
  },
  {
    id: 'caveat', family: 'Caveat', label: 'Caveat', category: 'handwriting', license: 'OFL',
    url: 'https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjfJ9eIWpYQ.woff2',
    sha256: 'd0b7b931b8980049327e8f8f9ac264617c8200b8422d62e886473d3d9527bad3', sizeBytes: 48836,
  },
];

/** @param family - CSS family name. @returns The catalog entry, or undefined when absent. */
export function findCatalogEntryByFamily(family: string): FontCatalogEntry | undefined {
  return FONT_CATALOG.find((entry) => entry.family === family);
}
