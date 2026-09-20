import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';

/** Waits for the intro to hand over to the gallery. */
async function ready(page: Page) {
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-experience]')?.dataset.ready === 'true',
    undefined,
    { timeout: 25_000 },
  );
  // Let the reveal tween settle so screenshots and reads are stable.
  await page.waitForTimeout(1200);
}

test.describe('the enhanced experience', () => {
  test('starts WebGL and hides the fallback', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const experience = page.locator('[data-experience]');
    await expect(experience).toHaveAttribute('data-mode', 'webgl');
    // The fallback must be gone from the accessibility tree, not just visually
    // hidden, or a screen reader reads the gallery twice.
    await expect(page.locator('[data-fallback]')).toBeHidden();
  });

  test('runs without console or page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await ready(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2500);

    expect(errors).toEqual([]);
  });

  test('advances and retreats through scenes with the keyboard', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const counter = page.locator('[data-scene-counter]');
    await expect(counter).toHaveText(/^01 \/ \d+$/);

    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText(/^02 \/ \d+$/, { timeout: 8000 });

    // Pressing back mid-transition must still be honoured: the renderer queues
    // one move rather than dropping input while a set-piece runs.
    await page.waitForTimeout(600);
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText(/^01 \/ \d+$/, { timeout: 12_000 });
  });

  test('announces each scene change to assistive technology', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const announcer = page.locator('[data-announcer]');
    await expect(announcer).toHaveAttribute('aria-live', 'polite');

    await page.keyboard.press('ArrowRight');
    await expect(announcer).toContainText(/Scene 2 of \d+/, { timeout: 8000 });
  });

  test('toggles detail mode and leaves on Escape', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const experience = page.locator('[data-experience]');
    await page.keyboard.press('f');
    await expect(experience).toHaveAttribute('data-detail', 'true');

    await page.keyboard.press('Escape');
    await expect(experience).toHaveAttribute('data-detail', 'false');
  });

  test('the rail jumps straight to a scene', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await page.locator('.rail__dot').nth(4).click();
    await expect(page.locator('[data-scene-counter]')).toHaveText(/^05 \/ \d+$/, {
      timeout: 10_000,
    });
  });

  test('resolves into the finale past the last scene and can come back', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    // Jump to the end rather than walking it, so the test is not ten
    // transitions long.
    await page.keyboard.press('End');
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-scene-counter]')).toHaveText(/^10 \/ 10$/);

    await page.keyboard.press('ArrowRight');
    const finale = page.locator('[data-finale]');
    await expect(finale).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-experience]')).toHaveAttribute('data-finale-open', 'true');

    // Focus must land inside the finale, not be stranded on the gallery.
    await expect(page.locator('[data-finale-replay]')).toBeFocused({ timeout: 12_000 });

    // The credits list every piece, not only the traced ones: filtering to the
    // credited ones would make a half-traced gallery look fully attributed.
    await expect(finale.locator('.finale__credits-list li')).toHaveCount(10);

    // The disclaimer names the rights holders and never claims a licence the
    // artwork does not have.
    const note = finale.locator('.finale__credits-note');
    await expect(note).toContainText('TO Books');
    await expect(note).toContainText('not affiliated');
    await expect(note).not.toContainText('Creative Commons');

    await page.locator('[data-finale-back]').click();
    await expect(finale).toBeHidden({ timeout: 8000 });
  });

  test('the intro plays on every visit, not just the first', async ({ page }) => {
    await page.goto('/');
    // The drawing is on screen before the gallery takes over.
    await expect(page.locator('[data-intro]')).toBeVisible();
    await ready(page);
    await expect(page.locator('[data-intro]')).toBeHidden();

    await page.reload();
    // A returning visitor sees it again: it is short, skippable, and the best
    // thing on the page.
    await expect(page.locator('[data-intro]')).toBeVisible();
    await ready(page);
    await expect(page.locator('[data-intro]')).toBeHidden();
  });

  test('animates the scene title once per change, not twice', async ({ page }) => {
    // Regression guard. The renderer announces a scene change when the
    // transition starts and used to announce it again when the transition
    // settled, so every title played its entrance animation twice - visibly a
    // double blink, and read out twice by a screen reader.
    await page.goto('/');
    await ready(page);

    await page.evaluate(() => {
      const target = document.querySelector('[data-scene-title]')!;
      (window as Window & { __titleRebuilds?: number }).__titleRebuilds = 0;
      new MutationObserver((records) => {
        for (const record of records) {
          // setTitle() clears the element and appends one span per character,
          // so a rebuild shows up as removed children.
          if (record.removedNodes.length > 0) {
            (window as Window & { __titleRebuilds?: number }).__titleRebuilds! += 1;
            return;
          }
        }
      }).observe(target, { childList: true });
    });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(4000);

    const rebuilds = await page.evaluate(
      () => (window as Window & { __titleRebuilds?: number }).__titleRebuilds ?? 0,
    );
    expect(rebuilds).toBe(1);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('draws the artwork the right way up', async ({ page }) => {
    // Regression guard against flipped WebGL textures.
    //
    // This is a real failure mode: UNPACK_FLIP_Y_WEBGL is honoured for an
    // HTMLImageElement but ignored for an ImageBitmap, so switching to
    // off-thread decoding silently rendered every picture upside down while
    // every other test still passed.
    //
    // Comparing brightness between the top and bottom of the page does not
    // catch it, because the chrome's scrims darken the top whichever way up
    // the art is. So the rendered frame is compared against the actual source
    // image, both as-is and vertically flipped, and the correct orientation
    // has to be the better match.
    await page.goto('/');
    await ready(page);

    // Detail mode shows the whole image, letterboxed, with the scrims cleared.
    await page.keyboard.press('f');
    await page.waitForTimeout(2000);

    const shot = await page.screenshot();
    const meta = await sharp(shot).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    // Where the image actually sits on screen. In detail mode it is contained,
    // so on a portrait viewport most of the screen is letterbox - sampling a
    // fixed fraction of the screen would compare bars, not artwork.
    const imageAspect = 1.33333;
    const drawn =
      width / height > imageAspect
        ? { w: height * imageAspect, h: height }
        : { w: width, h: width / imageAspect };
    const rect = {
      left: Math.round((width - drawn.w) / 2 + drawn.w * 0.3),
      top: Math.round((height - drawn.h) / 2 + drawn.h * 0.25),
      width: Math.round(drawn.w * 0.4),
      height: Math.round(drawn.h * 0.5),
    };

    // A central patch, safely inside the artwork in either orientation.
    const signature = (input: Buffer | string, flip: boolean) =>
      sharp(input)
        .metadata()
        .then(({ width: w = 0, height: h = 0 }) =>
          sharp(input)
            .extract({
              left: Math.round(w * 0.3),
              top: Math.round(h * 0.25),
              width: Math.round(w * 0.4),
              height: Math.round(h * 0.5),
            })
            .flip(flip)
            .greyscale()
            .resize(24, 24, { fit: 'fill' })
            .raw()
            .toBuffer(),
        );

    // Normalised, so overall brightness differences (vignette, grain, the
    // colour grade) do not drown out the structural comparison.
    const normalise = (data: Buffer) => {
      const values = [...data];
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance =
        values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const deviation = Math.sqrt(variance) || 1;
      return values.map((v) => (v - mean) / deviation);
    };

    const distance = (a: number[], b: number[]) =>
      a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;

    const rendered = normalise(
      await sharp(shot)
        .extract(rect)
        .greyscale()
        .resize(24, 24, { fit: 'fill' })
        .raw()
        .toBuffer(),
    );

    const source = 'src/assets/generated/07.webp';
    const upright = normalise(await signature(source, false));
    const flipped = normalise(await signature(source, true));

    const distanceUpright = distance(rendered, upright);
    const distanceFlipped = distance(rendered, flipped);

    expect(
      distanceUpright,
      `rendered frame matched the flipped source better (${distanceUpright.toFixed(
        3,
      )} vs ${distanceFlipped.toFixed(3)}) - textures are upside down`,
    ).toBeLessThan(distanceFlipped);
  });

  test('exposes a working skip link', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('still shows the full gallery, without the motion', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    // Reduced motion is not a lesser site: same mode, same scenes, same chrome.
    await expect(page.locator('[data-experience]')).toHaveAttribute('data-mode', 'webgl');
    await expect(page.locator('[data-scene-counter]')).toHaveText(/^01 \/ 10$/);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-scene-counter]')).toHaveText(/^02 \/ 10$/, {
      timeout: 8000,
    });
  });

  test('has no accessibility violations either', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('serves the complete gallery as real markup', async ({ page }) => {
    await page.goto('/');

    const fallback = page.locator('[data-fallback]');
    await expect(fallback).toBeVisible();

    // Every image is present, with a real alt and a real caption.
    const items = page.locator('.fallback__item');
    await expect(items).toHaveCount(10);

    const images = page.locator('.fallback__image');
    await expect(images.first()).toBeVisible();
    for (const alt of await images.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('alt')),
    )) {
      expect(alt).toBeTruthy();
    }

    // The canvas experience must not have claimed the page.
    await expect(page.locator('[data-experience]')).toHaveAttribute('data-mode', 'fallback');
  });

  test('ships modern formats with a srcset for every image', async ({ page }) => {
    await page.goto('/');

    const sources = page.locator('.fallback__item picture source');
    expect(await sources.count()).toBeGreaterThan(0);

    const types = await sources.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('type')),
    );
    expect(types).toContain('image/avif');
    expect(types).toContain('image/webp');

    const srcsets = await sources.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('srcset') ?? ''),
    );
    // A srcset with several candidates is the whole point of the ladder.
    expect(srcsets.every((set) => set.split(',').length >= 3)).toBe(true);
  });

});

