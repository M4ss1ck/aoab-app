import { describe, it, expect } from 'vitest';
import { orderImages, HERO_ID, type SceneOverride } from '../src/lib/ordering';

const image = (id: string) => ({ id });
const overrides = (entries: Record<string, SceneOverride>) =>
  new Map(Object.entries(entries));

describe('orderImages', () => {
  it('keeps the hero out of the gallery', () => {
    const result = orderImages([image('01'), image(HERO_ID), image('02')], overrides({}));
    expect(result.map((entry) => entry.id)).toEqual(['01', '02']);
  });

  it('sorts by explicit order, not by filename', () => {
    const result = orderImages(
      [image('01'), image('02'), image('03')],
      overrides({ '01': { order: 30 }, '02': { order: 10 }, '03': { order: 20 } }),
    );
    expect(result.map((entry) => entry.id)).toEqual(['02', '03', '01']);
  });

  it('puts unordered images after ordered ones, sorted by id', () => {
    // This is the "drop image 11 in and it just works" contract: a new file
    // with no metadata has to land somewhere predictable.
    const result = orderImages(
      [image('12'), image('11'), image('01')],
      overrides({ '01': { order: 10 } }),
    );
    expect(result.map((entry) => entry.id)).toEqual(['01', '11', '12']);
  });

  it('breaks ties on equal order by id, so the result is deterministic', () => {
    const result = orderImages(
      [image('b'), image('a')],
      overrides({ a: { order: 5 }, b: { order: 5 } }),
    );
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('omits hidden images', () => {
    const result = orderImages(
      [image('01'), image('02')],
      overrides({ '02': { hidden: true } }),
    );
    expect(result.map((entry) => entry.id)).toEqual(['01']);
  });

  it('keeps images whose hidden flag is explicitly false', () => {
    const result = orderImages([image('01')], overrides({ '01': { hidden: false } }));
    expect(result.map((entry) => entry.id)).toEqual(['01']);
  });

  it('works with no overrides at all', () => {
    const result = orderImages([image('03'), image('01'), image('02')], overrides({}));
    expect(result.map((entry) => entry.id)).toEqual(['01', '02', '03']);
  });

  it('does not mutate the input array', () => {
    const input = [image('03'), image('01')];
    orderImages(input, overrides({}));
    expect(input.map((entry) => entry.id)).toEqual(['03', '01']);
  });

  it('handles an empty gallery', () => {
    expect(orderImages([], overrides({}))).toEqual([]);
  });

  it('handles every image being hidden', () => {
    const result = orderImages(
      [image('01'), image('02')],
      overrides({ '01': { hidden: true }, '02': { hidden: true } }),
    );
    expect(result).toEqual([]);
  });

  it('tolerates an override for an image that no longer exists', () => {
    // Deleting a source file should not require also editing the metadata.
    const result = orderImages([image('01')], overrides({ '99': { order: 1 } }));
    expect(result.map((entry) => entry.id)).toEqual(['01']);
  });
});
