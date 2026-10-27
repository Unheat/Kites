/**
 * @file sharedContainerPartition.ts
 * Bounding box core insetting, tail trimming, and sub-chamber territory partitioning.
 * 1:1 port of XianScan `expansion.rs` and `builder.rs:673`.
 */

import type { BoxRect } from '../bubbleExpansion';
import { SIBLING_GAP } from './siblingClearance';

export const BUBBLE_INSET_FRAC = 0.12;
export const BUBBLE_INSET_MIN = 8;
export const BUBBLE_INSET_MAX = 48;
export const MIN_UNUSED_RATIO = 0.15;
export const MIN_SCALE = 1.05;
export const EXPANSION_SLACK_DAMPING = 0.60;
export const MAX_EXPANSION_SCALE = 1.45;
export const MAX_EXPANSION_SCALE_VERTICAL = 2.20;
export const SHARED_CHAMBER_MAX_V_GROWTH = 1.35;

function BUBBLE_INSET_MAX_CLAMP(val: number): number {
  return Math.round(val);
}

/**
 * Computes the safe inscribed core of a bubble, avoiding strokes and borders.
 */
export function bubbleCore(
  b: BoxRect,
  textReference?: BoxRect
): { left: number; right: number; top: number; bottom: number } | null {
  const mx = Math.min(BUBBLE_INSET_MAX_CLAMP(b.w * BUBBLE_INSET_FRAC), BUBBLE_INSET_MAX);
  const clampedMx = Math.max(mx, BUBBLE_INSET_MIN);
  const my = Math.min(BUBBLE_INSET_MAX_CLAMP(b.h * BUBBLE_INSET_FRAC), BUBBLE_INSET_MAX);
  const clampedMy = Math.max(my, BUBBLE_INSET_MIN);

  let left = b.x + clampedMx;
  let right = b.x + b.w - clampedMx;
  let top = b.y + clampedMy;
  let bottom = b.y + b.h - clampedMy;

  if (textReference) {
    top = Math.min(top, Math.max(b.y + BUBBLE_INSET_MIN, textReference.y - 12));
    bottom = Math.max(bottom, Math.min(b.y + b.h - BUBBLE_INSET_MIN, textReference.y + textReference.h + 12));
    left = Math.min(left, Math.max(b.x + BUBBLE_INSET_MIN, textReference.x - 12));
    right = Math.max(right, Math.min(b.x + b.w - BUBBLE_INSET_MIN, textReference.x + textReference.w + 12));
  }

  if (right - left <= 8 || bottom - top <= 8) {
    return null;
  }
  return { left, right, top, bottom };
}

/**
 * Builds the expansion core for a pre-partitioned sub-chamber territory.
 */
export function subChamberCore(
  territory: BoxRect,
  textReference: BoxRect
): { left: number; right: number; top: number; bottom: number } | null {
  let left = territory.x;
  let right = territory.x + territory.w;
  let top = territory.y;
  let bottom = territory.y + territory.h;

  if (textReference) {
    top = Math.min(top, Math.max(territory.y, textReference.y - 12));
    bottom = Math.max(bottom, Math.min(territory.y + territory.h, textReference.y + textReference.h + 12));
    left = Math.min(left, Math.max(territory.x, textReference.x - 12));
    right = Math.max(right, Math.min(territory.x + territory.w, textReference.x + textReference.w + 12));
  }

  if (right - left <= 8 || bottom - top <= 8) {
    return null;
  }
  return { left, right, top, bottom };
}

/**
 * Clamps a bounding box so its edges stay strictly within the specified limits.
 */
export function clampBoxToCore(
  b: BoxRect,
  left: number,
  right: number,
  top: number,
  bottom: number
): BoxRect {
  let x = Math.max(b.x, left);
  let r = Math.min(b.x + b.w, right);
  if (r < x + 1) {
    r = Math.min(x + 1, right);
  }
  if (r < x + 1) {
    x = r - 1;
  }
  const finalX = Math.max(0, x);
  const finalW = Math.max(1, r - x);

  let y = Math.max(b.y, top);
  let bot = Math.min(b.y + b.h, bottom);
  if (bot < y + 1) {
    bot = Math.min(y + 1, bottom);
  }
  if (bot < y + 1) {
    y = bot - 1;
  }
  const finalY = Math.max(0, y);
  const finalH = Math.max(1, bot - y);

  return { x: finalX, y: finalY, w: finalW, h: finalH };
}

/**
 * Derives the carrier (body) box by detecting and trimming directional pointing tails.
 */
