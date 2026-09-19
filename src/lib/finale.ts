import gsap from 'gsap';

/**
 * The closing composition.
 *
 * Handles showing, hiding and focus. The tiles are inert while the finale is
 * hidden - they are real buttons, so leaving them in the tab order would let
 * someone tab into an invisible grid from the gallery.
 */
export class Finale {
  private readonly element: HTMLElement;
  private readonly wall: HTMLElement;
  private readonly tiles: HTMLButtonElement[];
  private readonly reducedMotion: boolean;
  private visible = false;

  onReturnTo?: (index: number) => void;
  onReplay?: () => void;
  onBack?: () => void;

  constructor(root: ParentNode, reducedMotion: boolean) {
    const element = root.querySelector<HTMLElement>('[data-finale]');
    if (!element) throw new Error('finale markup missing');

    this.element = element;
    this.reducedMotion = reducedMotion;
    this.wall = element.querySelector<HTMLElement>('[data-finale-wall]')!;
    this.tiles = [...element.querySelectorAll<HTMLButtonElement>('[data-finale-tile]')];

    this.tiles.forEach((tile) => {
      tile.addEventListener('click', () => {
        const index = Number(tile.dataset.index);
        if (!Number.isNaN(index)) this.onReturnTo?.(index);
      });
    });

    element
      .querySelector<HTMLButtonElement>('[data-finale-replay]')
      ?.addEventListener('click', () => this.onReplay?.());
    element
      .querySelector<HTMLButtonElement>('[data-finale-back]')
      ?.addEventListener('click', () => this.onBack?.());
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;

    this.element.hidden = false;
    this.element.removeAttribute('aria-hidden');
    this.wall.removeAttribute('aria-hidden');
    this.tiles.forEach((tile) => tile.removeAttribute('tabindex'));

    if (this.reducedMotion) {
      gsap.set(this.element, { opacity: 1 });
      gsap.set(this.tiles, { opacity: 1, scale: 1, y: 0, rotate: 0 });
      this.focusPanel();
      return;
    }

    const timeline = gsap.timeline({ onComplete: () => this.focusPanel() });

    timeline
      .fromTo(this.element, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' })
      .fromTo(
        this.tiles,
        {
          opacity: 0,
          scale: 0.72,
          // Each tile arrives from a different direction, so the wall assembles
          // rather than simply appearing.
          y: (index: number) => (index % 2 === 0 ? 70 : -70),
          rotate: (index: number) => (index % 3 === 0 ? -6 : 4),
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          rotate: 0,
          duration: 0.85,
          ease: 'power3.out',
          stagger: { each: 0.055, from: 'center' },
        },
        '-=0.25',
      )
      .fromTo(
        this.element.querySelectorAll('.finale__panel > *'),
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ease: 'power2.out' },
        '-=0.55',
      );
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;

    this.tiles.forEach((tile) => tile.setAttribute('tabindex', '-1'));
    this.wall.setAttribute('aria-hidden', 'true');

    gsap.to(this.element, {
      opacity: 0,
      duration: this.reducedMotion ? 0.001 : 0.4,
      onComplete: () => {
        this.element.hidden = true;
      },
    });
  }

  /** Moves focus into the panel so keyboard users are not left behind. */
  private focusPanel(): void {
    this.element.querySelector<HTMLButtonElement>('[data-finale-replay]')?.focus();
  }
}
