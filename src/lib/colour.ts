/**
 * Colour helpers shared by the renderer and the DOM chrome.
 *
 * The shader wants linear-ish 0-1 triples; CSS wants strings. Both read from
 * the same pipeline-extracted palette, so this is the one place that converts.
 */

/** "#rrggbb" to a 0-1 rgb triple. Tolerates a missing hash and 3-digit form. */
export function hexToRgb(hex: string): number[] {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [0.5, 0.5, 0.5];

  const int = parseInt(value, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export function rgbToCss(rgb: number[], alpha = 1): string {
  const [r, g, b] = rgb.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
  return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

export function darken(rgb: number[], amount: number): number[] {
  return rgb.map((channel) => channel * amount);
}

export function relativeLuminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = Math.max(0, Math.min(1, channel));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks readable ink for a given backdrop.
 *
 * The chrome sits over ten images whose palettes run from near-black to near-
 * white, so the text colour cannot be a constant. WCAG's own threshold of 0.179
 * is the crossover where white stops out-contrasting black.
 */
export function inkFor(backdrop: number[]): 'light' | 'dark' {
  return relativeLuminance(backdrop) > 0.179 ? 'dark' : 'light';
}

/** Contrast ratio between two colours, for the accessibility tests. */
export function contrastRatio(a: number[], b: number[]): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
