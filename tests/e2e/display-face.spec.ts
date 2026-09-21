import { test, expect, type Page } from '@playwright/test';

/**
 * The self-hosted display face, checked in a real engine.
 *
 * The face is the one font this site ships, it is the LCP element, and the
 * scene title renders it inside a box with `overflow: hidden` - the clip that
 * hides each character before it animates in also crops the line box. So a
 * face swap can silently shave the descenders off half the titles, which is
 * exactly the kind of thing nobody notices until it is deployed. These two
 * tests pin the parts a swap breaks: that the file is the thing being drawn,
 * and that every real title fits the box that draws it.
 */

const FAMILY = 'Black Chancery';

/** Every string that is rendered in the display face on this page. */
async function displayStrings(page: Page) {
  const titles = await page.locator('.fallback__name').allInnerTexts();
  const wordmark = await page.locator('.wordmark__line').allInnerTexts();
  return {
    titles: titles.map((t) => t.trim()).filter(Boolean),
    wordmark: wordmark.map((t) => t.trim()).filter(Boolean),
  };
}

test.describe('the display face', () => {
  test('loads the self-hosted file rather than a system serif', async ({ page }) => {
    const fontRequests: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('.woff2')) fontRequests.push(`${response.status()} ${url}`);
    });

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    // Served, not 404'd. A missing file still "works" visually via the
    // fallback stack, which is the failure this catches.
    expect(fontRequests.filter((r) => r.startsWith('200'))).toHaveLength(1);
    expect(fontRequests[0]).toContain('black-chancery-400.woff2');

    const loaded = await page.evaluate(
      (family) => [...document.fonts].some((f) => f.family === family && f.status === 'loaded'),
      FAMILY,
    );
    expect(loaded).toBe(true);

    // And it is actually what the wordmark resolves to, not just a loaded file
    // sitting unused behind a stale family name in the custom property.
    const resolved = await page.evaluate(
      () => getComputedStyle(document.querySelector('.wordmark')!).fontFamily,
    );
    expect(resolved.startsWith(`"${FAMILY}"`)).toBe(true);
  });

  test('draws every title inside the box that clips it', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const { titles, wordmark } = await displayStrings(page);
    expect(titles.length).toBeGreaterThan(0);

    const measured = await page.evaluate(
      ({ strings }) => {
        // The nearest ancestor - the element itself included - that would crop
        // ink leaving its box.
        const clipper = (from: Element) => {
          for (let node: Element | null = from; node; node = node.parentElement) {
            if (node.getBoundingClientRect().height === 0) continue;
            if (/hidden|clip|auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
          }
          return from;
        };

        const results: { selector: string; word: string; top: number; bottom: number }[] = [];

        for (const [selector, words] of Object.entries(strings)) {
          const element = document.querySelector(selector);
          if (!element) continue;
          const original = element.textContent;

          for (const word of words as string[]) {
            element.textContent = word;

            const style = getComputedStyle(element);
            const size = parseFloat(style.fontSize);
            const lineHeight = parseFloat(style.lineHeight);
            const context = document.createElement('canvas').getContext('2d')!;
            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const metrics = context.measureText(word);

            // Where the baseline sits in the line box: half-leading plus the
            // face's own ascent. Black Chancery is 833/-417 per 1000 upem.
            const box = element.getBoundingClientRect();
            const baseline = box.top + (lineHeight - size * 1.25) / 2 + size * 0.833;
            const clip = clipper(element).getBoundingClientRect();

            results.push({
              selector,
              word,
              top: baseline - metrics.actualBoundingBoxAscent - clip.top,
              bottom: clip.bottom - (baseline + metrics.actualBoundingBoxDescent),
            });
          }

          element.textContent = original;
        }

        return results;
      },
      {
        strings: {
          '.scene-title': titles,
          '.fallback__name': titles,
          '.fallback__title': wordmark,
          '.finale__title': wordmark,
          '.wordmark__line': wordmark,
        },
      },
    );

    expect(measured.length).toBeGreaterThan(titles.length);

    const clipped = measured
      .filter((m) => m.top < 0 || m.bottom < 0)
      .map((m) => `${m.selector} "${m.word}": ${m.top.toFixed(1)}px top, ${m.bottom.toFixed(1)}px bottom`);

    expect(clipped, 'display text cropped by its own clip box').toEqual([]);
  });
});
