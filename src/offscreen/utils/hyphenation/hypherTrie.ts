/**
 * Port of hypher 0.1.8 `hyphenate_bounded` trie decoder and traversal.
 * Source: typst/hypher commit d81cc506, src/lib.rs (MIT OR Apache-2.0).
 * Operates on the exact embedded trie data shipped under hypherData/tries.
 *
 * Differences from Rust that are intentional and safe:
 * - Indices are UTF-8 byte offsets internally, matching the donor's byte semantics.
 * - Returned syllable strings preserve the original word casing (donor slices original).
 * - No 45-byte inline limit; JS arrays have no such constraint.
 */

/** A node decoded from the trie byte stream. */
interface TrieState {
  /** Absolute node address within the trie data. */
  addr: number;
  /** Number of bytes per target delta (1..3). */
  stride: number;
  /** Transition labels for this node. */
  trans: Uint8Array;
  /** Packed target deltas for this node. */
  targets: Uint8Array;
  /** Packed level data for this node, or null when absent. */
  levels: Uint8Array | null;
}

/**
 * Decodes the root state address from the trie header.
 *
 * @param data - Raw trie binary.
 * @returns Root node address.
 */
function readRootAddress(data: Uint8Array): number {
  return ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
}

/**
 * Decodes a node at the given address.
 *
 * @param data - Raw trie binary.
 * @param addr - Absolute node address.
 * @returns Decoded node state.
 */
function readState(data: Uint8Array, addr: number): TrieState {
  let pos = addr;
  const header = data[pos++];
  const hasLevels = (header >> 7) !== 0;
  const stride = (header >> 5) & 3;
  let count = header & 31;

  if (count === 31) {
    count = data[pos++];
  }

  let levels: Uint8Array | null = null;
  if (hasLevels) {
    const offset = (data[pos] << 4) | (data[pos + 1] >> 4);
    const len = data[pos + 1] & 15;
    levels = data.subarray(offset, offset + len);
    pos += 2;
  }

  const trans = data.subarray(pos, pos + count);
  pos += count;
  const targets = data.subarray(pos, pos + stride * count);

  return { addr, stride, trans, targets, levels };
}

/**
 * Reads a signed big-endian integer of 1..3 bytes.
 *
 * @param buf - Source bytes.
 * @param offset - Start offset.
 * @param len - Byte length (1..3).
 * @returns Signed integer value.
 */