export function deriveCarrierBoxGeometric(b: BoxRect, t: BoxRect, pageH: number): BoxRect {
  const carrier: BoxRect = { ...b };

  const mTop = Math.max(0, t.y - b.y);
  const mBot = Math.max(0, (b.y + b.h) - (t.y + t.h));
  const mLeft = Math.max(0, t.x - b.x);
  const mRight = Math.max(0, (b.x + b.w) - (t.x + t.w));

  const mSide = Math.min(mLeft, mRight);
  const mVert = Math.min(mTop, mBot);

  const isTopOrBottomEdge = b.y <= 12 || (b.y + b.h) >= pageH - 12;
  if (!isTopOrBottomEdge) {
    if (mBot >= mTop * 1.30 && (mBot - mTop) >= 20) {
      const safePad = Math.round(Math.max(12, Math.min(mTop, mSide * 0.90)));
      const effBottom = Math.min(t.y + t.h + safePad, b.y + b.h);
      carrier.h = Math.max(t.h + 10, effBottom - b.y);
    } else if (mTop >= mBot * 1.30 && (mTop - mBot) >= 20) {
      const safePad = Math.round(Math.max(12, Math.min(mBot, mSide * 0.90)));
      const effTop = Math.max(b.y, t.y - safePad);
      carrier.h = Math.max(t.h + 10, (b.y + b.h) - effTop);
      carrier.y = effTop;
    }
  }

  if (mRight >= mLeft * 1.50 && (mRight - mLeft) >= 22) {
    const safePad = Math.round(Math.max(12, Math.min(mLeft, mVert * 0.90)));
    const effRight = Math.min(b.x + b.w, t.x + t.w + safePad);
    carrier.w = Math.max(t.w + 10, effRight - b.x);
  } else if (mLeft >= mRight * 1.50 && (mLeft - mRight) >= 22) {
    const safePad = Math.round(Math.max(12, Math.min(mRight, mVert * 0.90)));
    const effLeft = Math.max(b.x, t.x - safePad);
    carrier.w = Math.max(t.w + 10, (b.x + b.w) - effLeft);
    carrier.x = effLeft;
  }

  return carrier;
}

export function validTailCutCarrier(carrier: BoxRect, b: BoxRect, pageH: number): boolean {
  if (carrier.x === b.x && carrier.y === b.y && carrier.w === b.w && carrier.h === b.h) {
    return false;
  }
  if (carrier.w < 20 || carrier.h < 20) {
    return false;
  }
  if (b.y <= 12 || (b.y + b.h) >= pageH - 12) {
    return false;
  }
  return true;
}

export function dampedSlackExpansion(
  textBox: BoxRect,
  leftLimit: number,
  rightLimit: number,
  topLimit: number,
  bottomLimit: number,
  isVertical: boolean
): BoxRect {
  const result: BoxRect = { ...textBox };
  const cx = textBox.x + textBox.w / 2;
  const cy = textBox.y + textBox.h / 2;

  const halfW = textBox.w / 2;
  const maxSafeHalfW = Math.min(cx - leftLimit, rightLimit - cx);
  if (maxSafeHalfW > halfW && halfW > 0) {
    const rawScale = maxSafeHalfW / halfW;
    const usable = (rightLimit - leftLimit) - textBox.w;
    if (usable >= textBox.w * MIN_UNUSED_RATIO && rawScale >= MIN_SCALE) {
      const isNarrowVertical = isVertical && textBox.w < textBox.h / 2;
      const damping = isNarrowVertical ? 1.0 : EXPANSION_SLACK_DAMPING;
      const cap = isNarrowVertical ? MAX_EXPANSION_SCALE_VERTICAL : MAX_EXPANSION_SCALE;
      const dampedScale = 1.0 + (rawScale - 1.0) * damping;
      const finalScale = Math.min(dampedScale, cap, rawScale);
      const nh = Math.round(halfW * finalScale);
      const nx = Math.round(cx - nh);
      const nr = Math.round(cx + nh);
      if (nr > nx && nx >= leftLimit && nr <= rightLimit) {
        result.x = nx;
        result.w = nr - nx;
      }
    }
  }

  const halfH = textBox.h / 2;
  const maxSafeHalfH = Math.min(cy - topLimit, bottomLimit - cy);
  if (maxSafeHalfH > halfH && halfH > 0) {
    const rawScale = maxSafeHalfH / halfH;
    const usable = (bottomLimit - topLimit) - textBox.h;
    if (usable >= textBox.h * MIN_UNUSED_RATIO && rawScale >= MIN_SCALE) {
      const dampedScale = 1.0 + (rawScale - 1.0) * EXPANSION_SLACK_DAMPING;
      const finalScale = Math.min(dampedScale, MAX_EXPANSION_SCALE, rawScale);
      const nh = Math.round(halfH * finalScale);
      const ny = Math.round(cy - nh);
      const nb = Math.round(cy + nh);
      if (nb > ny && ny >= topLimit && nb <= bottomLimit) {
        result.y = ny;
        result.h = nb - ny;
      }
    }
  }

  return result;
}

