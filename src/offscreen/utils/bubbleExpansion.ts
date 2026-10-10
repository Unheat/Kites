/**
 * Pure geometric algorithms for speech bubble container expansion, safe core insetting,
 * and tail-severed carrier chamber extraction.
 *
 * 1:1 ground-truth port from XianScan `src/pipeline/region_builder/expansion.rs`.
 */

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BUBBLE_INSET_FRAC = 0.12;
export const BUBBLE_INSET_MIN = 8;
export const BUBBLE_INSET_MAX = 48;
export const SIBLING_GAP = 6;
export const MIN_UNUSED_RATIO = 0.15;
export const MIN_SCALE = 1.05;
export const EXPANSION_SLACK_DAMPING = 0.60;
export const MAX_EXPANSION_SCALE = 1.45;
export const MAX_EXPANSION_SCALE_VERTICAL = 2.20;

/**
 * Computes the safe inscribed core of a bubble, avoiding strokes and borders.
 *
 * @param b - The bounding box of the speech bubble or carrier chamber.
 * @returns Bounding edges { left, right, top, bottom }, or null if too small.
 */
export function bubbleCore(b: BoxRect): { left: number; right: number; top: number; bottom: number } | null {
  const mx = Math.min(BUUBLE_INSET_MAX_CLAMP(b.w * BUBBLE_INSET_FRAC), BUBBLE_INSET_MAX);
  const clampedMx = Math.max(mx, BUBBLE_INSET_MIN);
  const my = Math.min(BUUBLE_INSET_MAX_CLAMP(b.h * BUBBLE_INSET_FRAC), BUBBLE_INSET_MAX);
  const clampedMy = Math.max(my, BUBBLE_INSET_MIN);

  const left = b.x + clampedMx;
  const right = b.x + b.w - clampedMx;
  const top = b.y + clampedMy;
  const bottom = b.y + b.h - clampedMy;

  if (right - left <= 8 || bottom - top <= 8) {
    return null;
  }
  return { left, right, top, bottom };
}

function BUUBLE_INSET_MAX_CLAMP(val: number): number {
  return Math.round(val);
}

/**
 * Clamps a bounding box so its edges stay strictly within the specified limits.
 *
 * @param b - Target box to clamp.
 * @param left - Left limit edge.
 * @param right - Right limit edge.
 * @param top - Top limit edge.
 * @param bottom - Bottom limit edge.
 * @returns A new clamped BoxRect.
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
 *
 * In sole-occupant dialogue bubbles, text is centered in the main balloon body.
 * If an asymmetric tail protrudes, trims the tail slack to restore the visual chamber.
 *
 * @param b - The outer speech bubble bounding box.
 * @param t - The inner text bounding box.
 * @param pageH - Total page height in pixels.
 * @returns The trimmed carrier BoxRect.
 */
export function deriveCarrierBoxGeometric(b: BoxRect, t: BoxRect, pageH: number): BoxRect {
  const carrier: BoxRect = { ...b };

  const mTop = Math.max(0, t.y - b.y);
  const mBot = Math.max(0, (b.y + b.h) - (t.y + t.h));
  const mLeft = Math.max(0, t.x - b.x);
  const mRight = Math.max(0, (b.x + b.w) - (t.x + t.w));

  const mSide = Math.min(mLeft, mRight);
  const mVert = Math.min(mTop, mBot);

  // Vertical tails: skewed by >= 1.30x and minimum 20px delta
  const isTopOrBottomEdge = b.y <= 12 || (b.y + b.h) >= pageH - 12;
  if (!isTopOrBottomEdge) {
    if (mBot >= mTop * 1.30 && (mBot - mTop) >= 20) {
      // Downward tail: top/left/right are true bubble boundaries, trim bottom excess
      const safePad = Math.round(Math.max(12, Math.min(mTop, mSide * 0.90)));
      const effBottom = Math.min(t.y + t.h + safePad, b.y + b.h);
      carrier.h = Math.max(t.h + 10, effBottom - b.y);
    } else if (mTop >= mBot * 1.30 && (mTop - mBot) >= 20) {
      // Upward tail: bottom/left/right are true boundaries, trim top excess
      const safePad = Math.round(Math.max(12, Math.min(mBot, mSide * 0.90)));
      const effTop = Math.max(b.y, t.y - safePad);
      carrier.h = Math.max(t.h + 10, (b.y + b.h) - effTop);
      carrier.y = effTop;
    }
  }

  // Horizontal tails: skewed by >= 1.50x and minimum 22px delta
  if (mRight >= mLeft * 1.50 && (mRight - mLeft) >= 22) {
    // Rightward tail: trim right excess
    const safePad = Math.round(Math.max(12, Math.min(mLeft, mVert * 0.90)));
    const effRight = Math.min(b.x + b.w, t.x + t.w + safePad);
    carrier.w = Math.max(t.w + 10, effRight - b.x);
  } else if (mLeft >= mRight * 1.50 && (mLeft - mRight) >= 22) {
    // Leftward tail: trim left excess
    const safePad = Math.round(Math.max(12, Math.min(mRight, mVert * 0.90)));
    const effLeft = Math.max(b.x, t.x - safePad);
    carrier.w = Math.max(t.w + 10, (b.x + b.w) - effLeft);
    carrier.x = effLeft;
  }

  return carrier;
}

