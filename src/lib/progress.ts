import gsap from 'gsap';

/**
 * Paces the intro's loading indicator.
 *
 * Two clocks drive the intro: real loading, which can finish in 200ms or take
 * seconds, and the drawing animation, which has a fixed length. The indicator
 * has to read as honest against both, so it climbs on its own while the wait is
 * genuine, holds just short of complete while the animation lands, and only
 * reaches 100 when there is nothing left to wait for.
 *
 * Reported values never go backwards. That is the whole reason this is a class
 * and not two tweens in the intro: a climb tween and a completion tween running
 * against the same callback will fight, and the slower one wins the last frame.
 */
export class ProgressPacer {
  /** Ceiling on the blind climb, so an unfinished load never looks finished. */
  private static readonly CLIMB_CAP = 0.92;
  /** Where the indicator waits out the animation once loading is really done. */
  private static readonly READY_FLOOR = 0.99;

  private readonly report: (value: number) => void;
  private readonly duration: number;
  private readonly pace = { value: 0 };
  private tween: gsap.core.Tween | null = null;
  private ready = false;
  private settled = false;
  private last = 0;

  constructor(report: (value: number) => void, duration: number) {
    this.report = report;
    this.duration = duration;
  }

  /** The most recent value handed to the callback, 0..1. */
  get value(): number {
    return this.last;
  }

  /** Begins the climb. Ignored once settled, so a late start cannot rewind. */
  start(): void {
    if (this.settled || this.tween) return;
    this.tween = gsap.to(this.pace, {
      value: 1,
      duration: this.duration,
      ease: 'power2.out',
      onUpdate: () => this.emit(this.pace.value * ProgressPacer.CLIMB_CAP),
    });
  }

  /**
   * The real work is done, but the sequence is still playing. Runs up to
   * READY_FLOOR and waits there; the last percent belongs to `settle`.
   *
   * On a fast connection this fires while the climb is still in the teens, so
   * it counts up over `duration` instead of snapping. A counter that leaps from
   * 012 to 099 reads as broken even though both numbers are true.
   */
  markReady(duration = 0): void {
    if (this.settled || this.ready) return;
    this.ready = true;
    // Deliberately not 1: 100 is reserved for `settle`, so the indicator can
    // never claim to be finished while the sequence is still playing.
    const target = ProgressPacer.READY_FLOOR;
    if (duration <= 0 || this.last >= target) {
      this.emit(target);
      return;
    }
    this.tween?.kill();
    const step = { value: this.last };
    this.tween = gsap.to(step, {
      value: target,
      duration,
      ease: 'power2.out',
      onUpdate: () => this.emit(step.value),
      onComplete: () => this.emit(target),
    });
  }

  /**
   * Takes the indicator to 100 and stops every other source of updates, so
   * nothing can write a lower number after it. `duration` counts the last step
   * up, and should fit inside whatever fade follows.
   */
  settle(duration = 0): void {
    if (this.settled) {
      // A second call means something cut the sequence short mid-count, such as
      // the skip control during the fade. End on 100 rather than freezing the
      // count wherever it happened to be.
      this.tween?.kill();
      this.tween = null;
      this.emit(1);
      return;
    }
    this.settled = true;
    this.tween?.kill();
    this.tween = null;

    if (duration <= 0 || this.last >= 1) {
      this.emit(1);
      return;
    }

    const step = { value: this.last };
    this.tween = gsap.to(step, {
      value: 1,
      duration,
      ease: 'power1.out',
      onUpdate: () => this.emit(step.value),
      onComplete: () => this.emit(1),
    });
  }

  /** Drops the tween without reporting anything further. */
  destroy(): void {
    this.tween?.kill();
    this.tween = null;
  }

  private emit(value: number): void {
    const next = Math.min(1, Math.max(this.last, value));
    if (next === this.last) return;
    this.last = next;
    this.report(next);
  }
}
