/**
 * Special Studies classes scraped from tickets.chq.org.
 *
 * Dates follow the events feed's convention — naive Institution-local
 * datetimes plus an explicit `timezone` — so the web and iOS clients resolve
 * them through the same helpers they already use for events, rather than
 * meeting a second date convention here.
 */

/**
 * Whether a session can still be booked. `full` is not currently emitted:
 * every full session observed on the site offers a waitlist. It exists so a
 * future "full, no waitlist" state has somewhere to land instead of being
 * silently reported as `open`.
 */
export type ClassAvailability = 'open' | 'waitlist' | 'full' | 'unknown';

/**
 * Ages the class admits, parsed best-effort from `ageRangeText`. Both bounds
 * are inclusive; `null` means unbounded on that side, so "All ages" is
 * `{ min: null, max: null }` and "Ages 18+" is `{ min: 18, max: null }`.
 */
export interface ClassAgeRange {
  min: number | null;
  max: number | null;
}

/** One offering of a class: a specific week, at a specific place and time. */
export interface ClassSession {
  /**
   * The site's own performance id, e.g. "CHQ.EVN1687.PRF1". Stable across
   * scrapes and unique per session, which is what makes it usable as a
   * favorite key. Not derivable from the class id — the numbering is not
   * aligned to week numbers.
   */
  performanceId: string;
  /** Season week, 1-9. */
  week: number;
  /** Raw range as shown, e.g. "Aug 17 - Aug 21". */
  dateRangeLabel: string;
  /** First day at the session's start time: "2026-08-17 13:00:00". */
  startDate: string;
  /** Last day at the session's end time: "2026-08-21 15:00:00". */
  endDate: string;
  /** Full day names as shown, e.g. ["Monday", "Wednesday", "Friday"]. */
  daysOfWeek: string[];
  /** Raw range as shown, e.g. "1:00 pm - 3:00 pm". */
  timeRangeLabel: string;
  location: string;
  /** Seats left, or null when the session is full or the count is unreadable. */
  spotsRemaining: number | null;
  availability: ClassAvailability;
}

/** A class as it appears in a search-results row (no per-session detail). */
export interface ClassSearchRow {
  /** Event id, e.g. "CHQ.EVN1687". */
  id: string;
  title: string;
  /** Raw weeks text, e.g. "Weeks 1, 2, 6, 7, 9" or "Weeks 4 to 5". */
  weeksLabel: string;
  /** Abbreviated days as shown in the listing, e.g. "M, W, F". */
  daysLabel: string;
  location: string;
  /** Raw age text, e.g. "Ages 12+; 0 - 11 with Caregiver". */
  ageRangeText: string;
  ageRange: ClassAgeRange;
  instructor: string;
  /** Price as shown, e.g. "Sessions: $145.00". Free-form on purpose. */
  priceLabel: string;
  /** Truncated blurb from the listing; the detail page carries the full text. */
  summary: string;
  sessionCount: number | null;
  /** Absolute URL of the class page — where people actually register. */
  sourceUrl: string;
}

/** The per-class content that only the detail page carries. */
export interface ClassDetail {
  id: string;
  title: string;
  /** Plain text with line breaks kept; markup is stripped at ingest. */
  description: string;
  instructor: string;
  sessions: ClassSession[];
}

/** A class in the published catalog: search row plus detail-page content. */
export interface ChqClass extends ClassSearchRow, ClassDetail {
  /**
   * Every subject the class is listed under, e.g. ["Art", "Youth"].
   *
   * A list, not one value: most classes carry two or more, with "Youth" and
   * "General Interest" cutting across the rest. Empty is a real answer —
   * one class in the 2026 catalog belonged to no subject at all.
   */
  subjects: string[];
  timezone: 'America/New_York';
}

/** Shape of cache/calendar-cache/classes-<year>.json. */
export interface ClassesFile {
  generatedAt: string;
  year: number;
  classes: ChqClass[];
}
