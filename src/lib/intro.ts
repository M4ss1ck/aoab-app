import { Renderer, Program, Mesh, Triangle, Texture } from 'ogl';
import gsap from 'gsap';
import { INTRO_FRAGMENT } from './gl/glsl/intro';
import { SCENE_VERTEX } from './gl/glsl/scene';
import { hexToRgb } from './colour';
import { decodeImage } from './gl/decode';
import { ProgressPacer } from './progress';

export interface IntroOptions {
  canvas: HTMLCanvasElement;
  /** Hero widths keyed by their intrinsic width, for per-device selection. */
  artTiers: Record<number, string>;
  artUrl: string;
  edgeUrl: string | null;
  aspect: number;
  palette: string[];
  reducedMotion: boolean;
  /** Resolves when the first gallery textures are in. Drives honest progress. */
  loading: Promise<void>;
  onProgress: (value: number) => void;
  /**
   * Fired once the hero has decoded. The caller uses it to start loading the
   * gallery textures, so the hero is not competing for CPU with work that is
   * not on screen yet.
   */
  onHeroReady?: () => void;
}

/** Hard ceiling on the whole sequence. */
const MAX_DURATION = 3;
/**
 * Progress is bound to real loading, but a fast connection can finish in under
 * 200ms and there is no point animating a drawing nobody sees. The floor is the
 * shortest run in which the three phases still read.
 */
const MIN_DURATION = 2.2;
/**
 * How long the counter takes to run up to its holding value once loading is
 * genuinely done, and how long the final step to 100 takes across the fade.
 * Both are count-ups rather than jumps: a number that leaps reads as broken.
 */
const PROGRESS_CATCH_UP = 0.8;
const PROGRESS_FINISH = 0.35;

/*
 * The intro runs on every visit rather than once per session.
 *
 * It is the strongest thing on the page and the reason the site is memorable,
 * and it is short and skippable, so hiding it from returning visitors costs
 * more than it saves. The skip control is visible from the first frame for
 * anyone who disagrees.
 */

export class Intro {
  private readonly renderer: Renderer;
  private readonly program: Program;
  private readonly mesh: Mesh;
  private readonly options: IntroOptions;
  private raf = 0;
  private startedAt = performance.now();
  /**
   * Same render-on-demand deadline as the gallery.
   *
   * Before the hero decodes, the intro is a flat sheet of paper that CSS can
   * paint for free. Rendering a full-screen shader at 60fps through that window
   * competes with the very work it is waiting for, and on a mid-tier phone it
   * measurably delays the first paint of the wordmark beside it.
   */
  private renderUntil = 0;
  private timeline?: gsap.core.Timeline;
  private finished = false;
  private resolveFinished?: () => void;
  private resolveHeroReady?: (loaded: boolean) => void;
  private readonly heroReady: Promise<boolean>;
  private readonly progress: ProgressPacer;