/**
 * Validates a derived carrier as a genuine tail-cut bubble boundary.
 *
 * @param carrier - Candidate carrier chamber box.
 * @param b - Original bubble box.
 * @param pageH - Total page height.
 * @returns True if the carrier represents a valid, reliable chamber.
 */
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

/**
 * Expands a text bounding box outward from its centroid into the available bubble slack.
 *
 * @param textBox - Original text bounding box.
 * @param leftLimit - Minimum allowed left coordinate.
 * @param rightLimit - Maximum allowed right coordinate.
 * @param topLimit - Minimum allowed top coordinate.
 * @param bottomLimit - Maximum allowed bottom coordinate.
 * @param isVertical - Whether text is vertical CJK.
 * @returns Expanded BoxRect.
 */
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

  // Width Axis: centroid anchor with damped slack expansion
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

  // Height Axis: centroid anchor with damped slack expansion
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

/**
 * Computes the final typeset box for a speech bubble region:
 * 1. Derives the tail-cut carrier chamber.
 * 2. Inscribes the 8% safe core boundary.
 * 3. Applies damped slack expansion.
 * 4. Centers the expanded box on the carrier chamber center.
 *
 * @param textBox - Original merged text bounding box.
 * @param bubbleBox - Detected speech bubble container.
 * @param isVertical - Whether text is vertical.
 * @param pageH - Total page height.
 * @returns Bounding box to use for multi-line word wrapping and font fitting.
 */
export function computeTypesetBox(
  textBox: BoxRect,
  bubbleOrCarrierBox: BoxRect,
  _isVertical: boolean,
  pageH: number,
  isAlreadySeveredCarrier: boolean = false
): BoxRect {
  const carrier = isAlreadySeveredCarrier
    ? bubbleOrCarrierBox
    : (() => {
        const derived = deriveCarrierBoxGeometric(bubbleOrCarrierBox, textBox, pageH);
        return validTailCutCarrier(derived, bubbleOrCarrierBox, pageH) ? derived : bubbleOrCarrierBox;
      })();

  const core = bubbleCore(carrier) ?? bubbleCore(bubbleOrCarrierBox);
  if (!core) {
    return textBox;
  }

  const coreW = core.right - core.left;
  const coreH = core.bottom - core.top;

  // Utilize the roomy chamber dimensions (XianScan builder.rs:673 expands vertical text
  // to utilize up to 80% of safe core width rather than constraining to the narrow CJK column).
  const expandedW = Math.min(coreW, Math.max(Math.round(textBox.w * 1.25), Math.round(coreW * 0.80)));
  const expandedH = Math.min(coreH, Math.max(Math.round(textBox.h), Math.round(coreH * 0.70)));

  // Optical Chamber Centering: center expanded box on carrier chamber center
  const carrierCx = Math.round(carrier.x + carrier.w / 2);
  const carrierCy = Math.round(carrier.y + carrier.h / 2);

  const centered: BoxRect = {
    x: carrierCx - Math.round(expandedW / 2),
    y: carrierCy - Math.round(expandedH / 2),
    w: expandedW,
    h: expandedH
  };

  // Hard clamp so typeset box stays strictly within the SAFE CORE boundaries, avoiding spikes and strokes
  return clampBoxToCore(centered, core.left, core.right, core.top, core.bottom);
}

