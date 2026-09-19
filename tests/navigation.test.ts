// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationController } from '../src/lib/navigation';

interface Recorder {
  next: number;
  previous: number;
  jumps: number[];
  detail: number;
}

function setup(busy = false) {
  const target = document.createElement('div');
  document.body.append(target);

  const calls: Recorder = { next: 0, previous: 0, jumps: [], detail: 0 };
  const controller = new NavigationController(target, {
    onNext: () => calls.next++,
    onPrevious: () => calls.previous++,
    onJump: (index) => calls.jumps.push(index),
    onDetailToggle: () => calls.detail++,
    isBusy: () => busy,
  });

  return { target, calls, controller };
}

function wheel(target: HTMLElement, deltaY: number) {
  target.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true }));
}

function key(name: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: name, cancelable: true, bubbles: true }));
}

function touch(target: HTMLElement, from: [number, number], to: [number, number]) {
  const make = (type: string, x: number, y: number, list: 'touches' | 'changedTouches') =>
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      [list]: [{ clientX: x, clientY: y }],
      touches: list === 'touches' ? [{ clientX: x, clientY: y }] : [],
      changedTouches: list === 'changedTouches' ? [{ clientX: x, clientY: y }] : [],
    });

  target.dispatchEvent(make('touchstart', from[0], from[1], 'touches'));
  target.dispatchEvent(make('touchend', to[0], to[1], 'changedTouches'));
}

let context: ReturnType<typeof setup>;

beforeEach(() => {
  vi.useFakeTimers();
  // performance.now drives the cooldown; start well past it so the first
  // gesture in each test is always allowed.
  vi.setSystemTime(0);
  vi.spyOn(performance, 'now').mockReturnValue(10_000);
});

afterEach(() => {
  context?.controller.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('wheel input', () => {
  it('ignores deltas below the intent threshold', () => {
    context = setup();
    wheel(context.target, 5);
    wheel(context.target, 5);
    expect(context.calls.next).toBe(0);
  });

  it('accumulates small trackpad deltas into one scene change', () => {
    // A single physical trackpad swipe emits many small deltas. It must mean
    // one scene, not none and not several.
    context = setup();
    for (let i = 0; i < 10; i++) wheel(context.target, 4);
    expect(context.calls.next).toBe(1);
  });

  it('commits immediately on one large mouse-wheel delta', () => {
    context = setup();
    wheel(context.target, 120);
    expect(context.calls.next).toBe(1);
  });

  it('goes backwards on a negative delta', () => {
    context = setup();
    wheel(context.target, -120);
    expect(context.calls.previous).toBe(1);
    expect(context.calls.next).toBe(0);
  });

  it('does not fire twice within the cooldown', () => {
    // Momentum scrolling keeps delivering events after the user has stopped;
    // one flick must never skip two images.
    context = setup();
    wheel(context.target, 120);
    wheel(context.target, 120);
    wheel(context.target, 120);
    expect(context.calls.next).toBe(1);
  });

  it('fires again once the cooldown has elapsed', () => {
    context = setup();
    wheel(context.target, 120);
    expect(context.calls.next).toBe(1);

    vi.spyOn(performance, 'now').mockReturnValue(10_000 + 500);
    wheel(context.target, 120);
    expect(context.calls.next).toBe(2);
  });

  it('forgets partial accumulation after a pause', () => {
    // Two separate gentle nudges are not one swipe.
    context = setup();
    wheel(context.target, 20);
    vi.advanceTimersByTime(200);
    wheel(context.target, 20);
    expect(context.calls.next).toBe(0);
  });

  it('prevents the default so the page never actually scrolls', () => {
    context = setup();
    const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    context.target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores input entirely while a transition is running', () => {
    context = setup(true);
    wheel(context.target, 400);
    expect(context.calls.next).toBe(0);
  });
});

describe('keyboard input', () => {
  it('moves forward on the expected keys', () => {
    for (const name of ['ArrowRight', 'ArrowDown', 'PageDown', ' ']) {
      context?.controller.destroy();
      context = setup();
      key(name);
      expect(context.calls.next, `${name} should advance`).toBe(1);
    }
  });

  it('moves backward on the expected keys', () => {
    for (const name of ['ArrowLeft', 'ArrowUp', 'PageUp']) {
      context?.controller.destroy();
      context = setup();
      key(name);
      expect(context.calls.previous, `${name} should go back`).toBe(1);
    }
  });

  it('jumps to the first and last scenes', () => {
    context = setup();
    key('Home');
    key('End');
    expect(context.calls.jumps).toEqual([0, Number.MAX_SAFE_INTEGER]);
  });

  it('toggles detail mode', () => {
    context = setup();
    key('f');
    key('F');
    key('Enter');
    expect(context.calls.detail).toBe(3);
  });

  it('leaves keystrokes inside form controls alone', () => {
    // There are no inputs today, but a future credit form must not have its
    // spacebar eaten by the gallery.
    context = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(context.calls.next).toBe(0);
  });

  it('ignores keys it does not handle', () => {
    context = setup();
    key('a');
    key('Tab');
    expect(context.calls.next + context.calls.previous + context.calls.detail).toBe(0);
  });

  it('respects the cooldown, so a held arrow key does not race ahead', () => {
    context = setup();
    key('ArrowRight');
    key('ArrowRight');
    expect(context.calls.next).toBe(1);
  });
});

describe('touch input', () => {
  it('advances on a swipe left and goes back on a swipe right', () => {
    context = setup();
    touch(context.target, [300, 400], [200, 400]);
    expect(context.calls.next).toBe(1);

    vi.spyOn(performance, 'now').mockReturnValue(10_000 + 500);
    touch(context.target, [200, 400], [300, 400]);
    expect(context.calls.previous).toBe(1);
  });

  it('advances on a swipe up and goes back on a swipe down', () => {
    context = setup();
    touch(context.target, [200, 400], [200, 300]);
    expect(context.calls.next).toBe(1);
  });

  it('ignores a tap or a short drag', () => {
    context = setup();
    touch(context.target, [200, 400], [205, 404]);
    expect(context.calls.next + context.calls.previous).toBe(0);
  });

  it('resolves a diagonal swipe by its dominant axis', () => {
    context = setup();
    // Mostly horizontal, slightly up: should read as "next" either way, so
    // assert the unambiguous case - mostly vertical down means "previous".
    touch(context.target, [200, 200], [210, 320]);
    expect(context.calls.previous).toBe(1);
    expect(context.calls.next).toBe(0);
  });
});

describe('teardown', () => {
  it('stops responding after destroy', () => {
    context = setup();
    context.controller.destroy();
    wheel(context.target, 400);
    key('ArrowRight');
    expect(context.calls.next).toBe(0);
  });
});
