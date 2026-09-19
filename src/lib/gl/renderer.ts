import { Renderer, Program, Mesh, Triangle } from 'ogl';
import gsap from 'gsap';
import { SCENE_VERTEX, SCENE_FRAGMENT } from './glsl/scene';
import { TextureManager } from './textures';
import type { Scene } from '../scenes';
import { hexToRgb, darken } from '../colour';

const TRANSITION_INDEX = { parametric: 0, water: 1, starfield: 2 } as const;

export interface GalleryRendererOptions {
  canvas: HTMLCanvasElement;
  scenes: Scene[];
  tiers: readonly number[];
  reducedMotion: boolean;
}

/**
 * Owns the canvas, the single scene program and the transition timeline.
 *
 * Deliberately knows nothing about input. The navigation controller tells it
 * where to go; it decides how that looks.
 */
export class GalleryRenderer {
  private readonly renderer: Renderer;
  private readonly program: Program;
  private readonly mesh: Mesh;
  private readonly textures: TextureManager;
  private readonly scenes: Scene[];
  private readonly reducedMotion: boolean;

  private current = 0;
  private transitioning = false;
  /**
   * One pending destination.
   *
   * Set-piece transitions run up to 1.85s, and simply ignoring input for that
   * long reads as lag. Queueing one move instead means an impatient press is
   * always honoured, while a depth of exactly one stops a spun wheel from
   * buying a ten-scene journey.
   */
  private queued: number | null = null;
  private raf = 0;
  private startedAt = performance.now();
  /**
   * Render-on-demand.
   *
   * A full-screen fragment shader redrawn 60 times a second forever is the
   * single most expensive thing on this page, and almost all of those frames
   * are identical. Work is scheduled explicitly instead: anything that changes
   * what is on screen extends this deadline, and outside it the loop idles.
   */
  private renderUntil = 0;

  /** Pointer in -1..1, smoothed towards the raw value every frame. */
  private pointer = { x: 0, y: 0 };
  private pointerTarget = { x: 0, y: 0 };

  private restState = { value: 0 };
  private restTween?: gsap.core.Tween;

  onSceneChange?: (index: number, scene: Scene) => void;

  constructor({ canvas, scenes, tiers, reducedMotion }: GalleryRendererOptions) {
    this.scenes = scenes;
    this.reducedMotion = reducedMotion;

    this.renderer = new Renderer({
      canvas,
      alpha: false,
      antialias: false,
      // Half-resolution on phones is invisible next to grain and full-bleed art,
      // and it is the single biggest win for sustained frame rate.
      dpr: Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.25 : 2),
    });

    const gl = this.renderer.gl;
    gl.clearColor(0, 0, 0, 1);

    this.textures = new TextureManager(gl, tiers);
    scenes.forEach((scene) => this.textures.register(scene));

    const first = this.textures.get(scenes[0].id);

