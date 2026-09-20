import gsap from 'gsap';
import type { Scene } from './scenes';
import { hexToRgb, rgbToCss, darken, inkFor } from './colour';
import { creditSummary } from './ordering';

/**
 * The DOM layer over the canvas: titles, credits, the scene rail, and the
 * colour retuning that makes each scene feel like it owns the whole page.
 *
 * Discipline matters here. The extracted palette only ever drives backdrop,
 * glow and rule colours; type stays on a fixed scale and switches between two
 * inks by measured luminance, so contrast never depends on what an artist
 * happened to paint.
 */

export interface ChromeElements {
  root: HTMLElement;
  title: HTMLElement;
  counter: HTMLElement;
  credit: HTMLElement;
  rail: HTMLElement;
  announcer: HTMLElement;
  detailHint: HTMLElement;
}

export class Chrome {
  private readonly elements: ChromeElements;
  private readonly scenes: Scene[];
  private readonly reducedMotion: boolean;
  private readonly dots: HTMLButtonElement[] = [];

  constructor(elements: ChromeElements, scenes: Scene[], reducedMotion: boolean) {
    this.elements = elements;
    this.scenes = scenes;
    this.reducedMotion = reducedMotion;
    this.buildRail();
  }

  onJump?: (index: number) => void;

  private buildRail(): void {
    this.scenes.forEach((scene, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'rail__dot';
      dot.dataset.index = String(index);
      // The rail is the only visible jump control, so it has to read properly
      // to a screen reader rather than being ten unlabelled dots.
      dot.setAttribute('aria-label', `Scene ${index + 1} of ${this.scenes.length}: ${scene.title}`);
      dot.addEventListener('click', () => this.onJump?.(index));
      this.elements.rail.append(dot);
      this.dots.push(dot);
    });
  }

  update(index: number, scene: Scene): void {
    const accent = hexToRgb(scene.palette[0]);
    const secondary = hexToRgb(scene.palette[1] ?? scene.palette[0]);
    const backdrop = darken(accent, 0.12);
    const ink = inkFor(backdrop);

    const style = this.elements.root.style;
    style.setProperty('--accent', rgbToCss(accent));
    style.setProperty('--accent-soft', rgbToCss(accent, 0.24));
    style.setProperty('--secondary', rgbToCss(secondary));
    style.setProperty('--backdrop', rgbToCss(backdrop));
    // Bare channels so the scrims can composite the backdrop at partial alpha.
    // The scrim is what guarantees the type stays readable: the artwork behind
    // it ranges from near-black to near-white and cannot be relied on.
    style.setProperty('--backdrop-rgb', backdrop.map((c) => Math.round(c * 255)).join(' '));
    this.elements.root.dataset.ink = ink;

    this.elements.counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(
      this.scenes.length,
    ).padStart(2, '0')}`;

    this.setTitle(scene.title);
    this.setCredit(scene);

    this.dots.forEach((dot, dotIndex) => {
      const active = dotIndex === index;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });

    // Screen readers get the scene change as a whole statement; the visual
    // animation below is meaningless to them.
    this.elements.announcer.textContent = `Scene ${index + 1} of ${this.scenes.length}. ${
      scene.title
    }, ${scene.credit ? `by ${scene.credit.artist}` : 'artist untraced'}.`;
  }

  private setTitle(title: string): void {
    const element = this.elements.title;

    if (this.reducedMotion) {
      element.textContent = title;
      return;
    }

    // Per-character spans so the title can resolve rather than simply appear.
    element.textContent = '';
    const letters = [...title].map((character) => {
      const span = document.createElement('span');
      span.className = 'scene-title__char';
      span.textContent = character === ' ' ? ' ' : character;
      element.append(span);
      return span;
    });

    gsap.fromTo(
      letters,
      { yPercent: 110, opacity: 0 },
      {
        yPercent: 0,
        opacity: 1,
        duration: 0.7,
        ease: 'power3.out',
        stagger: { each: 0.028, from: 'start' },
      },
    );
  }

  private setCredit(scene: Scene): void {
    const element = this.elements.credit;
    element.textContent = '';
    element.hidden = false;

    const label = document.createElement('span');
    label.className = 'credit__label';
    label.textContent = 'Artwork';

    // An untraced piece says so beside the artwork, so the gallery never reads
    // as fully attributed while it is not - but only while that distinguishes
    // this piece from the others. When nothing at all has been traced, the note
    // in the finale and the fallback makes the statement once instead.
    if (!scene.credit) {
      if (!creditSummary(this.scenes).labelPerItem) {
        element.hidden = true;
        return;
      }

      const unknown = document.createElement('span');
      unknown.className = 'credit__name credit__name--unknown';
      unknown.textContent = 'Artist untraced';
      element.append(label, unknown);
      this.revealCredit(element);
      return;
    }

    const name = scene.credit.url ? document.createElement('a') : document.createElement('span');
    name.className = 'credit__name';
    name.textContent = scene.credit.artist;
    if (name instanceof HTMLAnchorElement && scene.credit.url) {
      name.href = scene.credit.url;
      name.rel = 'noopener noreferrer';
      name.target = '_blank';
    }

    element.append(label, name);

    if (scene.credit.license) {
      const license = document.createElement('span');
      license.className = 'credit__license';
      license.textContent = scene.credit.license;
      element.append(license);
    }

    this.revealCredit(element);
  }

  private revealCredit(element: HTMLElement): void {
    if (this.reducedMotion) return;
    gsap.fromTo(element, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.35 });
  }

  setDetail(active: boolean): void {
    this.elements.root.dataset.detail = active ? 'true' : 'false';
    this.elements.detailHint.textContent = active ? 'Press Esc to return' : 'Press F for detail';
  }

  reveal(): void {
    this.elements.root.dataset.ready = 'true';
  }
}
