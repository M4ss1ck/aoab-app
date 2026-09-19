import { COMMON } from './common';

/**
 * The intro: the hero is drawn in as linework, then fills with colour.
 *
 * Three overlapping phases driven by one 0-1 uniform, so the whole thing scrubs
 * from a single GSAP tween and can be jumped to its end when skipped:
 *
 *   uDraw   0 -> 1  edges appear, following a sweep with a graphite texture
 *   uInk    0 -> 1  the linework settles and darkens into finished pencil
 *   uColour 0 -> 1  flat colour floods in behind the lines, which then recede
 */
export const INTRO_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uArt;
  uniform sampler2D uEdges;
  uniform float uAspect;
  uniform float uViewAspect;
  uniform float uDraw;
  uniform float uInk;
  uniform float uColour;
  uniform float uTime;
  uniform float uFade;
  uniform vec3 uPaper;
  uniform vec3 uGraphite;
  uniform vec3 uAccent;
  uniform float uGrainAmount;
  uniform float uHasEdges;
  uniform float uHasArt;
  uniform vec2 uArtMin;
  uniform vec2 uArtMax;

  varying vec2 vUv;

  ${COMMON}

  void main() {
    // Until the hero has decoded there is nothing to draw, and the luminance
    // fallback below would read an empty texture as solid edges and flood the
    // screen with graphite. Blank paper is the honest state: the progress
    // indicator is what is doing the talking at this point.
    if (uHasArt < 0.5) {
      vec3 blank = uPaper * vignette(vUv, 0.45) + grain(vUv, uTime) * uGrainAmount;
      gl_FragColor = vec4(blank, uFade);
      return;
    }

    // The artwork is composed into its own rectangle of the page and the
    // wordmark takes the rest, like a poster. Letting them share the middle
    // reads as a collision, not a composition.
    vec2 span = uArtMax - uArtMin;
    vec2 boxUv = (vUv - uArtMin) / span;
    float boxAspect = uViewAspect * (span.x / span.y);

    // The hero is a tall cutout; contain it so nothing is ever cropped.
    vec2 uv = fitUv(boxUv, uAspect, boxAspect, vec2(0.5), 1.0);
    vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
    vec2 inBox = step(uArtMin, vUv) * step(vUv, uArtMax);
    float within = inside.x * inside.y * inBox.x * inBox.y;

    vec4 art = texture2D(uArt, clamp(uv, 0.0, 1.0));
    float edge = texture2D(uEdges, clamp(uv, 0.0, 1.0)).r;

    // Without an edge map, fall back to the art's own luminance gradient so the
    // intro still draws rather than simply fading in.
    float luma = dot(art.rgb, vec3(0.299, 0.587, 0.114));
    edge = mix(1.0 - smoothstep(0.15, 0.55, luma), edge, uHasEdges);

    // A hand draws roughly top-down but not in straight lines. Perturbing the
    // sweep with noise makes the order of appearance feel decided rather than
    // scanned, which is the difference between a drawing and a wipe.
    float wander = fbm(uv * 3.2) * 0.35 + fbm(uv * 9.0) * 0.12;
    float sweep = (1.0 - uv.y) * 0.75 + wander;
    float reveal = smoothstep(0.0, 0.16, uDraw * 1.35 - sweep);

    // Graphite is not a flat tone: it catches the tooth of the paper.
    float tooth = 0.72 + 0.28 * fbm(uv * 180.0);
    float line = edge * reveal * tooth;

    // The leading edge of the sweep glows faintly, like a fresh stroke.
    float tip = smoothstep(0.10, 0.0, abs(uDraw * 1.35 - sweep)) * edge * (1.0 - uColour);

    float drawn = clamp(line * mix(0.75, 1.25, uInk), 0.0, 1.0);

    vec3 paper = uPaper;
    vec3 pencil = mix(paper, uGraphite, drawn);
    pencil += uAccent * tip * 0.55;

    // Colour floods upward, lagging the drawing. boxUv.y points up, so the
    // low end is the bottom of the frame and that is where it starts.
    float flood = smoothstep(0.0, 0.55, uColour * 1.5 - boxUv.y * 0.5);
    vec3 coloured = mix(pencil, art.rgb, flood * art.a);

    // Linework lingers over the colour, then lifts away.
    float residue = drawn * (1.0 - smoothstep(0.35, 1.0, uColour)) * 0.5;
    coloured = mix(coloured, uGraphite, residue * art.a);

    // Outside the silhouette stays paper until the colour phase, then clears.
    vec3 colour = mix(paper, coloured, max(art.a, 1.0 - flood));
    colour = mix(paper, colour, within);

    colour *= vignette(vUv, 0.45);
    colour += grain(vUv, uTime) * uGrainAmount;

    gl_FragColor = vec4(colour, uFade);
  }
`;
