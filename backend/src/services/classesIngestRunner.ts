import { parseClassDetail } from './classesScraper';
import type { ChqClass, ClassSearchRow, ClassesFile } from '../types/classes';

/** Structural deps, so the local script can substitute file-backed stand-ins. */
export interface ClassesSource {
  fetchCatalog(): Promise<ClassSearchRow[]>;
  fetchSubjectMap(): Promise<Map<string, string[]>>;
  forEachClassDetail(
    ids: string[],
    onDetail: (id: string, html: string) => void | Promise<void>,
    concurrency?: number,
  ): Promise<{ fetched: number; failures: { id: string; error: string }[] }>;
}

export interface ClassesSink {
  /**
   * The previously published catalog. It doubles as this pipeline's state:
   * unlike the program matcher there is nothing private to keep — the
   * catalog is entirely public data — so a separate state object would only
   * be a second copy to keep in step.
   */
  loadCatalog(year: number): Promise<ClassesFile | undefined>;
  publishCatalog(year: number, file: ClassesFile): Promise<void>;
}

export type ClassesIngestMode = 'full' | 'spots';

export interface ClassesIngestDeps {
  client: ClassesSource;
  sink: ClassesSink;
  now: Date;
  year: number;
  mode: ClassesIngestMode;
  /** How far ahead `spots` mode refreshes. */
  spotsHorizonDays?: number;
}

export interface ClassesIngestSummary {
  mode: ClassesIngestMode;
  classes: number;
  /** True when the run paid for a subject crawl. */
  subjectsCrawled: boolean;
  sessions: number;
  detailsFetched: number;
  detailFailures: number;
  carriedForward: number;
  published: boolean;
}

const DEFAULT_SPOTS_HORIZON_DAYS = 10;

/**
 * How far the catalog may shrink before a run is treated as broken.
 *
 * The listing does not shrink as the season ends: a class stays listed with
 * zero sessions left once its last week passes, verified across two days in
 * late August. So a real drop means a truncated crawl, not the calendar
 * moving on, and the threshold can sit close to 1 without false alarms.
 */
const MIN_CATALOG_RATIO = 0.8;

/** Fraction of detail pages that may fail before the run is not worth publishing. */
const MAX_DETAIL_FAILURE_RATIO = 0.2;

/**
 * The season the ticket site is currently selling, turning over on October 1
 * in Institution time — the same rule the web app's `getDefaultYear` uses.
 *
 * This is not cosmetic. The site prints session dates with no year at all
 * ("Aug 19 - Aug 21"), so the year we stamp is the only thing that decides
 * which season those dates land in. Reading it in Institution time keeps a
 * run east of Eastern from rolling over a few hours early on September 30.
 */
export function institutionSeasonYear(now: Date): number {
  const [year, month] = institutionDateKey(now).split('-').map(Number);
  return month >= 10 ? year + 1 : year;
}

/** Today's date in the Institution's timezone, as YYYY-MM-DD. */
function institutionDateKey(d: Date): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sessions carry "2026-08-26 16:30:00"; the date half is the comparable part. */
const dateKey = (naiveLocal: string): string => naiveLocal.slice(0, 10);

/**
 * Classes with a session running in, or starting within, the horizon.
 *
 * Overlap rather than start date: a class that began on Monday and runs to
 * Friday still has a live spot count on Wednesday, and its page is exactly
 * the one showing a number someone might act on. Filtering on start alone
 * dropped roughly a third of the sessions that still had places.
 */
function nearTermClassIds(classes: ChqClass[], now: Date, horizonDays: number): string[] {
  const today = institutionDateKey(now);
  const limit = addDays(today, horizonDays);
  return classes
    .filter(c => c.sessions.some(s => dateKey(s.endDate) >= today && dateKey(s.startDate) <= limit))
    .map(c => c.id);
}

/** Compares catalogs ignoring `generatedAt`, which changes on every run. */
function catalogChanged(before: ClassesFile | undefined, after: ClassesFile): boolean {
  if (!before) return true;
  return JSON.stringify(before.classes) !== JSON.stringify(after.classes);
}

/**
 * One ingest cycle.
 *
 * `full` rebuilds the catalog: crawl the listing, then read every class's
 * detail page. `spots` re-reads only the classes with a session starting
 * soon, and patches their availability into the published catalog — the
 * numbers people are actually deciding on, refreshed without paying for a
 * whole crawl.
 *
 * Both refuse to publish a result that looks broken rather than merely
 * changed. A previously published catalog is better than a truncated one.
 */
export async function runClassesIngest(deps: ClassesIngestDeps): Promise<ClassesIngestSummary> {
  const { sink, now, year, mode } = deps;
  const previous = await sink.loadCatalog(year);

  const classes = mode === 'full'
    ? await runFullCrawl(deps, previous)
    : await runSpotsRefresh(deps, previous);

  const file: ClassesFile = { generatedAt: now.toISOString(), year, classes: classes.classes };
  const published = catalogChanged(previous, file);
  if (published) {
    await sink.publishCatalog(year, file);
  }

  const summary: ClassesIngestSummary = {
    mode,
    classes: file.classes.length,
    sessions: file.classes.reduce((n, c) => n + c.sessions.length, 0),
    detailsFetched: classes.fetched,
    detailFailures: classes.failures,
    carriedForward: classes.carriedForward,
    subjectsCrawled: classes.subjectsCrawled,
    published,
  };
  console.log('[classes-ingest] summary:', JSON.stringify(summary));
  return summary;
}

