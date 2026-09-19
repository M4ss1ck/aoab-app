/**
 * Turns every way a person might try to move through the gallery into one
 * intent: go forward, go back, or go to a specific scene.
 *
 * The page itself never scrolls. That is what makes the set-piece transitions
 * possible - each gesture commits to one complete scene change instead of
 * smearing across a scrub at whatever speed the wheel happened to spin. It also
 * means touch behaves identically to wheel, with no scroll-jacking and no
 * artificially tall page.
 */

export interface NavigationHandlers {
  onNext: () => void;
  onPrevious: () => void;
  onJump: (index: number) => void;
  onDetailToggle: () => void;
  /** True while a transition is running; input is ignored then. */
  isBusy: () => boolean;
}

/** Wheel deltas below this are momentum tail or a trackpad drift, not intent. */
const WHEEL_THRESHOLD = 28;
/** Minimum gap between committed moves, so one flick is never two scenes. */
const COOLDOWN_MS = 420;
const SWIPE_DISTANCE = 45;

export class NavigationController {
  private readonly handlers: NavigationHandlers;
  private readonly target: HTMLElement;
  private lastMove = 0;
  private wheelAccumulator = 0;
  private wheelReset = 0;
  private touchStart: { x: number; y: number } | null = null;
  private detached: Array<() => void> = [];

  constructor(target: HTMLElement, handlers: NavigationHandlers) {
    this.target = target;
    this.handlers = handlers;
    this.attach();
  }

  private ready(): boolean {
    return !this.handlers.isBusy() && performance.now() - this.lastMove > COOLDOWN_MS;
  }

  private commit(direction: 1 | -1): void {
    if (!this.ready()) return;
    this.lastMove = performance.now();
    this.wheelAccumulator = 0;
    if (direction === 1) this.handlers.onNext();
    else this.handlers.onPrevious();
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    // Accumulate rather than firing per event: a trackpad emits dozens of tiny
    // deltas for one physical swipe, a mouse emits one large one, and both
    // should mean exactly one scene.
    this.wheelAccumulator += event.deltaY;

    clearTimeout(this.wheelReset);
    this.wheelReset = window.setTimeout(() => {
      this.wheelAccumulator = 0;
    }, 160);

    if (Math.abs(this.wheelAccumulator) < WHEEL_THRESHOLD) return;
    this.commit(this.wheelAccumulator > 0 ? 1 : -1);
  };

  private handleKey = (event: KeyboardEvent): void => {
    const withinControl =
      event.target instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
    if (withinControl) return;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        event.preventDefault();
        this.commit(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault();
        this.commit(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.handlers.onJump(0);
        break;
      case 'End':
        event.preventDefault();
        this.handlers.onJump(Number.MAX_SAFE_INTEGER);
        break;
      case 'Enter':
      case 'f':
      case 'F':
        this.handlers.onDetailToggle();
        break;
      default:
        break;
    }
  };

  private handleTouchStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    this.touchStart = { x: touch.clientX, y: touch.clientY };
  };

  private handleTouchEnd = (event: TouchEvent): void => {
    if (!this.touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    this.touchStart = null;

    // Whichever axis dominates wins, so a vertical flick and a horizontal one
    // both work and a diagonal resolves predictably.
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const distance = horizontal ? dx : dy;
    if (Math.abs(distance) < SWIPE_DISTANCE) return;

    this.commit(distance < 0 ? 1 : -1);
  };

  private handleTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
  };

  private attach(): void {
    const add = <K extends keyof WindowEventMap>(
      element: Window | HTMLElement,
      type: K,
      listener: (event: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      element.addEventListener(type, listener as EventListener, options);
      this.detached.push(() => element.removeEventListener(type, listener as EventListener));
    };

    add(this.target, 'wheel', this.handleWheel, { passive: false });
    add(window, 'keydown', this.handleKey);
    add(this.target, 'touchstart', this.handleTouchStart, { passive: true });
    add(this.target, 'touchmove', this.handleTouchMove, { passive: false });
    add(this.target, 'touchend', this.handleTouchEnd, { passive: true });
  }

  destroy(): void {
    clearTimeout(this.wheelReset);
    this.detached.forEach((remove) => remove());
    this.detached = [];
  }
}