    this.program = new Program(gl, {
      vertex: SCENE_VERTEX,
      fragment: SCENE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uFromTex: { value: first.colour },
        uFromDepth: { value: first.depth },
        uToTex: { value: first.colour },
        uToDepth: { value: first.depth },
        uFromAspect: { value: scenes[0].aspect },
        uToAspect: { value: scenes[0].aspect },
        uFromFocus: { value: focusToShaderSpace(scenes[0].focus) },
        uToFocus: { value: focusToShaderSpace(scenes[0].focus) },
        uFromRest: { value: 0 },
        uToRest: { value: 0 },
        uFromColor: { value: hexToRgb(scenes[0].palette[0]) },
        uToColor: { value: hexToRgb(scenes[0].palette[0]) },
        uBackdrop: { value: darken(hexToRgb(scenes[0].palette[0]), 0.12) },
        uViewAspect: { value: 1 },
        uPointer: { value: [0, 0] },
        uProgress: { value: 0 },
        uTransition: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uParallax: { value: reducedMotion ? 0 : 1 },
        uGrainAmount: { value: 0.022 },
        uAberration: { value: reducedMotion ? 0 : 1 },
        uFade: { value: 0 },
        uActive: { value: 0 },
      },
    });

    this.mesh = new Mesh(gl, { geometry: new Triangle(gl), program: this.program });

    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
    if (!reducedMotion) {
      window.addEventListener('pointermove', this.handlePointer, { passive: true });
    }

    this.applyScene(0);
    this.textures.prefetch(this.neighbours(0));
  }

  private neighbours(index: number): string[] {
    return [this.scenes[index + 1], this.scenes[index - 1]]
      .filter((scene): scene is Scene => Boolean(scene))
      .map((scene) => scene.id);
  }

  /** Keeps drawing for the given duration, in seconds. */
  private keepRendering(seconds: number): void {
    this.renderUntil = Math.max(this.renderUntil, performance.now() + seconds * 1000);
  }

  private resize = (): void => {
    this.keepRendering(0.4);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.program.uniforms.uViewAspect.value = width / height;
  };

  private handlePointer = (event: PointerEvent): void => {
    // The smoothing tail runs on after the pointer stops, so cover it.
    this.keepRendering(0.9);
    this.pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerTarget.y = -((event.clientY / window.innerHeight) * 2 - 1);
  };

  /** Snaps both layers to one scene with no transition. */
  private applyScene(index: number): void {
    const scene = this.scenes[index];
    const textures = this.textures.get(scene.id);
    const uniforms = this.program.uniforms;

    uniforms.uFromTex.value = textures.colour;
    uniforms.uFromDepth.value = textures.depth;
    uniforms.uToTex.value = textures.colour;
    uniforms.uToDepth.value = textures.depth;
    uniforms.uFromAspect.value = scene.aspect;
    uniforms.uToAspect.value = scene.aspect;
    uniforms.uFromFocus.value = focusToShaderSpace(scene.focus);
    uniforms.uToFocus.value = focusToShaderSpace(scene.focus);
    uniforms.uFromColor.value = hexToRgb(scene.palette[0]);
    uniforms.uToColor.value = hexToRgb(scene.palette[1] ?? scene.palette[0]);
    uniforms.uBackdrop.value = darken(hexToRgb(scene.palette[0]), 0.12);
    uniforms.uProgress.value = 0;
    uniforms.uSeed.value = seedFor(scene.id);
    uniforms.uTransition.value = TRANSITION_INDEX[scene.transition];
    uniforms.uActive.value = 0;
    this.keepRendering(0.3);

    this.current = index;
    this.onSceneChange?.(index, scene);
  }

  /**
   * Moves to a scene. The transition kind belongs to the scene being entered,
   * so the set-pieces fire on the way in rather than on the way out.
   */
  async goTo(index: number): Promise<void> {
    const target = Math.max(0, Math.min(this.scenes.length - 1, index));
    if (this.transitioning) {
      this.queued = target === this.current ? null : target;
      return;
    }
    if (target === this.current) return;

    const from = this.scenes[this.current];
    const to = this.scenes[target];
    const fromTextures = this.textures.get(from.id);
    const toTextures = this.textures.get(to.id);
    const uniforms = this.program.uniforms;

    this.transitioning = true;
    this.cancelRest();

    uniforms.uFromTex.value = fromTextures.colour;
    uniforms.uFromDepth.value = fromTextures.depth;
    uniforms.uFromAspect.value = from.aspect;
    uniforms.uFromFocus.value = focusToShaderSpace(from.focus);
    uniforms.uFromColor.value = hexToRgb(from.palette[0]);
    uniforms.uFromRest.value = this.restState.value;

    uniforms.uToTex.value = toTextures.colour;
    uniforms.uToDepth.value = toTextures.depth;
    uniforms.uToAspect.value = to.aspect;
    uniforms.uToFocus.value = focusToShaderSpace(to.focus);
    uniforms.uToColor.value = hexToRgb(to.palette[0]);
    uniforms.uToRest.value = 0;
    uniforms.uTransition.value = TRANSITION_INDEX[to.transition];
    uniforms.uSeed.value = seedFor(to.id);
    uniforms.uProgress.value = 0;
    uniforms.uActive.value = 1;

    this.current = target;
    this.onSceneChange?.(target, to);
    this.restState.value = 0;

    const duration = this.reducedMotion ? 0.45 : to.transition === 'parametric' ? 1.25 : 1.85;
    this.keepRendering(duration + 0.3);

    await gsap.to(uniforms.uProgress, {
      value: 1,
      duration,
      ease: this.reducedMotion ? 'none' : 'power2.inOut',
      onUpdate: () => {
        // The backdrop has to travel with the transition or the letterbox bars
        // pop to the new colour a beat before the image does.
        uniforms.uBackdrop.value = darken(
          mixRgb(hexToRgb(from.palette[0]), hexToRgb(to.palette[0]), uniforms.uProgress.value),
          0.12,
        );
      },
    });

    this.applyScene(target);
    this.textures.prefetch(this.neighbours(target));
    this.transitioning = false;

    const pending = this.queued;
    this.queued = null;
    if (pending !== null && pending !== this.current) {
      await this.goTo(pending);
      return;
    }

    this.scheduleRest();
  }

  next(): Promise<void> {
    return this.goTo(this.current + 1);
  }

  previous(): Promise<void> {
    return this.goTo(this.current - 1);
  }

  /**
   * After a pause, ease the image back to its full extent. Reduced motion skips
   * straight there and stays, because the crop is a motion effect.
   */
  private scheduleRest(): void {
    if (this.reducedMotion) {
      this.setRest(1, 0);
      return;
    }
    this.keepRendering(1.6 + 2.2 + 0.3);
    this.restTween = gsap.to(this.restState, {
      value: 1,
      duration: 2.2,
      delay: 1.6,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.program.uniforms.uToRest.value = this.restState.value;
        this.program.uniforms.uFromRest.value = this.restState.value;
      },
    });
  }

  private cancelRest(): void {
    this.restTween?.kill();
    this.restTween = undefined;
  }

  /** Used by detail mode to force the whole image into view. */
  setRest(value: number, duration = 0.8): void {
    this.cancelRest();
    this.keepRendering(duration + 0.3);
    gsap.to(this.restState, {
      value,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        this.program.uniforms.uToRest.value = this.restState.value;
        this.program.uniforms.uFromRest.value = this.restState.value;
      },
    });
  }

  setDetail(active: boolean): void {
    this.keepRendering(1.2);
    this.setRest(active ? 1 : 0, 0.7);
    gsap.to(this.program.uniforms.uParallax, {
      value: active || this.reducedMotion ? 0 : 1,
      duration: 0.7,
    });
  }

  /**
   * Fades the whole canvas in from the backdrop colour.
   *
   * Also arms the rest cycle for the opening scene. Without this the first
   * image is the only one that never eases back to its full extent, because
   * nothing has called goTo() yet.
   */
  reveal(duration = 1.1): Promise<void> {
    this.keepRendering(duration + 0.4);
    return new Promise((resolve) => {
      gsap.to(this.program.uniforms.uFade, {
        value: 1,
        duration,
        ease: 'power2.out',
        onComplete: () => {
          this.scheduleRest();
          resolve();
        },
      });
    });
  }

  waitForScenes(ids: string[]): Promise<void> {
    return this.textures.whenReady(ids);
  }

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);

      // Smoothing the pointer is what stops the parallax from feeling twitchy;
      // the raw value jumps by whole pixels between frames.
      if (now > this.renderUntil) return;

      this.pointer.x += (this.pointerTarget.x - this.pointer.x) * 0.06;
      this.pointer.y += (this.pointerTarget.y - this.pointer.y) * 0.06;

      this.program.uniforms.uPointer.value = [this.pointer.x, this.pointer.y];
      this.program.uniforms.uTime.value = (now - this.startedAt) / 1000;

      this.renderer.render({ scene: this.mesh });
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.cancelRest();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.handlePointer);
  }

  get index(): number {
    return this.current;
  }

  get busy(): boolean {
    return this.transitioning;
  }
}

/** Stable per-scene variation for the parametric transition. */
function seedFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash / 9973;
}

/**
 * Converts a pipeline focal point into shader space.
 *
 * The pipeline reports focus in image coordinates, where y increases downwards.
 * Textures are uploaded flipped, so the shader samples with y increasing
 * upwards. Without this the crop biases away from the subject instead of
 * towards it - and on these images the subject is usually low in frame, so the
 * error is very visible.
 */
function focusToShaderSpace(focus: { x: number; y: number }): number[] {
  return [focus.x, 1 - focus.y];
}

function mixRgb(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
