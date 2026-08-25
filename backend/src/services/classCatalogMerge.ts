/**
 * Joins the printed catalog to what the crawl actually found, and decides
 * what each source is allowed to claim.
 *
 * The split of authority:
 *
 *   The catalog describes.   Categories, ages, materials, fees, room — the
 *                            fields it was written to carry, and which the
 *                            ticket site never exposes.
 *   The crawl observes.      Enrollment above all, but also the real time,
 *                            day and place of a session, which can move after
 *                            the catalog goes to print. Where both carry a
 *                            field and disagree, the crawl wins: it reports
 *                            what will happen, not what was planned.
 *
 * And one asymmetry that shapes everything else — the crawl is authoritative
 * for existence, but only forwards. A class cannot be created or cancelled in
 * the past, so absence means "cancelled" only for a class the catalog
 * scheduled after the crawl ran. For one whose sessions were already over,
 * absence means nothing at all, and is recorded as `unobserved`.
 */
import { reconcileCatalog, type CatalogEntry, type ListedClass } from './classCatalogMatcher';
import type { CatalogClass } from './classCatalog';
import type { ChqClass, ClassStatus, ScheduledWeek } from '../types/classes';

export interface MergeInput {
  catalog: CatalogClass[];
  /** Freshly crawled classes, carrying only what the site knows. */
  listed: CrawledClass[];
  /** The previously published catalog, for carrying `lastObserved` forward. */
  previous?: ChqClass[];
  /** The crawl's own date, YYYY-MM-DD in Institution time. */
  crawlDate: string;
}

/** A crawled class before the catalog has been merged into it. */
export type CrawledClass = Omit<
  ChqClass,
  'catalogId' | 'categories' | 'materials' | 'fee' | 'room' | 'provenance'
  | 'weeks' | 'scheduledWeeks'
>;

export interface MergeSummary {
  matched: number;
  /** Listed, with no catalog row: added after the catalog printed. */
  listedOnly: number;
  unobserved: number;
  cancelled: number;
  /** Plausible pairs the matcher declined to join. Read these. */
  needsReview: number;
}

export interface MergeResult {
  classes: ChqClass[];
  summary: MergeSummary;
}

/** Sessions carry "2026-08-26 16:30:00"; the date half is the comparable part. */
const dateKey = (naiveLocal: string): string => naiveLocal.slice(0, 10);

/**
 * When each season week ends, learned from the sessions the crawl saw.
 *
 * The catalog says a class runs in week 4 but never says what week 4's dates
 * are; the site prints dates but not a season calendar. Reading the mapping
 * off the crawl is what lets the two be compared at all.
 */
export function weekEndDates(listed: CrawledClass[]): Map<number, string> {
  const ends = new Map<number, string>();
  for (const c of listed) {
    for (const s of c.sessions) {
      const end = dateKey(s.endDate);
      const known = ends.get(s.week);
      if (!known || end > known) ends.set(s.week, end);
    }
  }
  return ends;
}

/**
 * What a crawl on `crawlDate` may conclude from a catalog class being absent.
 *
 * Returns `cancelled` only when the class was scheduled to run after the
 * crawl — the one case where absence is evidence. Everything else, including
 * a week whose dates the crawl could not establish, is `unobserved`: not a
 * softer way of saying cancelled, but a refusal to guess.
 */
export function statusForAbsent(
  weeks: number[],
  weekEnds: Map<number, string>,
  crawlDate: string,
): ClassStatus {
  const lastWeek = weeks.length ? Math.max(...weeks) : null;
  if (lastWeek === null) return 'unobserved';

  const end = weekEnds.get(lastWeek);
  // No session anywhere in that week, so the crawl cannot date it. Off-season
  // every week looks like this, which is exactly when a crawl knows least.
  if (!end) return 'unobserved';

  return end > crawlDate ? 'cancelled' : 'unobserved';
}

