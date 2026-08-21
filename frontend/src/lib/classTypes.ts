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
   * Every subject the class is listed under, e.g. ["Art", "Youth"]. Most
   * carry more than one; a few carry none.
   */
  subjects: string[];
  description: string;
  sessions: ClassSession[];
  timezone: 'America/New_York';
}

export interface ClassesFile {
  generatedAt: string;
  year: number;
  classes: ChqClass[];
}

/** The favorite key for one session. Namespaced so it cannot collide with
 *  event ids, which share the same localStorage set. */
export function classSessionKey(classId: string, performanceId: string): string {
  return `class:${classId}:${performanceId}`;
}
