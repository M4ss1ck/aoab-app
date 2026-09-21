// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import gsap from 'gsap';
import { ProgressPacer } from '../src/lib/progress';

/**
 * Drives gsap's clock by seeking the global timeline, so the tests are
 * deterministic and take no wall-clock time. Each test gets its own clock,
 * starting from wherever the global timeline already sits.
 */
function setup(duration = 4.8) {
  const seen: number[] = [];
  const pacer = new ProgressPacer((value) => seen.push(value), duration);
  let clock = gsap.globalTimeline.time();
  const advance = (seconds: number) => {
    clock += seconds;
    gsap.globalTimeline.time(clock);
  };
  return { pacer, seen, advance };
}

afterEach(() => {
  gsap.globalTimeline.clear();
});

describe('ProgressPacer', () => {
  it('holds below 100 while loading is still running', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(4.8);

    expect(pacer.value).toBeLessThan(0.93);
    expect(Math.max(...seen)).toBeLessThan(0.93);
  });

  it('reaches exactly 1 once settled', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(1);
    pacer.markReady();
    pacer.settle();

    expect(pacer.value).toBe(1);
    expect(seen.at(-1)).toBe(1);
  });

  // The bug: the climb tween outlived the completion signal and kept writing
  // 0.99 over the top of it, so the indicator visibly stopped at "099".
  it('never reports below 1 after settling, however long the climb had left', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(0.5);
    pacer.markReady();
    pacer.settle();

    const afterSettle = seen.length;
    advance(10);

    expect(seen.slice(afterSettle)).toEqual([]);
    expect(pacer.value).toBe(1);
  });

  it('counts the last step up over the given duration and ends on 1', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(0.5);
    pacer.markReady();
    const floor = pacer.value;
    pacer.settle(0.35);

    advance(0.15);
    expect(pacer.value).toBeGreaterThan(floor);
    expect(pacer.value).toBeLessThan(1);

    advance(0.3);
    expect(pacer.value).toBe(1);
    expect(seen.at(-1)).toBe(1);
  });

  it('jumps straight to 1 when a second settle cuts the count short', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(0.5);
    pacer.markReady();
    pacer.settle(0.35);
    advance(0.1);
    expect(pacer.value).toBeLessThan(1);

    pacer.settle();
    expect(pacer.value).toBe(1);

    const afterSkip = seen.length;
    advance(2);
    expect(seen.slice(afterSkip)).toEqual([]);
  });

  it('counts up to the ready floor instead of jumping there', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(0.5);
    const before = pacer.value;
    expect(before).toBeLessThan(0.3);

    pacer.markReady(0.8);
    // The point of the fix: no single leap from the teens to 099.
    expect(pacer.value).toBeLessThan(before + 0.05);

    advance(0.4);
    expect(pacer.value).toBeGreaterThan(before);
    expect(pacer.value).toBeLessThan(0.99);

    advance(0.5);
    expect(pacer.value).toBe(0.99);

    // And it waits there: 100 belongs to settle alone.
    const held = seen.length;
    advance(5);
    expect(seen.slice(held)).toEqual([]);
  });

  it('never moves backwards', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(0.4);
    pacer.markReady();
    advance(0.4);
    pacer.settle(0.35);
    advance(0.4);

    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]!);
    }
  });

  it('ignores a start that arrives after settling', () => {
    const { pacer, seen, advance } = setup();
    pacer.settle();
    pacer.start();
    advance(2);

    expect(pacer.value).toBe(1);
    expect(seen).toEqual([1]);
  });

  it('stops reporting after destroy', () => {
    const { pacer, seen, advance } = setup();
    pacer.start();
    advance(0.5);
    pacer.destroy();

    const afterDestroy = seen.length;
    advance(2);
    expect(seen.slice(afterDestroy)).toEqual([]);
  });
});
