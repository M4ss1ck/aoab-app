import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToCss,
  darken,
  relativeLuminance,
  inkFor,
  contrastRatio,
} from '../src/lib/colour';

describe('hexToRgb', () => {
  it('parses six-digit hex', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('parses shorthand and a missing hash', () => {
    expect(hexToRgb('fff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#f00')).toEqual([1, 0, 0]);
  });

  it('falls back to mid-grey on malformed input rather than throwing', () => {
    // The palette comes from a generated file; a bad value must degrade the
    // chrome, not take the whole page down.
    expect(hexToRgb('not-a-colour')).toEqual([0.5, 0.5, 0.5]);
    expect(hexToRgb('')).toEqual([0.5, 0.5, 0.5]);
    expect(hexToRgb('#12345')).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('rgbToCss', () => {
  it('renders opaque and alpha forms', () => {
    expect(rgbToCss([1, 0, 0])).toBe('rgb(255 0 0)');
    expect(rgbToCss([0, 0, 1], 0.5)).toBe('rgb(0 0 255 / 0.5)');
  });

  it('clamps values outside 0-1', () => {
    expect(rgbToCss([2, -1, 0.5])).toBe('rgb(255 0 128)');
  });
});

describe('darken', () => {
  it('scales every channel', () => {
    expect(darken([1, 0.5, 0.25], 0.5)).toEqual([0.5, 0.25, 0.125]);
  });
});

describe('relativeLuminance', () => {
  it('matches the WCAG reference values', () => {
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    // sRGB mid-grey #808080 has a known luminance of ~0.2159.
    expect(relativeLuminance(hexToRgb('#808080'))).toBeCloseTo(0.2159, 3);
  });
});

describe('inkFor', () => {
  it('chooses dark ink on light backdrops and light ink on dark ones', () => {
    expect(inkFor(hexToRgb('#ffffff'))).toBe('dark');
    expect(inkFor(hexToRgb('#000000'))).toBe('light');
  });

  it('always yields at least 4.5:1 against the chosen ink for every real palette', () => {
    // This is the guarantee that makes the adaptive chrome safe: whatever the
    // artwork's palette is, the text on top of it stays legible.
    const inkLight = hexToRgb('#f6f4ef');
    const inkDark = hexToRgb('#14120f');

    const palettes = [
      '#5062a8', '#a3d1ed', '#909074', '#413934', '#13121d', '#a59c9a',
      '#e2d886', '#5f849c', '#576856', '#9d81dc', '#e5d9bf', '#baa2e0',
      '#b35030', '#575b8d', '#403342', '#1a4684', '#dfba39', '#634c45',
      '#4470a9', '#dab69d', '#7aa0c0', '#418d9d', '#db8083', '#76a7b0',
      '#090c6d', '#49315c', '#1b299e', '#b5c7df', '#b09fa0', '#5a4751',
      '#e2c610', '#30378c', '#7b1958',
    ];

    for (const hex of palettes) {
      // The chrome renders text over the darkened backdrop, not the raw accent.
      const backdrop = darken(hexToRgb(hex), 0.12);
      const ink = inkFor(backdrop) === 'dark' ? inkDark : inkLight;
      expect(contrastRatio(ink, backdrop), `${hex} failed contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('contrastRatio', () => {
  it('is symmetric and bounded by 21', () => {
    const white = hexToRgb('#ffffff');
    const black = hexToRgb('#000000');
    expect(contrastRatio(white, black)).toBeCloseTo(21, 2);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 2);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });
});
