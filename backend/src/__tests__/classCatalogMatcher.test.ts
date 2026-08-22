import {
  normalizeTitle,
  reconcileCatalog,
  splitOfferingSuffix,
  titleSimilarity,
  type CatalogEntry,
  type ListedClass,
} from '../services/classCatalogMatcher';
import { parseCsv, parseCsvRecords } from '../utils/parseCsv';

const cat = (id: string, title: string, instructor = 'Ada Lovelace'): CatalogEntry => ({ id, title, instructor });
const site = (id: string, title: string, instructor = 'Ada Lovelace'): ListedClass => ({ id, title, instructor });

describe('normalizeTitle', () => {
  it('reads an acronym the same however it is punctuated', () => {
    // The catalog writes "The US and Europe", the site "The U.S. and Europe".
    // Stripping punctuation naively gives "us" and "u s" — a non-match on two
    // strings any reader would call identical.
    expect(normalizeTitle('The U.S. and Europe')).toBe(normalizeTitle('The US and Europe'));
  });

  it('ignores the typography the two sources disagree about', () => {
    expect(normalizeTitle('Fifes & Drums')).toBe(normalizeTitle('Fifes and Drums'));
    expect(normalizeTitle('Creative Movement Ages 3–4')).toBe(normalizeTitle('Creative Movement Ages 3-4'));
    expect(normalizeTitle('O’Keeffe')).toBe(normalizeTitle("O'Keeffe"));
  });
});

describe('splitOfferingSuffix', () => {
  it('keeps the day, which distinguishes two real classes', () => {
    // Catalog ids 53 and 54 are the same class on Monday and on Tuesday, at
    // different times. Treating the suffix as noise merges two real offerings.
    const mon = splitOfferingSuffix('Non-Traditional Watercolor: Monday Session');
    const tue = splitOfferingSuffix('Non-Traditional Watercolor: Tuesday Session');
    expect(mon.base).toBe(tue.base);
    expect(mon.suffix).not.toEqual(tue.suffix);
  });

  it('reports no suffix on a plain title', () => {
    expect(splitOfferingSuffix('Watercolor: From the Beginning').suffix).toBeNull();
  });
});

describe('reconcileCatalog', () => {
  it('joins identical titles', () => {
    const r = reconcileCatalog([cat('1', 'Sight Singing')], [site('CHQ.1', 'Sight Singing')]);
    expect(r.matches).toEqual([{ catalogId: '1', listedId: 'CHQ.1', method: 'exact' }]);
    expect(r.catalogOnly).toEqual([]);
    expect(r.listedOnly).toEqual([]);
  });

  it('lets one catalog row claim several listings of it', () => {
    // The site splits a class into per-day listings the catalog names once.
    const r = reconcileCatalog(
      [cat('1', 'Carry the Spirit of CHQ Home')],
      [site('CHQ.1', 'Carry the Spirit of CHQ Home: Thursday Session'),
       site('CHQ.2', 'Carry the Spirit of CHQ Home: Friday Session')],
    );
    expect(r.matches.map(m => m.listedId).sort()).toEqual(['CHQ.1', 'CHQ.2']);
    expect(r.matches.every(m => m.method === 'offering')).toBe(true);
    expect(r.listedOnly).toEqual([]);
  });

  it('does not merge two offerings the catalog names separately', () => {
    // Both sides carry the suffix, so it discriminates rather than decorates.
    const r = reconcileCatalog(
      [cat('53', 'Non-Traditional Watercolor: Monday Session'),
       cat('54', 'Non-Traditional Watercolor: Tuesday Session')],
      [site('CHQ.1', 'Non-Traditional Watercolor: Monday Session'),
       site('CHQ.2', 'Non-Traditional Watercolor: Tuesday Session')],
    );
    expect(r.matches).toEqual(expect.arrayContaining([
      { catalogId: '53', listedId: 'CHQ.1', method: 'exact' },
      { catalogId: '54', listedId: 'CHQ.2', method: 'exact' },
    ]));
    expect(r.matches).toHaveLength(2);
  });

  it('uses the instructor when a title alone is ambiguous', () => {
    const r = reconcileCatalog(
      [cat('1', 'Watercolor', 'Kim Kloecker')],
      [site('CHQ.1', 'Watercolor', 'Someone Else'), site('CHQ.2', 'Watercolor', 'Kim Kloecker')],
    );
    expect(r.matches).toEqual([{ catalogId: '1', listedId: 'CHQ.2', method: 'instructor' }]);
  });

  it('accepts a rename only when the instructor agrees too', () => {
    const near = 'Beginner Cherokee Basketweaving Workshop';
    const same = reconcileCatalog([cat('1', 'Beginner Cherokee Basketweaving', 'Robert Lewis')],
                                  [site('CHQ.1', near, 'Robert Lewis')]);
    expect(same.matches[0]).toMatchObject({ method: 'fuzzy' });

    const diff = reconcileCatalog([cat('1', 'Beginner Cherokee Basketweaving', 'Robert Lewis')],
                                  [site('CHQ.1', near, 'Someone Else')]);
    expect(diff.matches).toEqual([]);
    expect(diff.needsReview).toHaveLength(1);
  });

  it('reports a plausible pair rather than joining it', () => {
    // "Music Appreciation Grateful Dead" vs "Grateful Dead" is almost
    // certainly the same class — but a wrong join silently attaches one
    // class's description to another, so it is a question, not an answer.
    const r = reconcileCatalog([cat('1', 'Music Appreciation Grateful Dead', 'Al Scopp')],
                               [site('CHQ.1', 'Grateful Dead', 'Al Scopp')]);
    expect(r.matches).toEqual([]);
    expect(r.needsReview[0]).toMatchObject({ catalogId: '1', listedId: 'CHQ.1' });
  });

  it('separates what was planned from what was added', () => {
    const r = reconcileCatalog([cat('1', 'Cancelled Class')], [site('CHQ.9', 'Late Addition')]);
    expect(r.catalogOnly.map(c => c.id)).toEqual(['1']);
    expect(r.listedOnly.map(l => l.id)).toEqual(['CHQ.9']);
  });
});

describe('titleSimilarity', () => {
  it('scores identical titles 1 and unrelated ones near 0', () => {
    expect(titleSimilarity('Watercolor Basics', 'Watercolor Basics')).toBe(1);
    expect(titleSimilarity('Watercolor Basics', 'Dungeons and Dragons')).toBe(0);
  });
});

describe('parseCsv', () => {
  it('keeps commas, newlines and quotes inside quoted fields', () => {
    // The catalog's Description column carries all three; a split(',') loses
    // every row containing one.
    const rows = parseCsv('a,"b,with,commas","line\nbreak","say ""hi"""\n');
    expect(rows).toEqual([['a', 'b,with,commas', 'line\nbreak', 'say "hi"']]);
  });

  it('reads records from a header row below a spanning title row', () => {
    const recs = parseCsvRecords(',,\nid,Title,Fee\n7,"Scones, plain",$45\n', 1);
    expect(recs).toEqual([{ id: '7', Title: 'Scones, plain', Fee: '$45' }]);
  });

  it('drops a byte order mark rather than folding it into a column name', () => {
    expect(parseCsvRecords('﻿id,Title\n1,Yoga\n')).toEqual([{ id: '1', Title: 'Yoga' }]);
  });
});
