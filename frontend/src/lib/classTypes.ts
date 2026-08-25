/**
 * Special Studies classes, as published in classes-<year>.json.
 *
 * Mirrors backend/src/types/classes.ts. Kept as its own file rather than
 * added to lib/types.ts because nothing on the calendar side reads it.
 */

/**
 * Whether a session can still be booked. `full` is not currently produced —
 * every full session on the ticket site offers a waitlist — but it is here
 * so a future "full, no waitlist" state has somewhere to land.
 */
export type ClassAvailability = 'open' | 'waitlist' | 'full' | 'unknown';

export interface ClassAgeRange {
  min: number | null;
  max: number | null;
}

/** One offering of a class: a specific week, at a specific place and time. */
export interface ClassSession {
  /** The ticket site's own id, e.g. "CHQ.EVN1687.PRF1". Stable, and unique. */
  performanceId: string;
  week: number;
  /** As shown on the ticket site, e.g. "Aug 17 - Aug 21". */
  dateRangeLabel: string;
  /** Naive Institution-local, like the events feed: "2026-08-17 13:00:00". */
  startDate: string;
  endDate: string;
  daysOfWeek: string[];
  timeRangeLabel: string;
  location: string;
  spotsRemaining: number | null;
  availability: ClassAvailability;
}

/**
 * What the last crawl could establish about the class existing.
 *
 * `unobserved` is not a softer `cancelled`. A crawl can only see forwards —
 * a class cannot be created or cancelled in the past — so a class whose
 * sessions had all finished before the crawl simply cannot be spoken about.
 * `cancelled` is reserved for one scheduled *after* the crawl and missing
 * from it, which is the only case where absence is evidence.
 */
export type ClassStatus = 'listed' | 'unobserved' | 'cancelled';

export interface ClassProvenance {
  catalog: boolean;
  /** ISO date of the last crawl that saw it, or null if never seen. */
  lastObserved: string | null;
  status: ClassStatus;
}

/** Materials the class needs, and who is expected to bring them. */
export interface ClassMaterials {
  fee: string;
  student: boolean;
  instructor: boolean;
}

/**
 * One week the printed catalog schedules a class for.
 *
 * The plan, not an observation. The ticket site drops a session once its week
 * ends, so for a week already past this is the only record of when and where
 * the class met. It carries no enrolment on purpose: how full a class was is
 * something only a crawl could have seen.
 */
export interface ScheduledWeek {
  week: number;
  daysOfWeek: string[];
  /** As the catalog prints it, e.g. "9:00 AM". */
  startTime: string;
  endTime: string;
  location: string;
  room: string;
  /**
   * When this season week ran, dated from the crawl's own sessions. Null when
   * nothing could date it — every week, off-season.
   *
   * The catalog numbers weeks and never dates them, so without this a card
   * cannot tell a week already past from one still to come.
   */
  weekStart: string | null;
  weekEnd: string | null;
}

export interface ChqClass {
  /** Event id on the ticket site, e.g. "CHQ.EVN1687". */
  id: string;
  title: string;
  weeksLabel: string;
  daysLabel: string;
  location: string;
  /** Raw text, e.g. "Ages 12+; 0 - 11 with Caregiver" — shown as written. */
  ageRangeText: string;
  ageRange: ClassAgeRange;
  instructor: string;
  priceLabel: string;
  summary: string;
  sessionCount: number | null;
  /** The class page on tickets.chq.org, where registration happens. */
  sourceUrl: string;
  /**
   * Editorial categories from the printed catalog, e.g. ["Art", "Youth"].
   * Empty when the catalog does not cover the class — an honest gap rather
   * than a label guessed from the ticket site's own taxonomy.
   */
  categories: string[];
  /** Row id in the printed catalog, or null when only the site knows it. */
  catalogId: string | null;
  /** Catalog only; null when the catalog does not cover the class. */
  materials: ClassMaterials | null;
  /** Tuition as the catalog prints it, e.g. "$115". Null when unknown. */
  fee: string | null;
  /** Room within `location`, which the ticket site runs into one string. */
  room: string | null;
  /**
   * Every season week the class is scheduled for, ascending.
   *
   * Not the same as the weeks in `sessions`: the ticket site drops a session
   * once its week is over, so a listed class shows only what is still to
   * come. This is the whole schedule, remembered by the printed catalog.
   */
  weeks: number[];
  /** The catalog's intended schedule, one entry per week in `weeks`. */
  scheduledWeeks: ScheduledWeek[];
  /**
   * Every building the class meets in, without room numbers — so a venue
   * filter offers 44 places rather than a few hundred rooms.
   */
  venues: string[];
  provenance: ClassProvenance;
  description: string;
  sessions: ClassSession[];
  timezone: 'America/New_York';
}

export interface ClassesFile {
  generatedAt: string;
  year: number;
  classes: ChqClass[];
}

/**
 * The favorite key for one week of one class.
 *
 * Keyed on the week rather than the ticket site's session id, because the
 * session id does not outlive the session: the site drops a session once its
 * week ends, and a star hung on that id would vanish with it. The week is
 * stable — no class in the catalog runs twice in the same week — so a starred
 * week stays starred whether the crawl can still see it or the printed
 * schedule is all that is left.
 *
 * Namespaced so it cannot collide with event ids, which share the same
 * localStorage set.
 */
export function classWeekKey(classId: string, week: number): string {
  return `class:${classId}:week${week}`;
}