interface Pass {
  classes: ChqClass[];
  fetched: number;
  failures: number;
  carriedForward: number;
  subjectsCrawled: boolean;
}

async function runFullCrawl(deps: ClassesIngestDeps, previous: ClassesFile | undefined): Promise<Pass> {
  const { client, year } = deps;
  const rows = await client.fetchCatalog();

  if (previous && previous.classes.length > 0) {
    const ratio = rows.length / previous.classes.length;
    if (ratio < MIN_CATALOG_RATIO) {
      throw new Error(
        `[classes-ingest] catalog fell from ${previous.classes.length} to ${rows.length} classes ` +
        `(${Math.round(ratio * 100)}%) — refusing to publish a likely truncated crawl`,
      );
    }
  }

  const priorById = new Map((previous?.classes ?? []).map(c => [c.id, c]));

  // Subjects cost a second full listing crawl, one pass per subject, and a
  // class's subjects do not change during a season. So they are looked up
  // only when the catalog contains a class the last run had never seen —
  // which after the first run is usually none. Note this keys off having
  // seen the class, not off it having subjects: were "no subjects" treated
  // as "not yet known", a single subject-less class would re-trigger a full
  // subject crawl every hour for ever.
  const unseen = rows.filter(r => !priorById.has(r.id));
  const subjectsCrawled = unseen.length > 0;
  const subjectMap = subjectsCrawled
    ? await client.fetchSubjectMap()
    : new Map<string, string[]>();
  if (subjectsCrawled) {
    console.log(`[classes-ingest] ${unseen.length} new class(es); crawled subjects for ${subjectMap.size}`);
  }
  const subjectsFor = (id: string): string[] =>
    subjectMap.get(id) ?? priorById.get(id)?.subjects ?? [];

  const details = new Map<string, ChqClass>();
  const { fetched, failures } = await client.forEachClassDetail(
    rows.map(r => r.id),
    (id, html) => {
      const row = rows.find(r => r.id === id)!;
      const detail = parseClassDetail(html, id, year);
      details.set(id, { ...row, ...detail, subjects: subjectsFor(id), timezone: 'America/New_York' });
    },
  );

  if (rows.length > 0 && failures.length / rows.length > MAX_DETAIL_FAILURE_RATIO) {
    throw new Error(
      `[classes-ingest] ${failures.length} of ${rows.length} detail pages failed — refusing to publish`,
    );
  }

  // A class whose page could not be read keeps the sessions the last run
  // saw. Publishing it with none would read exactly like "this class is
  // over", which is the one thing a failed fetch must not be allowed to say.
  let carriedForward = 0;
  const classes = rows.map((row) => {
    const fresh = details.get(row.id);
    if (fresh) return fresh;
    const prior = priorById.get(row.id);
    if (prior) {
      carriedForward++;
      return { ...prior, ...row, subjects: subjectsFor(row.id), sessions: prior.sessions };
    }
    // Never seen before and unreadable now: list it with what the row
    // gives us, and let the next run fill in the sessions.
    carriedForward++;
    return {
      ...row, description: '', sessions: [],
      subjects: subjectsFor(row.id), timezone: 'America/New_York' as const,
    };
  });

  return { classes, fetched, failures: failures.length, carriedForward, subjectsCrawled };
}

async function runSpotsRefresh(deps: ClassesIngestDeps, previous: ClassesFile | undefined): Promise<Pass> {
  const { client, year, now, spotsHorizonDays = DEFAULT_SPOTS_HORIZON_DAYS } = deps;
  if (!previous) {
    throw new Error('[classes-ingest] spots refresh has no published catalog to refresh — run a full crawl first');
  }

  const ids = nearTermClassIds(previous.classes, now, spotsHorizonDays);
  if (ids.length === 0) {
    console.log('[classes-ingest] no sessions start within the horizon; nothing to refresh');
    return { classes: previous.classes, fetched: 0, failures: 0, carriedForward: 0, subjectsCrawled: false };
  }

  const refreshed = new Map<string, ChqClass>();
  const { fetched, failures } = await client.forEachClassDetail(ids, (id, html) => {
    const prior = previous.classes.find(c => c.id === id)!;
    const detail = parseClassDetail(html, id, year);
    refreshed.set(id, { ...prior, ...detail });
  });

  // Unlike a full crawl this touches a handful of classes, so a failure just
  // leaves that class as it was until the next pass.
  const classes = previous.classes.map(c => refreshed.get(c.id) ?? c);
  return {
    classes, fetched, failures: failures.length,
    carriedForward: failures.length, subjectsCrawled: false,
  };
}
