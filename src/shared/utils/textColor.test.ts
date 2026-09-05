import { describe, it, expect } from 'vitest';
import { pickTextColor } from './textColor';

describe('pickTextColor', () => {
  it('picks white text on dark backgrounds', () => {
    expect(pickTextColor({ r: 10, g: 10, b: 10 })).toEqual({ fill: 'white', stroke: 'black' });
    expect(pickTextColor({ r: 30, g: 30, b: 34 })).toEqual({ fill: 'white', stroke: 'black' });
  });

  it('picks black text on light backgrounds', () => {
    expect(pickTextColor({ r: 255, g: 255, b: 255 })).toEqual({ fill: 'black', stroke: 'white' });
    expect(pickTextColor({ r: 230, g: 230, b: 228 })).toEqual({ fill: 'black', stroke: 'white' });
  });

  it('handles saturated mid-luminance colors', () => {
    // Pure red: linearized luminance ~0.21 -> black text
    expect(pickTextColor({ r: 255, g: 0, b: 0 })).toEqual({ fill: 'black', stroke: 'white' });
    // Dark blue: linearized luminance ~0.07 -> white text
    expect(pickTextColor({ r: 0, g: 0, b: 139 })).toEqual({ fill: 'white', stroke: 'black' });
  });
});
