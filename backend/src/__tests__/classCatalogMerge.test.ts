import {
  mergeCatalog, statusForAbsent, weekEndDates, type CrawledClass,
} from '../services/classCatalogMerge';
import type { CatalogClass } from '../services/classCatalog';

const CRAWL_DATE = '2026-08-20';

const catalogClass = (over: Partial<CatalogClass> = {}): CatalogClass => ({
  id: '1',
  title: 'Watercolour',
  instructor: 'A Painter',
  description: 'Paint, at length.',
  categories: ['Art'],
  ageRange: { min: 18, max: null },
  caregiver: false,
  fee: '$115',
  materials: { fee: '$20', student: false, instructor: true },
  location: 'Hultquist',
  room: '101',
  weeks: [8],
  daysOfWeek: ['Monday'],
  startTime: '9:00 AM',
  endTime: '10:00 AM',
  ...over,
});

const session = (week: number, start: string, end: string) => ({
  performanceId: `PRF${week}`, week, dateRangeLabel: 'x',
  startDate: start, endDate: end, daysOfWeek: ['Monday'], timeRangeLabel: 'x',
  location: 'Hultquist 101', spotsRemaining: 5, availability: 'open' as const,
});

const crawled = (over: Partial<CrawledClass> = {}): CrawledClass => ({
  id: 'CHQ.EVN1',
  title: 'Watercolour',
  instructor: 'A Painter',
  description: 'Paint, as the site says.',
  weeksLabel: 'Week 8',
  daysLabel: 'M',
  location: 'Hultquist 101',
  ageRangeText: 'Ages 18+',
  ageRange: { min: 18, max: null },
  priceLabel: 'Session: $115.00',
  summary: 'Paint.',
  sessionCount: 1,
  sourceUrl: 'https://tickets.chq.org/class.html?eventAk=CHQ.EVN1',
  sessions: [session(8, '2026-08-17 09:00:00', '2026-08-21 10:00:00')],
  timezone: 'America/New_York',
  ...over,
});

describe('weekEndDates', () => {
  it('learns when each week ends from the sessions the crawl saw', () => {
    const ends = weekEndDates([
      crawled({ sessions: [session(8, '2026-08-17 09:00:00', '2026-08-19 10:00:00')] }),
      crawled({ id: 'CHQ.EVN2', sessions: [session(8, '2026-08-17 09:00:00', '2026-08-21 10:00:00')] }),
      crawled({ id: 'CHQ.EVN3', sessions: [session(9, '2026-08-24 09:00:00', '2026-08-28 10:00:00')] }),
    ]);
    // The latest end wins: a week runs until its last session finishes.
    expect(ends.get(8)).toBe('2026-08-21');
    expect(ends.get(9)).toBe('2026-08-28');
  });
});

describe('statusForAbsent — the temporal rule', () => {
  const ends = new Map([[1, '2026-06-30'], [8, '2026-08-21'], [9, '2026-08-28']]);

  it('calls a class cancelled when it was scheduled after the crawl', () => {
    expect(statusForAbsent([9], ends, CRAWL_DATE)).toBe('cancelled');
  });

  it('refuses to conclude anything about a class that had already finished', () => {
    expect(statusForAbsent([1], ends, CRAWL_DATE)).toBe('unobserved');
  });

  it('judges on the last week, not the first', () => {
    // Runs weeks 1 and 9. Week 9 is still ahead, so absence is evidence.
    expect(statusForAbsent([1, 9], ends, CRAWL_DATE)).toBe('cancelled');
  });

  it('will not guess when the crawl could not date the week', () => {
    // Off-season nothing is listed, so no week has an end date — exactly when
    // a crawl knows least, and must not start declaring classes cancelled.
    expect(statusForAbsent([9], new Map(), CRAWL_DATE)).toBe('unobserved');
  });

  it('treats a week ending on the crawl date as already over', () => {
    expect(statusForAbsent([8], new Map([[8, CRAWL_DATE]]), CRAWL_DATE)).toBe('unobserved');
  });

  it('says nothing about a class the catalog never scheduled', () => {
    expect(statusForAbsent([], ends, CRAWL_DATE)).toBe('unobserved');
  });
});