test.describe('without WebGL', () => {
  test('keeps the fallback when a context cannot be created', async ({ page }) => {
    // Simulate a blocklisted GPU: the probe in boot() must fail and leave the
    // server-rendered gallery in place rather than showing a blank canvas.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type.includes('webgl')) return null;
        return (original as never as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.goto('/');
    await page.waitForTimeout(1500);

    await expect(page.locator('[data-experience]')).toHaveAttribute('data-mode', 'fallback');
    await expect(page.locator('[data-fallback]')).toBeVisible();
    await expect(page.locator('.fallback__item')).toHaveCount(10);
  });

  test('names every piece in the fallback, untraced ones included', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type.includes('webgl')) return null;
        return (original as never as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.goto('/');
    await page.waitForTimeout(1500);

    // The no-JS markup is what a crawler and a screen reader read, so it has to
    // carry the provenance statement itself rather than leaving it to the
    // canvas experience nobody here can see.
    const note = page.locator('.fallback__note');
    await expect(note).toContainText('TO Books');
    await expect(note).toContainText('not affiliated');
    await expect(note).not.toContainText('Creative Commons');

    // It also has to say how much is untraced, in prose, so the gap is stated
    // once rather than implied by ten missing bylines.
    await expect(note).toContainText('has been traced back to its artist');

    // A credit line is never rendered empty: it either names an artist or says
    // the artist is untraced.
    for (const credit of await page.locator('.fallback__credit').all()) {
      expect((await credit.innerText()).trim()).not.toBe('');
    }
  });

  test('the fallback has no accessibility violations', async ({ page }) => {
    // Axe itself needs JavaScript, so the fallback markup is audited here
    // rather than in the no-JS block - it is the same server-rendered DOM.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type.includes('webgl')) return null;
        return (original as never as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.goto('/');
    await page.waitForTimeout(1200);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