/**
 * Enforces sibling clearance and non-overlap boundaries between all adjacent text regions.
 *
 * 1:1 port of XianScan `expansion.rs:230-269` sibling clearance constraint.
 * Partitions connected or adjacent bubbles (e.g. staggered double-boxes or multi-lobe balloons)
 * so sibling text boxes never collide or overlap into each other's chambers.
 *
 * @param originalBoxes - Array of original unexpanded OCR text boxes.
 * @param typesetBoxes - Array of candidate typeset boxes (mutated in-place to respect sibling limits).
 * @param siblingGap - Minimum clearance gap in pixels between sibling boxes. Default SIBLING_GAP = 6.
 */
export function applySiblingBoundaryConstraints(
  originalBoxes: BoxRect[],
  typesetBoxes: (BoxRect | undefined)[],
  siblingGap: number = SIBLING_GAP
): void {
  const halfGap = Math.round(siblingGap / 2);

  for (let i = 0; i < typesetBoxes.length; i++) {
    const tbI = typesetBoxes[i];
    if (!tbI) continue;
    const origI = originalBoxes[i];
    const cxI = origI.x + origI.w / 2;
    const cyI = origI.y + origI.h / 2;

    for (let j = 0; j < typesetBoxes.length; j++) {
      if (i === j) continue;
      const origJ = originalBoxes[j];
      const cxJ = origJ.x + origJ.w / 2;
      const cyJ = origJ.y + origJ.h / 2;

      const dx = Math.abs(cxI - cxJ);
      const dy = Math.abs(cyI - cyJ);
      const isPrimarilyVertical = dy > dx * 1.25;

      // 1. Horizontal influence: when vertical spans overlap AND they are not primarily vertically staggered
      const yOverlap = (origI.y + origI.h) > origJ.y && (origJ.y + origJ.h) > origI.y;
      if (yOverlap && !isPrimarilyVertical) {
        // If box J is to the left of box I
        if (cxJ < cxI) {
          const dividerX = Math.round((origJ.x + origJ.w + origI.x) / 2);
          const minLeft = dividerX + halfGap;
          if (tbI.x < minLeft) {
            const shift = minLeft - tbI.x;
            tbI.x = minLeft;
            tbI.w = Math.max(origI.w, tbI.w - shift);
          }
        }
        // If box J is to the right of box I
        else if (cxJ > cxI) {
          const dividerX = Math.round((origI.x + origI.w + origJ.x) / 2);
          const maxRight = dividerX - halfGap;
          if (tbI.x + tbI.w > maxRight) {
            tbI.w = Math.max(origI.w, maxRight - tbI.x);
          }
        }
      }

      // 2. Vertical influence: when horizontal spans overlap OR when primarily vertically staggered
      const xOverlap = (origI.x + origI.w) > origJ.x && (origJ.x + origJ.w) > origI.x;
      if (xOverlap || isPrimarilyVertical) {
        // If box J is above box I
        if (cyJ < cyI) {
          const dividerY = Math.round((origJ.y + origJ.h + origI.y) / 2);
          const minTop = dividerY + halfGap;
          if (tbI.y < minTop) {
            const shift = minTop - tbI.y;
            tbI.y = minTop;
            tbI.h = Math.max(origI.h, tbI.h - shift);
          }
        }
        // If box J is below box I
        else if (cyJ > cyI) {
          const dividerY = Math.round((origI.y + origI.h + origJ.y) / 2);
          const maxBottom = dividerY - halfGap;
          if (tbI.y + tbI.h > maxBottom) {
            tbI.h = Math.max(origI.h, maxBottom - tbI.y);
          }
        }
      }
    }
  }
}
