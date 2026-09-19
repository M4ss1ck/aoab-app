import { describe, it, expect } from 'vitest';
import { chooseTier } from '../src/lib/gl/textures';

const TIERS = [1024, 1600, 2400, 3200];

describe('chooseTier', () => {
  it('serves a phone the smallest tier that covers it', () => {
    // 390px viewport at DPR 3, capped to 2 -> 780px wanted -> 1024.
    expect(
      chooseTier({ tiers: TIERS, viewport: 390, dpr: 3, maxTextureSize: 4096 }),
    ).toBe(1024);
  });

  it('serves a laptop a mid tier', () => {
    expect(
      chooseTier({ tiers: TIERS, viewport: 1440, dpr: 1, maxTextureSize: 16384 }),
    ).toBe(1600);
  });

  it('serves a retina laptop the tier above it', () => {
    expect(
      chooseTier({ tiers: TIERS, viewport: 1440, dpr: 2, maxTextureSize: 16384 }),
    ).toBe(3200);
  });

  it('never exceeds the largest tier, however big the display', () => {
    expect(
      chooseTier({ tiers: TIERS, viewport: 5120, dpr: 2, maxTextureSize: 16384 }),
    ).toBe(3200);
  });

  it('caps DPR at 2 so a 3x phone does not pull a huge texture', () => {
    const atThree = chooseTier({ tiers: TIERS, viewport: 800, dpr: 3, maxTextureSize: 16384 });
    const atTwo = chooseTier({ tiers: TIERS, viewport: 800, dpr: 2, maxTextureSize: 16384 });
    expect(atThree).toBe(atTwo);
  });

  it('respects a GPU that cannot accept large textures', () => {
    // An old mobile GPU reporting 2048 must never be handed the 2400 tier -
    // the upload fails outright rather than degrading.
    expect(
      chooseTier({ tiers: TIERS, viewport: 2560, dpr: 2, maxTextureSize: 2048 }),
    ).toBe(1600);
  });

  it('falls back to the smallest tier when even that exceeds the GPU limit', () => {
    expect(
      chooseTier({ tiers: TIERS, viewport: 1440, dpr: 2, maxTextureSize: 512 }),
    ).toBe(1024);
  });

  it('holds back on low-memory devices even with a large display', () => {
    expect(
      chooseTier({
        tiers: TIERS,
        viewport: 1920,
        dpr: 2,
        maxTextureSize: 16384,
        deviceMemory: 4,
      }),
    ).toBe(1600);
  });

  it('ignores device memory when it is generous', () => {
    expect(
      chooseTier({
        tiers: TIERS,
        viewport: 1920,
        dpr: 2,
        maxTextureSize: 16384,
        deviceMemory: 8,
      }),
    ).toBe(3200);
  });

  it('treats an absent deviceMemory as no constraint', () => {
    const absent = chooseTier({ tiers: TIERS, viewport: 1920, dpr: 2, maxTextureSize: 16384 });
    const generous = chooseTier({
      tiers: TIERS,
      viewport: 1920,
      dpr: 2,
      maxTextureSize: 16384,
      deviceMemory: 16,
    });
    expect(absent).toBe(generous);
  });

  it('handles a single-tier configuration', () => {
    expect(chooseTier({ tiers: [2048], viewport: 400, dpr: 1, maxTextureSize: 8192 })).toBe(2048);
  });

  it('refuses an empty tier list rather than returning undefined', () => {
    expect(() => chooseTier({ tiers: [], viewport: 800, dpr: 1, maxTextureSize: 4096 })).toThrow();
  });

  it('is order-independent', () => {
    const shuffled = [2400, 1024, 3200, 1600];
    expect(chooseTier({ tiers: shuffled, viewport: 1440, dpr: 1, maxTextureSize: 16384 })).toBe(
      1600,
    );
  });
});
