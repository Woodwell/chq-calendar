import * as fs from 'fs';
import * as path from 'path';
import { runClassesIngest, type ClassesSink, type ClassesSource } from '../services/classesIngestRunner';
import type { ChqClass, ClassSearchRow, ClassesFile } from '../types/classes';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const DAY_1 = fix('chq-class-detail.html');
const DAY_2 = fix('chq-class-detail-next-day.html');
const NOW = new Date('2026-08-20T15:00:00Z');

const row = (id: string): ClassSearchRow => ({
  id,
  title: 'If Chocolate Brings You Joy: Wednesday Session',
  weeksLabel: 'Weeks 8 to 9',
  daysLabel: 'W',
  location: 'Turner Community Center Conference Room',
  ageRangeText: 'Ages 12+',
  ageRange: { min: 12, max: null },
  instructor: 'Jill Sandler',
  priceLabel: 'Session: $55.00',
  summary: 'Chocolate.',
  sessionCount: 1,
  sourceUrl: `https://tickets.chq.org/class.html?eventAk=${id}`,
});

/** A source serving one page of HTML per class id. */
function source(rows: ClassSearchRow[], html: Record<string, string>, fail: string[] = []): ClassesSource {
  return {
    fetchCatalog: async () => rows,
    forEachClassDetail: async (ids, onDetail) => {
      const failures: { id: string; error: string }[] = [];
      let fetched = 0;
      for (const id of ids) {
        if (fail.includes(id)) { failures.push({ id, error: 'boom' }); continue; }
        await onDetail(id, html[id] ?? DAY_1);
        fetched++;
      }
      return { fetched, failures };
    },
  };
}

function sink(initial?: ClassesFile) {
  const published: ClassesFile[] = [];
  const api: ClassesSink = {
    loadCatalog: async () => initial,
    publishCatalog: async (_year, file) => { published.push(file); },
  };
  return { api, published };
}

describe('runClassesIngest — full crawl', () => {
  it('joins each listing row to its detail page and publishes', async () => {
    const s = sink();
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full',
    });

    expect(summary).toMatchObject({ classes: 1, sessions: 2, detailsFetched: 1, published: true });
    const cls = s.published[0].classes[0];
    // Listing fields and detail fields both survive the join.
    expect(cls.ageRangeText).toBe('Ages 12+');
    expect(cls.sessions.map(x => x.spotsRemaining)).toEqual([13, 28]);
    expect(cls.timezone).toBe('America/New_York');
  });

  it('does not republish when nothing changed', async () => {
    const first = sink();
    await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: first.api, now: NOW, year: 2026, mode: 'full',
    });

    const second = sink(first.published[0]);
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: second.api, now: new Date('2026-08-21T15:00:00Z'), year: 2026, mode: 'full',
    });

    // generatedAt moved, the catalog did not; a rewrite would churn the CDN.
    expect(summary.published).toBe(false);
    expect(second.published).toHaveLength(0);
  });

  it('publishes when real enrollment moves', async () => {
    const first = sink();
    await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: first.api, now: NOW, year: 2026, mode: 'full',
    });

    const second = sink(first.published[0]);
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_2 }),
      sink: second.api, now: NOW, year: 2026, mode: 'full',
    });

    expect(summary.published).toBe(true);
    // The real 24h diff: one session aged out, the other lost two spots.
    expect(second.published[0].classes[0].sessions).toHaveLength(1);
    expect(second.published[0].classes[0].sessions[0].spotsRemaining).toBe(26);
  });

  it('keeps the sessions it knew when a detail page cannot be read', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `CHQ.EVN${i}`);
    const first = sink();
    await runClassesIngest({
      client: source(ids.map(row), {}),  // every id serves the day-1 page
      sink: first.api, now: NOW, year: 2026, mode: 'full',
    });
    expect(first.published[0].classes).toHaveLength(10);

    // Next run: nine classes refresh to the day-2 page, one page fails.
    const second = sink(first.published[0]);
    const day2 = Object.fromEntries(ids.map(id => [id, DAY_2]));
    const summary = await runClassesIngest({
      client: source(ids.map(row), day2, ['CHQ.EVN3']),
      sink: second.api, now: NOW, year: 2026, mode: 'full',
    });

    expect(summary).toMatchObject({ detailsFetched: 9, detailFailures: 1, carriedForward: 1 });

    const byId = new Map(second.published[0].classes.map(c => [c.id, c]));
    // The nine that answered show the new number.
    expect(byId.get('CHQ.EVN0')!.sessions.map(x => x.spotsRemaining)).toEqual([26]);
    // The one that did not keeps what the last run saw. Publishing zero
    // sessions here would read as "this class is over", which is the one
    // thing a failed fetch must never be allowed to say.
    expect(byId.get('CHQ.EVN3')!.sessions.map(x => x.spotsRemaining)).toEqual([13, 28]);
  });

  it('refuses a crawl that lost a fifth of the catalog', async () => {
    const previous: ClassesFile = {
      generatedAt: '2026-08-19T00:00:00.000Z',
      year: 2026,
      classes: Array.from({ length: 100 }, (_, i) => ({
        ...row(`CHQ.EVN${i}`), description: '', sessions: [], timezone: 'America/New_York',
      })) as ChqClass[],
    };
    const s = sink(previous);

    await expect(runClassesIngest({
      client: source(Array.from({ length: 50 }, (_, i) => row(`CHQ.EVN${i}`)), {}),
      sink: s.api, now: NOW, year: 2026, mode: 'full',
    })).rejects.toThrow(/catalog fell from 100 to 50/);
    expect(s.published).toHaveLength(0);
  });

  it('refuses when too many detail pages fail', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `CHQ.EVN${i}`);
    const s = sink();
    await expect(runClassesIngest({
      client: source(ids.map(row), {}, ids.slice(0, 5)),
      sink: s.api, now: NOW, year: 2026, mode: 'full',
    })).rejects.toThrow(/5 of 10 detail pages failed/);
    expect(s.published).toHaveLength(0);
  });
});

