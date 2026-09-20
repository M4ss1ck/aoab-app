import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM tool module, no types
import {
  buildSheetHtml,
  mergeCredits,
  isUsableSourceUrl,
  stringifyMeta,
  topLevelKeys,
} from '../scripts/provenance/sheet.mjs';

const image = {
  id: '07',
  file: '07.jpg',
  title: 'Stillwater',
  width: 800,
  height: 600,
  dataUri: 'data:image/jpeg;base64,AAAA',
};

describe('mergeCredits', () => {
  it('writes a credit block for a traced image', () => {
    const meta = { '07': { title: 'Stillwater', order: 10 } };
    const merged = mergeCredits(meta, {
      '07': { artist: 'Someone', url: 'https://www.pixiv.net/artworks/1', license: 'Permission' },
    });

    expect(merged['07']).toEqual({
      title: 'Stillwater',
      order: 10,
      credit: { artist: 'Someone', url: 'https://www.pixiv.net/artworks/1', license: 'Permission' },
    });
  });

  it('keeps the existing entry untouched when the artist is still blank', () => {
    const meta = { '07': { title: 'Stillwater', order: 10 } };
    // A half-finished sheet must be safe to paste. An empty artist means "not
    // traced yet", so it must not stamp an empty credit or drop the entry.
    const merged = mergeCredits(meta, { '07': { artist: '   ', url: 'https://example.com/x' } });

    expect(merged['07']).toEqual({ title: 'Stillwater', order: 10 });
  });

  it('leaves an existing credit alone when that image has no answer', () => {
    const credit = { artist: 'Prior', url: 'https://example.com/prior' };
    const merged = mergeCredits({ '07': { title: 'Stillwater', credit } }, {});

    expect(merged['07']).toEqual({ title: 'Stillwater', credit });
  });

  it('replaces a previous credit rather than merging into it', () => {
    const meta = { '07': { credit: { artist: 'Wrong', url: 'https://example.com/wrong' } } };
    const merged = mergeCredits(meta, { '07': { artist: 'Right' } });

    // The stale url must not survive: a corrected artist with the old link
    // attached is worse than no link at all.
    expect(merged['07']).toEqual({ credit: { artist: 'Right' } });
  });

  it('omits empty optional fields so the entry stays schema-clean', () => {
    const merged = mergeCredits({ '07': {} }, { '07': { artist: 'Someone', url: '', license: '' } });

    expect(merged['07']).toEqual({ credit: { artist: 'Someone' } });
    expect(Object.keys(merged['07'].credit)).toEqual(['artist']);
  });

  it('passes _comment keys through untouched', () => {
    const meta = { _comment: 'a note', '07': {} };
    const merged = mergeCredits(meta, { _comment: { artist: 'nope' }, '07': { artist: 'Someone' } });

    expect(merged._comment).toBe('a note');
  });

  it('appends an id the metadata file does not have yet', () => {
    const merged = mergeCredits({}, { myne: { artist: 'Someone' } });

    expect(merged.myne).toEqual({ credit: { artist: 'Someone' } });
  });

  it('does not mutate the metadata it was given', () => {
    const meta = { '07': { title: 'Stillwater' } };
    mergeCredits(meta, { '07': { artist: 'Someone' } });

    expect(meta).toEqual({ '07': { title: 'Stillwater' } });
  });

  it('trims whitespace off every field', () => {
    const merged = mergeCredits(
      {},
      { '07': { artist: '  Someone  ', url: ' https://example.com/x ', license: ' CC BY 4.0 ' } },
    );

    expect(merged['07'].credit).toEqual({
      artist: 'Someone',
      url: 'https://example.com/x',
      license: 'CC BY 4.0',
    });
  });
});

describe('isUsableSourceUrl', () => {
  // content.config.ts enforces z.string().url(), so anything this accepts has
  // to survive the build.
  it.each([
    ['https://www.pixiv.net/artworks/123', true],
    ['http://example.com', true],
    ['  https://example.com/x  ', true],
    ['pixiv.net/artworks/123', false],
    ['javascript:alert(1)', false],
    ['', false],
    ['   ', false],
  ])('%s -> %s', (value, expected) => {
    expect(isUsableSourceUrl(value)).toBe(expected);
  });
});

