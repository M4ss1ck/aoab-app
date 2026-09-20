import { describe, it, expect } from 'vitest';
import {
  orderImages,
  creditSummary,
  untracedSentence,
  HERO_ID,
  type SceneOverride,
} from '../src/lib/ordering';

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

describe('creditSummary', () => {
  const traced = { credit: { artist: 'A' } };
  const untraced = {};

  it('labels each untraced piece when only some are untraced', () => {
    // Here the label carries information: it says which rows are the gap.
    expect(creditSummary([traced, untraced, traced])).toEqual({
      untraced: 1,
      total: 3,
      labelPerItem: true,
    });
  });

  it('drops the per-item label when nothing is traced', () => {
    // Ten identical labels repeat the note underneath them and say nothing
    // one row at a time, so the note carries the statement alone.
    expect(creditSummary([untraced, untraced])).toEqual({
      untraced: 2,
      total: 2,
      labelPerItem: false,
    });
  });

  it('drops it when everything is traced, because there is no gap', () => {
    expect(creditSummary([traced, traced])).toEqual({
      untraced: 0,
      total: 2,
      labelPerItem: false,
    });
  });

  it('handles an empty gallery without claiming a gap', () => {
    expect(creditSummary([])).toEqual({ untraced: 0, total: 0, labelPerItem: false });
  });
});

describe('untracedSentence', () => {
  it('says nothing when every piece is credited', () => {
    expect(untracedSentence(0, 10)).toBeNull();
  });

  it('states a total miss without implying any success', () => {
    // The phrasing that reads as a success count is the bug this guards:
    // "8 of these pieces could be traced" means the opposite of what it says.
    const sentence = untracedSentence(10, 10);

    expect(sentence).toBe('None of these pieces has been traced back to its artist yet.');
    expect(sentence).not.toContain('could be traced');
  });

  it('uses the singular for exactly one', () => {
    expect(untracedSentence(1, 10)).toBe(
      'One of these pieces has not been traced back to its artist yet.',
    );
  });

  it('counts the untraced pieces, not the traced ones', () => {
    expect(untracedSentence(8, 10)).toBe(
      '8 of these pieces have not been traced back to their artists yet.',
    );
  });

  it('never reports a negative count', () => {
    expect(untracedSentence(-1, 10)).toBeNull();
  });
});
