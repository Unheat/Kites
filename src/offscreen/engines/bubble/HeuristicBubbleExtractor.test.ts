import { describe, it, expect } from 'vitest';
import { HeuristicBubbleExtractor, type ImagePatchData } from './HeuristicBubbleExtractor';
import type { BoxRect } from '../../utils/bubbleExpansion';

describe('HeuristicBubbleExtractor', () => {
  it('extracts white bubble chamber around text on dark background', () => {
    const W = 300;
    const H = 300;
    // Dark background (gray 50)
    const data = new Uint8ClampedArray(W * H * 4).fill(50);
    // Draw white circle (center 150, 150, radius 60)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x - 150) ** 2 + (y - 150) ** 2 <= 60 ** 2) {
          const idx = (y * W + x) * 4;
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
          data[idx + 3] = 255;
        }
      }
    }

    const image: ImagePatchData = { width: W, height: H, data };
    const textBox: BoxRect = { x: 135, y: 130, w: 30, h: 40 };

    const carrier = HeuristicBubbleExtractor.extractCarrierBox(image, textBox);
    expect(carrier).not.toBeNull();
    if (carrier) {
      // Chamber contains text box
      expect(carrier.x).toBeLessThanOrEqual(textBox.x);
      expect(carrier.y).toBeLessThanOrEqual(textBox.y);
      expect(carrier.x + carrier.w).toBeGreaterThanOrEqual(textBox.x + textBox.w);
      expect(carrier.y + carrier.h).toBeGreaterThanOrEqual(textBox.y + textBox.h);
      // Dimensions reflect ~120px circular bubble
      expect(carrier.w).toBeGreaterThan(80);
      expect(carrier.h).toBeGreaterThan(80);
    }
  });

  it('severs narrow pointing tail from main bubble chamber', () => {
    const W = 300;
    const H = 350;
    const data = new Uint8ClampedArray(W * H * 4).fill(40);

    // Oval body: center (150, 120), rx=60, ry=50
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inOval = ((x - 150) / 60) ** 2 + ((y - 120) / 50) ** 2 <= 1.0;
        // Narrow tail pointing down from (150, 170) to (180, 240), width <= 10px
        const inTail = y >= 160 && y <= 230 && Math.abs(x - (150 + (y - 160) * 0.4)) <= 5;
        if (inOval || inTail) {
          const idx = (y * W + x) * 4;
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
          data[idx + 3] = 255;
        }
      }
    }

    const image: ImagePatchData = { width: W, height: H, data };
    const textBox: BoxRect = { x: 135, y: 100, w: 30, h: 40 };

    const carrier = HeuristicBubbleExtractor.extractCarrierBox(image, textBox);
    expect(carrier).not.toBeNull();
    if (carrier) {
      // Carrier height should sever the tail below y=200
      expect(carrier.y + carrier.h).toBeLessThan(220);
    }
  });

  it('returns null when text is in uncontained open white space (leak guard)', () => {
    const W = 300;
    const H = 300;
    // Entire image is pure white (open paper margin, no enclosed borders)
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    const image: ImagePatchData = { width: W, height: H, data };
    const textBox: BoxRect = { x: 100, y: 100, w: 50, h: 50 };

    const carrier = HeuristicBubbleExtractor.extractCarrierBox(image, textBox);
    // Leak guard detects boundary touch and rejects
    expect(carrier).toBeNull();
  });
});