describe('mergeCatalog', () => {
  it('gives each source the fields it is authoritative for', () => {
    const { classes, summary } = mergeCatalog({
      catalog: [catalogClass()], listed: [crawled()], crawlDate: CRAWL_DATE,
    });

    expect(summary.matched).toBe(1);
    const [c] = classes;
    // Catalog: the descriptive fields the site never exposes.
    expect(c.categories).toEqual(['Art']);
    expect(c.room).toBe('101');
    expect(c.fee).toBe('$115');
    expect(c.materials).toEqual({ fee: '$20', student: false, instructor: true });
    // Crawl: what is happening, and what can be booked.
    expect(c.sessions).toHaveLength(1);
    expect(c.location).toBe('Hultquist 101');
    expect(c.provenance).toEqual({ catalog: true, lastObserved: CRAWL_DATE, status: 'listed' });
  });

  it('prefers the catalog ages over the listing text they were parsed from', () => {
    const { classes } = mergeCatalog({
      catalog: [catalogClass({ ageRange: { min: 6, max: 8 } })],
      listed: [crawled({ ageRange: { min: 6, max: null } })],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].ageRange).toEqual({ min: 6, max: 8 });
  });

  it('keeps the parsed ages when the catalog has none', () => {
    const { classes } = mergeCatalog({
      catalog: [catalogClass({ ageRange: { min: null, max: null } })],
      listed: [crawled({ ageRange: { min: 12, max: null } })],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].ageRange).toEqual({ min: 12, max: null });
  });

  it('publishes a listing with no catalog row, and leaves its categories empty', () => {
    const { classes, summary } = mergeCatalog({
      catalog: [], listed: [crawled()], crawlDate: CRAWL_DATE,
    });
    expect(summary.listedOnly).toBe(1);
    expect(classes[0].catalogId).toBeNull();
    expect(classes[0].categories).toEqual([]);
    expect(classes[0].provenance.catalog).toBe(false);
  });

  it('publishes an unobserved class from the catalog alone, with no sessions', () => {
    const { classes, summary } = mergeCatalog({
      catalog: [catalogClass(), catalogClass({ id: '2', title: 'Long Over', weeks: [1] })],
      listed: [crawled()],
      crawlDate: CRAWL_DATE,
    });

    expect(summary.unobserved).toBe(1);
    const gone = classes.find((c) => c.id === 'catalog:2')!;
    expect(gone.provenance.status).toBe('unobserved');
    expect(gone.catalogId).toBe('2');
    // Sessions are observed, never planned: inventing them from the intended
    // schedule would manufacture the evidence this design refuses to invent.
    expect(gone.sessions).toEqual([]);
    // No listing means no page, so callers must not build a link.
    expect(gone.sourceUrl).toBe('');
    // It still carries the catalog's description, which is why it is worth publishing.
    expect(gone.description).toBe('Paint, at length.');
    expect(gone.categories).toEqual(['Art']);
  });

  it('renders catalog-only ages and weeks the way the site would have', () => {
    const { classes } = mergeCatalog({
      catalog: [catalogClass({
        id: '2', title: 'Toddler Art', weeks: [2, 3],
        ageRange: { min: 3, max: 5 }, caregiver: true,
        daysOfWeek: ['Monday', 'Wednesday'],
      })],
      listed: [],
      crawlDate: CRAWL_DATE,
    });
    const c = classes[0];
    expect(c.ageRangeText).toBe('Ages 3-5 with Caregiver');
    expect(c.weeksLabel).toBe('Weeks 2, 3');
    expect(c.daysLabel).toBe('M, W');
  });

  it('keeps the date a now-missing class was last seen listed', () => {
    // Yesterday it was listed under its eventAk; today it is absent and gets
    // looked up as a catalog row. The date must survive that change of key —
    // it is precisely when "last seen" starts being worth anything.
    const yesterday = mergeCatalog({
      catalog: [catalogClass()], listed: [crawled()], crawlDate: '2026-08-19',
    }).classes;
    expect(yesterday[0].provenance.lastObserved).toBe('2026-08-19');

    // Another class still running in week 9 is what dates that week, so the
    // crawl can tell the missing one was scheduled ahead of it.
    const { classes } = mergeCatalog({
      catalog: [catalogClass({ weeks: [9] })],
      listed: [crawled({
        id: 'CHQ.EVN2', title: 'Something Else', instructor: 'Someone Else',
        sessions: [session(9, '2026-08-24 09:00:00', '2026-08-28 10:00:00')],
      })],
      previous: yesterday,
      crawlDate: CRAWL_DATE,
    });
    const gone = classes.find((c) => c.id === 'catalog:1')!;
    expect(gone.provenance.status).toBe('cancelled');
    expect(gone.provenance.lastObserved).toBe('2026-08-19');
  });

  it('carries an earlier observation date forward rather than blanking it', () => {
    // The class was seen a week ago and is gone now. `lastObserved` is a
    // record of when it was last actually seen, not of this run's outcome.
    const previous = mergeCatalog({
      catalog: [catalogClass({ id: '2', title: 'Long Over', weeks: [1] })],
      listed: [], crawlDate: '2026-08-13',
    }).classes;
    expect(previous[0].provenance.lastObserved).toBeNull();

    const seen = { ...previous[0], provenance: { ...previous[0].provenance, lastObserved: '2026-08-13' } };
    const { classes } = mergeCatalog({
      catalog: [catalogClass({ id: '2', title: 'Long Over', weeks: [1] })],
      listed: [], previous: [seen], crawlDate: CRAWL_DATE,
    });
    expect(classes[0].provenance.lastObserved).toBe('2026-08-13');
  });

  it('lets one catalog row back several of the site\'s per-day listings', () => {
    // The site splits an offering into a page per day; the catalog prints it
    // once. Both listings should pick up the same description.
    const { classes } = mergeCatalog({
      catalog: [catalogClass({ title: 'Watercolour' })],
      listed: [
        crawled({ id: 'CHQ.EVN1', title: 'Watercolour: Monday Session' }),
        crawled({ id: 'CHQ.EVN2', title: 'Watercolour: Tuesday Session' }),
      ],
      crawlDate: CRAWL_DATE,
    });
    expect(classes.map((c) => c.catalogId)).toEqual(['1', '1']);
    expect(classes.every((c) => c.categories.length === 1)).toBe(true);
  });
});