/** "Weeks 2, 3" / "Week 5" — the catalog prints weeks, not dates. */
function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return '';
  return weeks.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks.join(', ')}`;
}

const DAY_ABBR: Record<string, string> = {
  Monday: 'M', Tuesday: 'Tu', Wednesday: 'W', Thursday: 'Th',
  Friday: 'F', Saturday: 'Sa', Sunday: 'Su',
};

/**
 * The catalog's schedule, one entry per week it runs.
 *
 * The catalog prints a single day/time per class rather than one per week, so
 * every week it runs shares the same shape. Kept as a list anyway, because
 * the reader wants to see week 2 and week 3 as separate rows on the card.
 */
function scheduledWeeksOf(c: CatalogClass): ScheduledWeek[] {
  return c.weeks.map((week) => ({
    week,
    daysOfWeek: c.daysOfWeek,
    startTime: c.startTime,
    endTime: c.endTime,
    location: c.location,
    room: c.room,
  }));
}

/** Ages rendered the way the site writes them, so both sources read alike. */
function ageRangeText(c: CatalogClass): string {
  const { min, max } = c.ageRange;
  const base = min !== null && max !== null ? `Ages ${min}-${max}`
    : min !== null ? `Ages ${min}+`
      : max !== null ? `Ages ${max} and under`
        : 'All ages';
  return c.caregiver ? `${base} with Caregiver` : base;
}

/**
 * A catalog class the crawl never listed, rendered as a publishable record.
 *
 * It has no sessions, because sessions are something only the crawl can
 * observe, and inventing them from the intended schedule would manufacture
 * exactly the evidence this design refuses to manufacture. What it does carry
 * is the catalog's own description of what was planned.
 */
function fromCatalogOnly(c: CatalogClass, status: ClassStatus, lastObserved: string | null): ChqClass {
  return {
    // Namespaced so it cannot be mistaken for, or collide with, an eventAk.
    id: `catalog:${c.id}`,
    catalogId: c.id,
    title: c.title,
    instructor: c.instructor,
    description: c.description,
    summary: c.description,
    categories: c.categories,
    ageRange: c.ageRange,
    ageRangeText: ageRangeText(c),
    materials: c.materials,
    fee: c.fee,
    priceLabel: c.fee,
    location: c.location,
    room: c.room,
    weeks: c.weeks,
    scheduledWeeks: scheduledWeeksOf(c),
    weeksLabel: weeksLabel(c.weeks),
    daysLabel: c.daysOfWeek.map((d) => DAY_ABBR[d] ?? d).join(', '),
    sessionCount: c.weeks.length || null,
    // Not listed, so there is no page to register on. Callers must treat this
    // as "no link" rather than building a URL that 404s.
    sourceUrl: '',
    sessions: [],
    provenance: { catalog: true, lastObserved, status },
    timezone: 'America/New_York',
  };
}

export function mergeCatalog(input: MergeInput): MergeResult {
  const { catalog, listed, previous = [], crawlDate } = input;

  const catalogEntries: CatalogEntry[] = catalog.map((c) => ({
    id: c.id, title: c.title, instructor: c.instructor,
  }));
  const listedEntries: ListedClass[] = listed.map((c) => ({
    id: c.id, title: c.title, instructor: c.instructor,
  }));

  const rec = reconcileCatalog(catalogEntries, listedEntries);

  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  // One catalog row can legitimately back several listings — the site splits
  // an offering into per-day pages — so this maps listing -> catalog, not the
  // other way round.
  const catalogForListing = new Map<string, CatalogClass>();
  for (const m of rec.matches) {
    const c = catalogById.get(m.catalogId);
    if (c) catalogForListing.set(m.listedId, c);
  }

  // Prior records reachable by catalog row, not just by id. A class listed
  // yesterday was stored under its eventAk; today, absent, it is looked up as
  // a catalog row — so without this the date it was last seen is lost at
  // exactly the moment it starts to matter.
  const priorByCatalogId = new Map<string, ChqClass>();
  for (const c of previous) {
    if (c.catalogId) priorByCatalogId.set(c.catalogId, c);
  }

  const classes: ChqClass[] = listed.map((c) => {
    const cat = catalogForListing.get(c.id);
    return {
      ...c,
      catalogId: cat?.id ?? null,
      categories: cat?.categories ?? [],
      materials: cat?.materials ?? null,
      fee: cat?.fee ?? null,
      room: cat?.room ?? null,
      // The catalog's numbers beat a best-effort parse of the site's free
      // text — but only where it has them, so a class the catalog does not
      // cover keeps whatever the listing yielded.
      ageRange: cat && (cat.ageRange.min !== null || cat.ageRange.max !== null)
        ? cat.ageRange
        : c.ageRange,
      // Union rather than either alone. The catalog holds the weeks already
      // past, which the site has dropped; the crawl holds any the catalog did
      // not print, which is all a listing-only class has.
      weeks: [...new Set([
        ...(cat?.weeks ?? []),
        ...c.sessions.map((s) => s.week),
      ])].sort((a, b) => a - b),
      // The plan for every week, including those the site has already
      // dropped. The card falls back to these so a past week still reads as
      // a week rather than as whatever session happens to be left.
      scheduledWeeks: cat ? scheduledWeeksOf(cat) : [],
      provenance: { catalog: Boolean(cat), lastObserved: crawlDate, status: 'listed' as const },
    };
  });

  const weekEnds = weekEndDates(listed);
  const absent = rec.catalogOnly.map((entry) => {
    const c = catalogById.get(entry.id)!;
    const status = statusForAbsent(c.weeks, weekEnds, crawlDate);
    // A class seen by an earlier run keeps that date: it is a record of when
    // it was last actually observed, not of this run's outcome.
    const prior = priorByCatalogId.get(c.id);
    return fromCatalogOnly(c, status, prior?.provenance.lastObserved ?? null);
  });

  return {
    classes: [...classes, ...absent],
    summary: {
      matched: rec.matches.length,
      listedOnly: rec.listedOnly.length,
      unobserved: absent.filter((c) => c.provenance.status === 'unobserved').length,
      cancelled: absent.filter((c) => c.provenance.status === 'cancelled').length,
      needsReview: rec.needsReview.length,
    },
  };
}