function readSignedBe(buf: Uint8Array, offset: number, len: number): number {
  if (len === 1) {
    const v = buf[offset];
    return v >= 0x80 ? v - 0x100 : v;
  }
  if (len === 2) {
    const v = (buf[offset] << 8) | buf[offset + 1];
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  const unsigned = (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
  return unsigned - (1 << 23);
}

/**
 * Follows a byte transition from a node.
 *
 * @param data - Raw trie binary.
 * @param state - Current node.
 * @param label - Byte label to follow.
 * @returns Next node, or null when no transition exists.
 */
function transition(data: Uint8Array, state: TrieState, label: number): TrieState | null {
  const idx = state.trans.indexOf(label);
  if (idx < 0) return null;
  const offset = state.stride * idx;
  const delta = readSignedBe(state.targets, offset, state.stride);
  return readState(data, (state.addr + delta) >>> 0);
}

/**
 * Iterates packed level entries for a node.
 * Each packed byte encodes distance/10 and level%10.
 *
 * @param levels - Packed level bytes.
 * @returns Array of [offset, level] pairs.
 */
function unpackLevels(levels: Uint8Array | null): Array<[number, number]> {
  if (!levels) return [];
  const out: Array<[number, number]> = [];
  let offset = 0;
  for (const packed of levels) {
    offset += Math.floor(packed / 10);
    out.push([offset, packed % 10]);
  }
  return out;
}

/**
 * UTF-8 byte length of a string.
 *
 * @param s - Input string.
 * @returns Byte length.
 */
function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Lowercases a word and surrounds it with dots, mirroring hypher's
 * `lowercase_and_dot`. Only applies a lowercase mapping when the UTF-8 byte
 * length is unchanged, matching the donor's guard.
 *
 * @param word - Original word.
 * @returns UTF-8 dotted bytes.
 */
function lowercaseAndDot(word: string): Uint8Array {
  let out = '.';
  for (const ch of word) {
    const lower = ch.toLowerCase();
    if ([...lower].length === 1 && utf8Length(lower) === utf8Length(ch)) {
      out += lower;
    } else {
      out += ch;
    }
  }
  out += '.';
  return new TextEncoder().encode(out);
}

/**
 * Converts character-count bounds to UTF-8 byte bounds in the dotted word.
 *
 * @param word - Original word.
 * @param leftMin - Minimum characters retained on the left.
 * @param rightMin - Minimum characters retained on the right.
 * @returns [minIdx, maxIdx] byte offsets in the dotted representation.
 */
function charToByteBounds(word: string, leftMin: number, rightMin: number): [number, number] {
  const chars = [...word];
  const left = Math.max(1, leftMin);
  const right = Math.max(1, rightMin);
  const minIdx = 1 + utf8Length(chars.slice(0, left).join(''));
  const maxIdx = 1 + utf8Length(word) - utf8Length(chars.slice(Math.max(0, chars.length - right)).join(''));
  return [minIdx, maxIdx];
}

/**
 * Computes syllable boundary byte offsets within the word using the trie.
 *
 * @param word - Original word.
 * @param data - Raw trie binary.
 * @param leftMin - Minimum characters before a break.
 * @param rightMin - Minimum characters after a break.
 * @returns Ascending UTF-8 byte offsets in `word` where syllables split.
 */
export function hypherSplitOffsets(
  word: string,
  data: Uint8Array,
  leftMin: number,
  rightMin: number
): number[] {
  if (!word) return [];

  const dotted = lowercaseAndDot(word);
  const wordBytes = utf8Length(word);
  if (wordBytes < 2) return [];

  const [minIdx, maxIdx] = charToByteBounds(word, leftMin, rightMin);
  const levels = new Uint8Array(Math.max(0, wordBytes - 1));

  const root = readState(data, readRootAddress(data));
  for (let start = 0; start < dotted.length; start++) {
    // Skip UTF-8 continuation bytes; only start matching at character boundaries.
    if ((dotted[start] & 0xc0) === 0x80) continue;

    let state: TrieState | null = root;
    for (let i = start; i < dotted.length; i++) {
      state = transition(data, state, dotted[i]);
      if (!state) break;
      for (const [offset, level] of unpackLevels(state.levels)) {
        const split = start + offset;
        if (split >= minIdx && split <= maxIdx) {
          const slot = split - 2;
          if (slot >= 0 && slot < levels.length && level > levels[slot]) {
            levels[slot] = level;
          }
        }
      }
    }
  }

  const splits: number[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] % 2 === 1) splits.push(i + 1);
  }
  return splits;
}

/**
 * Hyphenates a word into syllables using the exact hypher trie algorithm.
 *
 * @param word - Original word.
 * @param data - Raw trie binary.
 * @param leftMin - Minimum characters retained before a break.
 * @param rightMin - Minimum characters retained after a break.
 * @returns Syllable array whose join('') equals `word`; single element when no break.
 */
export function hyphenateBounded(
  word: string,
  data: Uint8Array,
  leftMin: number,
  rightMin: number
): string[] {
  if (!word) return [];

  const splits = hypherSplitOffsets(word, data, leftMin, rightMin);
  if (splits.length === 0) return [word];

  const bytes = new TextEncoder().encode(word);
  const decoder = new TextDecoder();
  const syllables: string[] = [];
  let cursor = 0;
  for (const split of splits) {
    if (split <= cursor || split >= bytes.length) continue;
    syllables.push(decoder.decode(bytes.subarray(cursor, split)));
    cursor = split;
  }
  if (cursor < bytes.length) syllables.push(decoder.decode(bytes.subarray(cursor)));
  return syllables.length > 0 ? syllables : [word];
}