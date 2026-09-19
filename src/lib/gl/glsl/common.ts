/**
 * GLSL shared by the intro and scene programs.
 *
 * Kept as a string rather than a .glsl import so there is no extra Vite plugin
 * in the chain and the shaders minify with the rest of the bundle.
 */
export const COMMON = /* glsl */ `
  #define PI 3.14159265359

  float hash11(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  // Value noise. Cheaper than simplex and the difference is invisible once it
  // is driving a displacement field rather than being looked at directly.
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.02;
      amplitude *= 0.5;
    }
    return value;
  }

  /**
   * Maps viewport uv to texture uv.
   *
   * At rest = 0 the image covers the viewport and is cropped, biased so the
   * focal point survives the crop. At rest = 1 it is letterboxed whole. The
   * returned uv deliberately runs outside 0-1 in the letterboxed case so the
   * caller can paint the bars.
   */
  vec2 fitUv(vec2 uv, float imgAspect, float viewAspect, vec2 focus, float rest) {
    vec2 cover = viewAspect > imgAspect
      ? vec2(1.0, imgAspect / viewAspect)
      : vec2(viewAspect / imgAspect, 1.0);
    vec2 contain = viewAspect > imgAspect
      ? vec2(viewAspect / imgAspect, 1.0)
      : vec2(1.0, imgAspect / viewAspect);

    vec2 scale = mix(cover, contain, rest);

    // Shift the window toward the focal point in proportion to how much is
    // being cropped away, then keep the window inside the image.
    vec2 centre = 0.5 + (focus - 0.5) * clamp(1.0 - scale, 0.0, 1.0);
    vec2 limit = abs(1.0 - scale) * 0.5;
    centre = clamp(centre, 0.5 - limit, 0.5 + limit);

    return (uv - 0.5) * scale + centre;
  }

  /** Film grain. Animated, because static grain reads as a dirty screen. */
  float grain(vec2 uv, float time) {
    return hash12(uv * 1024.0 + fract(time) * 137.0) - 0.5;
  }

  float vignette(vec2 uv, float strength) {
    vec2 centred = uv - 0.5;
    return 1.0 - strength * dot(centred, centred);
  }
`;
