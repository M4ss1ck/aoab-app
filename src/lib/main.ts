import gsap from 'gsap';
import { GalleryRenderer } from './gl/renderer';
import { NavigationController } from './navigation';
import { Chrome } from './chrome';
import { Intro, introAlreadySeen } from './intro';
import { Finale } from './finale';
import type { Scene } from './scenes';

interface BootData {
  scenes: Scene[];
  tiers: number[];
  hero: {
    artTiers: Record<number, string>;
    artUrl: string;
    edgeUrl: string | null;
    aspect: number;
    palette: string[];
  };
}

/**
 * Wires the pieces together and decides which of the three render paths runs.
 *
 * The no-WebGL path is not an error state: the fallback gallery is already in
 * the document, server-rendered with real images. WebGL is an enhancement that
 * replaces it, so a failure anywhere in here leaves a working site behind.
 */
export function boot(data: BootData): void {
  const root = document.querySelector<HTMLElement>('[data-experience]');
  const canvas = document.querySelector<HTMLCanvasElement>('[data-gallery-canvas]');
  const introCanvas = document.querySelector<HTMLCanvasElement>('[data-intro-canvas]');
  const fallback = document.querySelector<HTMLElement>('[data-fallback]');

  // Any early return here means the enhanced experience is not happening, so
  // the server-rendered gallery has to come back.
  const restoreFallback = () => {
    delete document.documentElement.dataset.js;
  };

  if (!root || !canvas || !introCanvas || !fallback) {
    restoreFallback();
    return;
  }
  if (!data.scenes.length || !supportsWebGL()) {
    restoreFallback();
    return;
  }

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = motionQuery.matches;

  let renderer: GalleryRenderer;
  try {
    renderer = new GalleryRenderer({
      canvas,
      scenes: data.scenes,
      tiers: data.tiers,
      reducedMotion,
    });
  } catch {
    // A context that reports as available but fails to build a program is real
    // (old drivers, blocklisted GPUs). Keep the fallback rather than a blank page.
    restoreFallback();
    return;
  }

  // From here the enhanced experience owns the page.
  root.dataset.mode = 'webgl';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.hidden = true;
  document.documentElement.classList.add('is-enhanced');

  const chrome = new Chrome(
    {
      root,
      title: must(root, '[data-scene-title]'),
      counter: must(root, '[data-scene-counter]'),
      credit: must(root, '[data-scene-credit]'),
      rail: must(root, '[data-rail]'),
      announcer: must(root, '[data-announcer]'),
      detailHint: must(root, '[data-detail-hint]'),
    },
    data.scenes,
    reducedMotion,
  );

  renderer.onSceneChange = (index, scene) => chrome.update(index, scene);
  renderer.start();

  let detail = false;
  const setDetail = (active: boolean) => {
    detail = active;
    renderer.setDetail(active);
    chrome.setDetail(active);
  };

  const finale = new Finale(root, reducedMotion);
  const lastIndex = data.scenes.length - 1;

  const leaveFinale = (index: number) => {
    finale.hide();
    root.dataset.finaleOpen = 'false';
    root.focus({ preventScroll: true });
    if (index !== renderer.index) void renderer.goTo(index);
  };

  finale.onReturnTo = leaveFinale;
  finale.onBack = () => leaveFinale(lastIndex);
  finale.onReplay = () => leaveFinale(0);

  const advance = () => {
    // Past the last scene the sequence resolves into the closing composition
    // rather than looping or dead-ending.
    if (finale.isVisible) return;
    if (renderer.index === lastIndex) {
      root.dataset.finaleOpen = 'true';
      finale.show();
      return;
    }
    void renderer.next();
  };

  const retreat = () => {
    if (finale.isVisible) {
      leaveFinale(lastIndex);
      return;
    }
    void renderer.previous();
  };

  const navigation = new NavigationController(root, {
    onNext: advance,
    onPrevious: retreat,
    onJump: (index) => {
      if (finale.isVisible) leaveFinale(Math.min(index, lastIndex));
      else void renderer.goTo(Math.min(index, lastIndex));
    },
    onDetailToggle: () => {
      if (!finale.isVisible) setDetail(!detail);
    },
    // The renderer queues one move of its own, so input is never dropped; the
    // controller's cooldown is what keeps a single gesture to a single scene.
    isBusy: () => false,
  });

  chrome.onJump = (index) => {
    if (finale.isVisible) leaveFinale(index);
    else void renderer.goTo(index);
  };

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (detail) setDetail(false);
    else if (finale.isVisible) leaveFinale(lastIndex);
  });

  // Live switch: someone turning reduced motion on mid-visit should not have to
  // reload to be taken seriously.
  motionQuery.addEventListener('change', (event) => {
    if (event.matches) window.location.reload();
  });

  // The intro waits on the opening scene only - not two, and certainly not all
  // ten. The second is prefetched during the intro and again on idle, so it is
  // there long before anyone can reach it, and time-to-first-frame stays flat
  // however large the gallery grows.
  const firstScenes = data.scenes.slice(0, 1).map((scene) => scene.id);

  // Deliberately lazy. Decoding gallery textures while the hero is still being
  // decoded and drawn makes both slower and delays the first paint; the intro
  // starts this once it has something on screen.
  let beginLoading = () => {};
  const loading = new Promise<void>((resolve) => {
    beginLoading = () => {
      void renderer.waitForScenes(firstScenes).then(resolve, resolve);
    };
  });

  const skipButton = root.querySelector<HTMLButtonElement>('[data-intro-skip]');
  const progressBar = root.querySelector<HTMLElement>('[data-intro-progress]');
  const progressValue = root.querySelector<HTMLElement>('[data-intro-progress-value]');
  const introLayer = root.querySelector<HTMLElement>('[data-intro]');

  const startGallery = () => {
    introLayer?.setAttribute('hidden', '');
    chrome.reveal();
    void renderer.reveal(reducedMotion ? 0.3 : 1.1);
    renderer.onSceneChange?.(0, data.scenes[0]);
    chrome.update(0, data.scenes[0]);
    root.focus({ preventScroll: true });
  };

  if (introAlreadySeen()) {
    introLayer?.setAttribute('hidden', '');
    beginLoading();
    void loading.then(startGallery);
    return;
  }

  const intro = new Intro({
    canvas: introCanvas,
    artTiers: data.hero.artTiers,
    artUrl: data.hero.artUrl,
    edgeUrl: data.hero.edgeUrl,
    aspect: data.hero.aspect,
    palette: data.hero.palette,
    reducedMotion,
    loading,
    onHeroReady: () => beginLoading(),
    onProgress: (value) => {
      const percent = Math.round(value * 100);
      if (progressBar) {
        progressBar.style.setProperty('--progress', String(value));
        progressBar.setAttribute('aria-valuenow', String(percent));
      }
      if (progressValue) progressValue.textContent = `${String(percent).padStart(3, '0')}`;
    },
  });

  intro.start();
  skipButton?.addEventListener('click', () => intro.skip());

  void intro.run().then(() => {
    intro.destroy();
    startGallery();
    animateWordmark(root, reducedMotion);
  });

  window.addEventListener('pagehide', () => {
    navigation.destroy();
    renderer.destroy();
  });
}

/** Collapses the three-line intro lockup down to the persistent monogram. */
function animateWordmark(root: HTMLElement, reducedMotion: boolean): void {
  const lockup = root.querySelector<HTMLElement>('[data-wordmark]');
  if (!lockup) return;

  if (reducedMotion) {
    lockup.dataset.state = 'mark';
    return;
  }

  gsap.to(lockup, {
    duration: 0.9,
    ease: 'power3.inOut',
    onStart: () => {
      lockup.dataset.state = 'mark';
    },
  });
}

function must(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`missing required element ${selector}`);
  return element;
}

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(
      probe.getContext('webgl2') ??
        probe.getContext('webgl') ??
        probe.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}