describe('runClassesIngest — spots refresh', () => {
  const published = (): ClassesFile => ({
    generatedAt: '2026-08-19T00:00:00.000Z',
    year: 2026,
    classes: [{
      ...row('CHQ.EVN1687'),
      description: '',
      timezone: 'America/New_York',
      // Week 9 session on Aug 26 — six days out from NOW.
      sessions: [{
        performanceId: 'CHQ.EVN1687.PRF2', week: 9, dateRangeLabel: 'Aug 26 - Aug 26',
        startDate: '2026-08-26 16:30:00', endDate: '2026-08-26 17:45:00',
        daysOfWeek: ['Wednesday'], timeRangeLabel: '4:30 pm - 5:45 pm',
        location: 'Turner Community Center Conference Room',
        spotsRemaining: 28, availability: 'open',
      }],
    }] as ChqClass[],
  });

  it('refreshes only the classes starting within the horizon', async () => {
    const s = sink(published());
    const summary = await runClassesIngest({
      client: source([], { 'CHQ.EVN1687': DAY_2 }),
      sink: s.api, now: NOW, year: 2026, mode: 'spots',
    });

    expect(summary.detailsFetched).toBe(1);
    expect(s.published[0].classes[0].sessions[0].spotsRemaining).toBe(26);
  });

  it('leaves a far-off catalog alone', async () => {
    const far = published();
    far.classes[0].sessions[0].startDate = '2026-09-30 16:30:00';
    const s = sink(far);

    const summary = await runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'spots',
    });

    expect(summary.detailsFetched).toBe(0);
    expect(summary.published).toBe(false);
  });

  it('will not refresh a catalog that was never published', async () => {
    const s = sink();
    await expect(runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'spots',
    })).rejects.toThrow(/run a full crawl first/);
  });
});

describe('the spots horizon', () => {
  const withSession = (start: string, end: string): ClassesFile => ({
    generatedAt: '2026-08-19T00:00:00.000Z',
    year: 2026,
    classes: [{
      ...row('CHQ.EVN1687'), description: '', timezone: 'America/New_York',
      sessions: [{
        performanceId: 'CHQ.EVN1687.PRF2', week: 8, dateRangeLabel: 'x',
        startDate: start, endDate: end, daysOfWeek: ['Monday'], timeRangeLabel: 'x',
        location: 'x', spotsRemaining: 28, availability: 'open',
      }],
    }] as ChqClass[],
  });

  it('refreshes a session already under way', async () => {
    // Began Monday, runs to Friday, and today is Thursday: the count on its
    // page is still live, so it must not be skipped for having started.
    const s = sink(withSession('2026-08-17 13:00:00', '2026-08-21 15:00:00'));
    const summary = await runClassesIngest({
      client: source([], { 'CHQ.EVN1687': DAY_2 }),
      sink: s.api, now: NOW, year: 2026, mode: 'spots',
    });
    expect(summary.detailsFetched).toBe(1);
  });

  it('leaves a session that has already finished', async () => {
    const s = sink(withSession('2026-08-10 13:00:00', '2026-08-14 15:00:00'));
    const summary = await runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'spots',
    });
    expect(summary.detailsFetched).toBe(0);
  });
});
