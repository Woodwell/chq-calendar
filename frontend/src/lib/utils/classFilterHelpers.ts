import type { ChqClass, ClassSession } from '@/lib/classTypes';
import { classSessionKey } from '@/lib/classTypes';

export type AvailabilityFilter = 'all' | 'open' | 'waitlist';
export type TimeOfDay = 'all' | 'morning' | 'afternoon' | 'evening';

export interface ClassFilterOptions {
  /** Matched against the class title and instructor, not its sessions. */
  searchTerm: string;
  /** Subject names; empty means "any". A class matches if it has any of them. */
  selectedSubjects: string[];
  availability: AvailabilityFilter;
  /** Empty means "any week". */
  selectedWeeks: number[];
  /** Full day names, e.g. ["Monday"]. Empty means "any day". */
  selectedDays: string[];
  timeOfDay: TimeOfDay;
  showFavoritesOnly: boolean;
  favoriteIds: Set<string>;
}

export const EMPTY_CLASS_FILTERS: ClassFilterOptions = {
  searchTerm: '',
  selectedSubjects: [],
  availability: 'all',
  selectedWeeks: [],
  selectedDays: [],
  timeOfDay: 'all',
  showFavoritesOnly: false,
  favoriteIds: new Set(),
};

export const DAYS_OF_WEEK = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const;

export const TIME_OF_DAY_LABELS: Record<Exclude<TimeOfDay, 'all'>, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

/**
 * Which part of the day a session starts in: morning before noon, afternoon
 * to 5pm, evening after.
 *
 * Reads the hour straight out of the stored string. Session times are naive
 * Institution-local ("2026-08-26 16:30:00"), so the hour is already the hour
 * a person standing at Chautauqua would read — parsing to a Date and asking
 * for its local hour would reintroduce the viewer's timezone, which is the
 * bug the feed's date convention exists to avoid.
 */
export function getTimeBucket(startDate: string): Exclude<TimeOfDay, 'all'> {
  const hour = Number(startDate.slice(11, 13));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** Whether one session satisfies every active filter. */
export function sessionMatches(
  classId: string,
  session: ClassSession,
  options: ClassFilterOptions,
): boolean {
  if (options.availability !== 'all' && session.availability !== options.availability) return false;
  if (options.selectedWeeks.length > 0 && !options.selectedWeeks.includes(session.week)) return false;
  if (
    options.selectedDays.length > 0 &&
    !session.daysOfWeek.some((day) => options.selectedDays.includes(day))
  ) return false;
  if (options.timeOfDay !== 'all' && getTimeBucket(session.startDate) !== options.timeOfDay) return false;
  if (
    options.showFavoritesOnly &&
    !options.favoriteIds.has(classSessionKey(classId, session.performanceId))
  ) return false;
  return true;
}

/** Whether any filter that applies to a *session* is active. */
export function hasSessionFilters(options: ClassFilterOptions): boolean {
  return (
    options.availability !== 'all' ||
    options.selectedWeeks.length > 0 ||
    options.selectedDays.length > 0 ||
    options.timeOfDay !== 'all' ||
    options.showFavoritesOnly
  );
}

/** Title or instructor, case-insensitive. Both are what people search by. */
export function matchesSearch(chqClass: ChqClass, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return (
    chqClass.title.toLowerCase().includes(needle) ||
    chqClass.instructor.toLowerCase().includes(needle)
  );
}

/**
 * Classes with at least one session satisfying every active filter.
 *
 * Note this is not the shape `filterEvents` uses on the calendar. That one
 * chains an independent `.filter()` per dimension, which is sound there
 * because an event has exactly one date and one time — narrowing by day and
 * then by hour cannot produce a match that no single event satisfies. A class
 * has several sessions, so the conjunction has to be resolved per session
 * before `.some()` collapses it: otherwise "Monday" plus "evening" would
 * match a class with a Monday morning session and a Thursday evening one,
 * which has no Monday evening to offer.
 */
export function filterClasses(classes: ChqClass[], options: ClassFilterOptions): ChqClass[] {
  const term = options.searchTerm.trim();
  const subjects = options.selectedSubjects;
  // Only require a matching session when a session-level filter is actually
  // set. A class whose sessions have all passed has none to match, so an
  // unconditional `.some()` would drop every finished class the moment
  // someone typed a search term.
  const bySession = hasSessionFilters(options);
  return classes.filter((c) => {
    if (!matchesSearch(c, term)) return false;
    // Subject is a property of the class, not of a session, so it joins the
    // search rather than the per-session conjunction.
    if (subjects.length > 0 && !c.subjects.some((s) => subjects.includes(s))) return false;
    if (bySession && !c.sessions.some((s) => sessionMatches(c.id, s, options))) return false;
    return true;
  });
}

/** True when anything at all is being filtered. */
export function hasActiveFilters(options: ClassFilterOptions): boolean {
  return (
    options.searchTerm.trim().length > 0 ||
    options.selectedSubjects.length > 0 ||
    hasSessionFilters(options)
  );
}

/** How many filters are set, for the collapsed panel's summary. */
export function activeFilterCount(options: ClassFilterOptions): number {
  return (
    (options.searchTerm.trim() ? 1 : 0) +
    options.selectedSubjects.length +
    (options.availability === 'all' ? 0 : 1) +
    options.selectedWeeks.length +
    options.selectedDays.length +
    (options.timeOfDay === 'all' ? 0 : 1) +
    (options.showFavoritesOnly ? 1 : 0)
  );
}

/** The weeks that actually have sessions, so the picker offers only real ones. */
export function availableWeeks(classes: ChqClass[]): number[] {
  const weeks = new Set<number>();
  for (const c of classes) for (const s of c.sessions) weeks.add(s.week);
  return [...weeks].sort((a, b) => a - b);
}

/** Subjects present in the catalog, commonest first, then alphabetical. */
export function availableSubjects(classes: ChqClass[]): string[] {
  const counts = new Map<string, number>();
  for (const c of classes) {
    for (const s of c.subjects) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** The days that actually have sessions, in week order. */
export function availableDays(classes: ChqClass[]): string[] {
  const days = new Set<string>();
  for (const c of classes) for (const s of c.sessions) for (const d of s.daysOfWeek) days.add(d);
  return DAYS_OF_WEEK.filter((d) => days.has(d));
}