export function computeTypesetBox(
  textBox: BoxRect,
  bubbleOrCarrierBox: BoxRect,
  isVertical: boolean,
  pageH: number,
  isAlreadySeveredCarrier: boolean = false,
  isSubChamber: boolean = false
): BoxRect {
  const carrier = isAlreadySeveredCarrier || isSubChamber
    ? bubbleOrCarrierBox
    : (() => {
        const derived = deriveCarrierBoxGeometric(bubbleOrCarrierBox, textBox, pageH);
        return validTailCutCarrier(derived, bubbleOrCarrierBox, pageH) ? derived : bubbleOrCarrierBox;
      })();

  const core = isSubChamber
    ? subChamberCore(bubbleOrCarrierBox, textBox)
    : (bubbleCore(carrier, textBox) ?? bubbleCore(bubbleOrCarrierBox, textBox));
  if (!core) {
    return textBox;
  }

  const coreW = core.right - core.left;
  const coreH = core.bottom - core.top;

  const expandedW = isSubChamber
    ? coreW
    : Math.min(coreW, Math.max(Math.round(textBox.w * 1.25), Math.round(coreW * 0.80)));
  const expandedH = isSubChamber
    ? Math.min(
        coreH,
        Math.max(
          Math.round(textBox.h),
          Math.min(Math.round(coreH * 0.70), Math.round(textBox.h * SHARED_CHAMBER_MAX_V_GROWTH))
        )
      )
    : Math.min(coreH, Math.max(Math.round(textBox.h), Math.round(coreH * 0.90)));

  const textCx = Math.round(textBox.x + textBox.w / 2);
  const textCy = Math.round(textBox.y + textBox.h / 2);
  const carrierCx = Math.round(carrier.x + carrier.w / 2);
  const carrierCy = Math.round(carrier.y + carrier.h / 2);

  const isOffCenter = Math.abs(textCx - carrierCx) / Math.max(1, carrier.w) > 0.20;
  const targetCx = isSubChamber
    ? carrierCx
    : (isVertical && !isOffCenter ? carrierCx : textCx);

  const targetCy = isSubChamber
    ? carrierCy
    : textCy;

  const targetW = (!isSubChamber && isOffCenter)
    ? Math.min(expandedW, Math.round(textBox.w * 1.40))
    : expandedW;

  const centered: BoxRect = {
    x: targetCx - Math.round(targetW / 2),
    y: targetCy - Math.round(expandedH / 2),
    w: targetW,
    h: expandedH
  };

  return clampBoxToCore(centered, core.left, core.right, core.top, core.bottom);
}

export function partitionSharedContainer(
  container: BoxRect,
  utterances: BoxRect[],
  siblingGap: number = SIBLING_GAP
): BoxRect[] {
  const K = utterances.length;
  if (K <= 1) return utterances.map((u) => ({ ...u }));

  const core = bubbleCore(container);
  if (!core) return utterances.map((u) => ({ ...u }));

  const halfGap = Math.round(siblingGap / 2);
  const subChambers: BoxRect[] = new Array(K);

  for (let i = 0; i < K; i++) {
    const curr = utterances[i];
    let leftLimit = container.x;
    let rightLimit = container.x + container.w;
    let topLimit = container.y;
    let bottomLimit = container.y + container.h;

    for (let j = 0; j < K; j++) {
      if (i === j) continue;
      const other = utterances[j];

      const overlapY = curr.y + curr.h > other.y && other.y + other.h > curr.y;
      const overlapX = curr.x + curr.w > other.x && other.x + other.w > curr.x;
      if (overlapX && overlapY) {
        continue;
      }

      const cxI = curr.x + curr.w / 2;
      const cyI = curr.y + curr.h / 2;
      const cxJ = other.x + other.w / 2;
      const cyJ = other.y + other.h / 2;
      const dx = Math.abs(cxI - cxJ);
      const dy = Math.abs(cyI - cyJ);
      const isPrimarilyVertical = dy > dx;

      if (isPrimarilyVertical) {
        if (cyJ < cyI) {
          const divY = Math.round((cyJ + cyI) / 2);
          topLimit = Math.max(topLimit, divY + halfGap);
        } else if (cyJ > cyI) {
          const divY = Math.round((cyI + cyJ) / 2);
          bottomLimit = Math.min(bottomLimit, divY - halfGap);
        }
      } else {
        if (cxJ < cxI) {
          const divX = Math.round((other.x + other.w + curr.x) / 2);
          leftLimit = Math.max(leftLimit, divX + halfGap);
        } else if (cxJ > cxI) {
          const divX = Math.round((curr.x + curr.w + other.x) / 2);
          rightLimit = Math.min(rightLimit, divX - halfGap);
        }
      }
    }

    // Floor invariant: a sub-chamber must always fully contain its own original text box.
    const finalLeft = Math.min(leftLimit, curr.x);
    const finalRight = Math.max(rightLimit, curr.x + curr.w);
    const finalTop = Math.min(topLimit, curr.y);
    const finalBottom = Math.max(bottomLimit, curr.y + curr.h);

    subChambers[i] = {
      x: finalLeft,
      y: finalTop,
      w: Math.max(curr.w, finalRight - finalLeft),
      h: Math.max(curr.h, finalBottom - finalTop),
    };
  }

  return subChambers;
}