  constructor(options: IntroOptions) {
    this.options = options;
    this.progress = new ProgressPacer((value) => options.onProgress(value), MAX_DURATION * 1.6);
    this.heroReady = new Promise<boolean>((resolve) => {
      this.resolveHeroReady = resolve;
    });

    this.renderer = new Renderer({
      canvas: options.canvas,
      alpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });

    const gl = this.renderer.gl;
    const art = new Texture(gl, { generateMipmaps: false });
    const edges = new Texture(gl, { generateMipmaps: false });
    edges.image = new Uint8Array([0, 0, 0, 255]);
    edges.width = 1;
    edges.height = 1;

    const paper = hexToRgb('#f4f1ea');
    const graphite = hexToRgb('#2a2622');

    this.program = new Program(gl, {
      vertex: SCENE_VERTEX,
      fragment: INTRO_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      uniforms: {
        uArt: { value: art },
        uEdges: { value: edges },
        uAspect: { value: options.aspect },
        uViewAspect: { value: 1 },
        uDraw: { value: 0 },
        uInk: { value: 0 },
        uColour: { value: 0 },
        uTime: { value: 0 },
        uFade: { value: 1 },
        uPaper: { value: paper },
        uGraphite: { value: graphite },
        uAccent: { value: hexToRgb(options.palette[0] ?? '#e2c610') },
        uGrainAmount: { value: 0.03 },
        uHasEdges: { value: 0 },
        uHasArt: { value: 0 },
        // The rectangle of the viewport the artwork is composed into, in 0-1
        // screen space. The wordmark takes what is left. Set by resize().
        uArtMin: { value: [0, 0] },
        uArtMax: { value: [1, 1] },
      },
    });

    this.mesh = new Mesh(gl, { geometry: new Triangle(gl), program: this.program });

    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });

    void this.loadTextures(art, edges);
  }

  private async loadTextures(art: Texture, edges: Texture): Promise<void> {
    const [artImage, edgeImage] = await Promise.all([
      decodeImage(this.pickArtUrl()).catch(() => null),
      this.options.edgeUrl ? decodeImage(this.options.edgeUrl).catch(() => null) : null,
    ]);

    if (artImage) {
      art.image = artImage;
      this.program.uniforms.uHasArt.value = 1;
      // There is something to draw now, so the canvas starts earning its frames.
      this.keepRendering(MAX_DURATION + 1);
    }
    this.options.onHeroReady?.();
    if (edgeImage) {
      edges.image = edgeImage;
      this.program.uniforms.uHasEdges.value = 1;
    }
    // Resolves even when the hero fails to load: the sequence must not hang on
    // a missing decoration. The shader falls back to the luminance edge path.
    this.resolveHeroReady?.(Boolean(artImage));
  }

  /** Smallest hero rendition that still covers this display. */
  private pickArtUrl(): string {
    // The head script already chose and preloaded one rendition; reusing its
    // answer is what guarantees a cache hit instead of a second download.
    const preselected = (window as Window & { __heroUrl?: string }).__heroUrl;
    if (preselected) return preselected;

    const widths = Object.keys(this.options.artTiers)
      .map(Number)
      .sort((a, b) => a - b);
    if (!widths.length) return this.options.artUrl;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wanted = Math.max(window.innerWidth, window.innerHeight) * dpr;
    const chosen = widths.find((width) => width >= wanted) ?? widths[widths.length - 1];
    return this.options.artTiers[chosen] ?? this.options.artUrl;
  }

  /** Keeps drawing for the given duration, in seconds. */
  private keepRendering(seconds: number): void {
    this.renderUntil = Math.max(this.renderUntil, performance.now() + seconds * 1000);
  }

  private resize = (): void => {
    if (this.program.uniforms.uHasArt.value === 1) this.keepRendering(0.4);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const viewAspect = window.innerWidth / window.innerHeight;
    this.program.uniforms.uViewAspect.value = viewAspect;

    // Landscape reads as a poster: the hero holds the right, the lockup the
    // left. Portrait has no room for that, so the hero takes the upper band
    // and the type sits beneath it.
    //
    // These are in the shader's coordinate space, where y points UP - so the
    // portrait band is 0.4-1.0, not 0-0.6.
    const portrait = viewAspect < 1.05;
    this.program.uniforms.uArtMin.value = portrait ? [0, 0.4] : [0.34, 0.02];
    this.program.uniforms.uArtMax.value = portrait ? [1, 1] : [1, 0.98];
    this.options.canvas.parentElement?.setAttribute(
      'data-intro-layout',
      portrait ? 'portrait' : 'landscape',
    );
  };

  /**
   * Runs the sequence and resolves when it is done.
   *
   * Progress is real: it tracks the loading promise. The timeline is held at
   * the end of the drawing phase until loading actually completes, so the
   * indicator never claims to be finished while it is not - but it also never
   * runs longer than MAX_DURATION, because by then the images are in and what
   * remains is the animation, not the wait.
   */
  run(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveFinished = resolve;

      if (this.options.reducedMotion) {
        // No drawing, no sweep: straight to the finished artwork, then out.
        this.program.uniforms.uDraw.value = 1;
        this.program.uniforms.uInk.value = 1;
        this.program.uniforms.uColour.value = 1;
        this.progress.settle();
        void this.heroReady.then(() => this.keepRendering(0.2));
        void this.options.loading.then(() => {
          gsap.to(this.program.uniforms.uFade, {
            value: 0,
            duration: 0.4,
            onComplete: () => this.finish(),
          });
        });
        return;
      }

      void this.options.loading.then(() => this.progress.markReady(PROGRESS_CATCH_UP));

      // Progress is honest in both directions. It rises smoothly so it never
      // looks stuck, but it is capped below 100 until the artwork has actually
      // arrived, and the handover waits for the same signal.
      this.progress.start();

      void this.heroReady.then(() => {
        if (this.finished) return;

        // The drawing can only start once there is something to draw. Until
        // then the shader shows blank paper and the progress bar carries the
        // wait, which is what a loader is for.
        this.timeline = gsap.timeline();

        this.timeline
          .to(this.program.uniforms.uDraw, {
            value: 1,
            duration: MIN_DURATION * 0.55,
            ease: 'power1.inOut',
          })
          .to(this.program.uniforms.uInk, { value: 1, duration: 0.45, ease: 'power2.out' }, '-=0.35')
          .to(
            this.program.uniforms.uColour,
            { value: 1, duration: MIN_DURATION * 0.4, ease: 'power2.inOut' },
            '+=0.05',
          )
          .call(() => {
            // Hold on the finished artwork rather than fading out into an
            // unpainted gallery. Looking at the hero a moment longer is a far
            // better failure mode than a black screen. The held frame is static,
            // so there is nothing to redraw while waiting.
            this.timeline?.pause();
            this.renderUntil = performance.now();
            void this.options.loading.then(() => {
              // Counts the last percent up across the fade rather than snapping,
              // so the indicator is seen reaching 100 instead of stopping at 099.
              this.progress.settle(PROGRESS_FINISH);
              this.keepRendering(1);
              gsap.to(this.program.uniforms.uFade, {
                value: 0,
                duration: 0.55,
                ease: 'power2.in',
                onComplete: () => this.finish(),
              });
            });
          });
      });
    });
  }

  /** Jumps to the end. Used by the skip control. */
  skip(): void {
    this.keepRendering(1);
    this.timeline?.pause();
    this.timeline?.kill();
    gsap.killTweensOf(this.program.uniforms.uDraw);
    gsap.killTweensOf(this.program.uniforms.uInk);
    gsap.killTweensOf(this.program.uniforms.uColour);
    gsap.killTweensOf(this.program.uniforms.uFade);
    this.progress.settle();
    this.program.uniforms.uFade.value = 0;
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.resolveFinished?.();
  }

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (now > this.renderUntil) return;
      this.program.uniforms.uTime.value = (now - this.startedAt) / 1000;
      this.renderer.render({ scene: this.mesh });
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.progress.destroy();
    this.timeline?.kill();
    window.removeEventListener('resize', this.resize);
  }
}