describe('buildSheetHtml', () => {
  it('renders one row per image', () => {
    const html = buildSheetHtml([image, { ...image, id: '01', file: '01.jpg', title: 'Held' }], {});

    // Anchored to the element, because the page script also selects [data-row].
    expect(html.match(/<article class="row" data-row/g)).toHaveLength(2);
    expect(html).toContain('data-id="07"');
    expect(html).toContain('data-id="01"');
  });

  it('offers every search service for each image', () => {
    const html = buildSheetHtml([image], {});

    for (const name of ['Google Lens', 'SauceNAO', 'ascii2d', 'TinEye']) {
      expect(html).toContain(name);
    }
  });

  it('embeds the image so the sheet works with no server and no network', () => {
    const html = buildSheetHtml([image], {});

    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).toContain('download="07.jpg"');
  });

  it('ships the tested merge function into the page rather than a copy', () => {
    const html = buildSheetHtml([image], {});

    expect(html).toContain('function mergeCredits');
    expect(html).toContain('function isUsableSourceUrl');
  });

  it('escapes metadata so a quote in a title cannot break the markup', () => {
    const html = buildSheetHtml([{ ...image, title: 'A "quoted" <title>' }], {});

    expect(html).toContain('A &quot;quoted&quot; &lt;title&gt;');
    expect(html).not.toContain('A "quoted" <title>');
  });

  it('serialises the metadata base the page merges into', () => {
    const html = buildSheetHtml([image], { '07': { title: 'Stillwater', order: 10 } });

    expect(html).toContain('const META = {"07":{"title":"Stillwater","order":10}}');
  });
});

describe('topLevelKeys', () => {
  it('reads the file order, including keys JavaScript would hoist', () => {
    // "10" is a canonical array index so an object hoists it to the front;
    // "07" is not, because of the leading zero. Reading the text is the only
    // way to keep the curated arc intact.
    const text = '{\n  "_comment": "note",\n  "07": { "order": 10 },\n  "10": { "order": 50 },\n  "01": {}\n}';

    expect(topLevelKeys(text)).toEqual(['_comment', '07', '10', '01']);
    expect(Object.keys(JSON.parse(text))).toEqual(['10', '_comment', '07', '01']);
  });

  it('ignores strings that are values rather than keys', () => {
    const text = '{"a": "b", "c": "d"}';

    expect(topLevelKeys(text)).toEqual(['a', 'c']);
  });

  it('ignores keys nested inside entries', () => {
    const text = '{"07": {"title": "x", "credit": {"artist": "y"}}, "01": {}}';

    expect(topLevelKeys(text)).toEqual(['07', '01']);
  });

  it('is not fooled by braces or quotes inside a string', () => {
    const text = '{"_comment": "a { and a \\" and a }", "07": {}}';

    expect(topLevelKeys(text)).toEqual(['_comment', '07']);
  });

  it('matches JSON.parse on the real metadata file', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile('src/data/gallery.meta.json', 'utf8');

    expect(topLevelKeys(text).sort()).toEqual(Object.keys(JSON.parse(text)).sort());
  });
});

describe('stringifyMeta', () => {
  it('writes keys in the given order, not the engine default', () => {
    const meta = { '10': { order: 50 }, _comment: 'note', '07': { order: 10 } };
    const out = stringifyMeta(meta, ['_comment', '07', '10']);

    expect(topLevelKeys(out)).toEqual(['_comment', '07', '10']);
  });

  it('appends keys the order does not mention', () => {
    const out = stringifyMeta({ '07': {}, myne: { credit: { artist: 'A' } } }, ['07']);

    expect(topLevelKeys(out)).toEqual(['07', 'myne']);
  });

  it('ignores ordered keys that are no longer present', () => {
    const out = stringifyMeta({ '07': {} }, ['_comment', '07', '99']);

    expect(topLevelKeys(out)).toEqual(['07']);
  });

  it('round-trips to the same data', () => {
    const meta = { _comment: 'note', '07': { title: 'Stillwater', credit: { artist: 'A' } } };

    expect(JSON.parse(stringifyMeta(meta, ['_comment', '07']))).toEqual(meta);
  });

  it('ends with a newline so the file is POSIX-clean', () => {
    expect(stringifyMeta({ '07': {} }, ['07']).endsWith('}\n')).toBe(true);
  });

  it('reproduces the real metadata file byte for byte', async () => {
    // The strongest guarantee the sheet can offer: pasting the output of a
    // pass that traced nothing leaves a zero-line diff, so every line that does
    // change is a credit somebody actually found.
    const { readFile } = await import('node:fs/promises');
    const text = await readFile('src/data/gallery.meta.json', 'utf8');

    expect(stringifyMeta(JSON.parse(text), topLevelKeys(text))).toBe(text);
  });

  it('keeps the blank line that separates the note from the data', () => {
    const out = stringifyMeta({ _comment: 'note', '07': {} }, ['_comment', '07']);

    expect(out).toContain('"_comment": "note",\n\n  "07"');
  });
});
