import { COMMON } from './common';

export const SCENE_VERTEX = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

/**
 * One program renders every scene and every transition between scenes.
 *
 * Two image layers are always resident - the one being left and the one being
 * entered. When no transition is running they are the same texture and progress
 * sits at 0, so the steady state costs one extra texture fetch and nothing else.
 *
 * The transition branch is on a uniform, so it is coherent across the whole draw
 * and effectively free; splitting it into three programs would cost three shader
 * compiles and a program switch mid-animation for no gain.
 */
export const SCENE_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uFromTex;
  uniform sampler2D uFromDepth;
  uniform sampler2D uToTex;
  uniform sampler2D uToDepth;

  uniform float uFromAspect;
  uniform float uToAspect;
  uniform vec2 uFromFocus;
  uniform vec2 uToFocus;
  uniform float uFromRest;
  uniform float uToRest;
  uniform vec3 uFromColor;
  uniform vec3 uToColor;
  uniform vec3 uBackdrop;

  uniform float uViewAspect;
  uniform vec2 uPointer;
  uniform float uProgress;
  uniform float uTransition;
  uniform float uTime;
  uniform float uSeed;
  uniform float uParallax;
  uniform float uGrainAmount;
  uniform float uAberration;
  uniform float uFade;
  uniform float uActive;

  varying vec2 vUv;

  ${COMMON}

  /**
   * Samples one image layer with depth parallax and chromatic aberration.
   * Returns rgb plus a coverage mask - zero outside the image, which is what
   * paints the letterbox bars in the rest state.
   */
  vec4 sampleLayer(
    sampler2D tex,
    sampler2D depthTex,
    float aspect,
    vec2 focus,
    float rest,
    vec2 uv,
    vec2 extra
  ) {
    vec2 base = fitUv(uv, aspect, uViewAspect, focus, rest);
    float depth = texture2D(depthTex, clamp(base, 0.0, 1.0)).r;

    // Near pixels move further than far ones, which is the whole illusion.
    // Biasing around 0.45 rather than 0.5 keeps the subject roughly anchored
    // while the background does most of the travelling.
    vec2 shift = uPointer * uParallax * (depth - 0.45) * 0.055;
    vec2 finalUv = base + shift + extra;

    vec2 inside = step(vec2(0.0), finalUv) * step(finalUv, vec2(1.0));
    float mask = inside.x * inside.y;

    vec2 clamped = clamp(finalUv, 0.0, 1.0);
    vec2 caOffset = uPointer * uAberration * (depth - 0.45) * 0.004;

    vec3 colour;
    colour.r = texture2D(tex, clamp(clamped + caOffset, 0.0, 1.0)).r;
    colour.g = texture2D(tex, clamped).g;
    colour.b = texture2D(tex, clamp(clamped - caOffset, 0.0, 1.0)).b;

    return vec4(colour, mask);
  }

  void main() {
    vec2 uv = vUv;

    // Idle fast path. With no transition running there is one image on screen,
    // so the second layer, the noise field and the particle loops are all dead
    // work - and this is the state the page spends nearly all of its time in.
    if (uActive < 0.5) {
      vec4 only = sampleLayer(uToTex, uToDepth, uToAspect, uToFocus, uToRest, uv, vec2(0.0));
      vec3 still = mix(uBackdrop, only.rgb, only.a);
      still *= vignette(uv, 0.35);
      still += grain(uv, uTime) * uGrainAmount;
      still = mix(uBackdrop, still, uFade);
      gl_FragColor = vec4(still, 1.0);
      return;
    }

    vec2 extraFrom = vec2(0.0);
    vec2 extraTo = vec2(0.0);
    float blend = smoothstep(0.0, 1.0, uProgress);
    float fromFade = 1.0;
    vec3 glow = vec3(0.0);
    float glowAmount = 0.0;
    float sparkle = 0.0;

    // ---- parametric: a flow-field wipe, seeded per scene -------------------
    if (uTransition < 0.5) {
      float angle = hash11(uSeed) * 2.0 * PI;
      vec2 dir = vec2(cos(angle), sin(angle));
      float scale = 2.0 + hash11(uSeed + 11.0) * 2.5;

      float flow = fbm(uv * scale + uSeed * 7.0);
      float along = dot(uv - 0.5, dir) * 0.5 + 0.5;

      // Widen the advancing front so the two images interleave rather than
      // meeting at a hard line.
      float front = uProgress * 1.9 - 0.45;
      blend = smoothstep(0.0, 0.42, front - along * 0.42 - flow * 0.6 + 0.5);

      float peak = sin(uProgress * PI);
      vec2 push = (dir * 0.09 + (vec2(flow, fbm(uv * scale + 31.0)) - 0.5) * 0.14) * peak;
      extraFrom = push * uProgress;
      extraTo = -push * (1.0 - uProgress);

      glowAmount = smoothstep(0.0, 0.45, blend) * smoothstep(1.0, 0.55, blend) * peak;
      glow = mix(uFromColor, uToColor, uProgress);
    }

    // ---- water: a refracting ring that breaks out of the focal point -------
    else if (uTransition < 1.5) {
      vec2 centre = uToFocus;
      vec2 aspectUv = (uv - centre) * vec2(uViewAspect, 1.0);
      float dist = length(aspectUv);
      vec2 outward = normalize(aspectUv + 1e-5);

      float ring = uProgress * 1.75;
      float band = smoothstep(0.30, 0.0, abs(dist - ring));
      float ripple = sin(dist * 42.0 - uTime * 3.0 - uProgress * 14.0) * band;

      extraFrom = outward * (ripple * 0.045 + band * 0.025);
      extraTo = outward * ripple * 0.022;
      blend = smoothstep(0.0, 0.30, ring - dist);

      // Bubbles rise through the whole frame, densest along the ring.
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        vec2 seed = hash22(vec2(fi, fi * 3.7));
        float speed = 0.25 + seed.y * 0.5;
        vec2 pos = vec2(
          seed.x + sin(uTime * 0.6 + fi) * 0.02,
          fract(seed.y + uTime * speed * 0.12 + uProgress * 0.5)
        );
        float radius = (0.004 + seed.x * 0.010) * (0.5 + band);
        float bubble = smoothstep(radius, radius * 0.35, distance(uv * vec2(uViewAspect, 1.0), pos * vec2(uViewAspect, 1.0)));
        sparkle += bubble * band * 0.9;
      }

      glowAmount = band * 0.8;
      glow = mix(uFromColor, uToColor, 0.5) + vec3(0.25);
    }

    // ---- starfield: the outgoing frame disperses and reforms as stars ------
    else {
      vec2 cell = floor(uv * 110.0);
      vec2 jitter = hash22(cell) - 0.5;
      float scatter = smoothstep(0.0, 0.75, uProgress);
      float gather = 1.0 - smoothstep(0.25, 1.0, uProgress);

      extraFrom = jitter * scatter * 0.55;
      extraTo = jitter * gather * 0.35;

      fromFade = 1.0 - smoothstep(0.30, 0.88, uProgress);
      blend = smoothstep(0.50, 1.0, uProgress);

      // Stars peak in the middle of the transition, when neither image is
      // really readable, and carry the moment on their own.
      float burst = sin(clamp(uProgress, 0.0, 1.0) * PI);
      vec2 starCell = floor(uv * 220.0);
      vec2 starPos = (hash22(starCell + 4.0) - 0.5) * 0.9 + 0.5;
      float star = smoothstep(0.34, 0.0, distance(fract(uv * 220.0), starPos));
      float twinkle = 0.55 + 0.45 * sin(uTime * 2.4 + hash12(starCell) * 12.0);
      sparkle += star * twinkle * burst * step(0.82, hash12(starCell));

      glowAmount = burst * 0.5;
      glow = mix(uFromColor, uToColor, uProgress);
    }

    vec4 from = sampleLayer(uFromTex, uFromDepth, uFromAspect, uFromFocus, uFromRest, uv, extraFrom);
    vec4 to = sampleLayer(uToTex, uToDepth, uToAspect, uToFocus, uToRest, uv, extraTo);

    // Letterbox bars take the scene's own darkened accent, so the rest state
    // still reads as part of the same picture.
    vec3 fromColour = mix(uBackdrop, from.rgb, from.a);
    vec3 toColour = mix(uBackdrop, to.rgb, to.a);

    vec3 colour = mix(fromColour * fromFade, toColour, blend);
    colour += glow * glowAmount * 0.35;
    colour += vec3(sparkle);

    colour *= vignette(uv, 0.35);
    colour += grain(uv, uTime) * uGrainAmount;
    colour = mix(uBackdrop, colour, uFade);

    gl_FragColor = vec4(colour, 1.0);
  }
`;
