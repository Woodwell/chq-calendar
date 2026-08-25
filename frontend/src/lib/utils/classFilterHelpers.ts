import type { ChqClass, ClassSession, ScheduledWeek } from '@/lib/classTypes';
import { classSessionKey } from '@/lib/classTypes';

export type AvailabilityFilter = 'all' | 'open' | 'waitlist';
export type TimeOfDay = 'all' | 'morning' | 'afternoon' | 'evening';

export interface ClassFilterOptions {
  /** Matched against the class title and instructor, not its sessions. */
  searchTerm: string;
  /** Category names; empty means "any". A class matches if it has any of them. */
  selectedCategories: string[];
  availability: AvailabilityFilter;
  /** Empty means "any week". */
  selectedWeeks: number[];
  /** Full day names, e.g. ["Monday"]. Empty means "any day". */
  selectedDays: string[];
  /**
   * How many days a week the class meets, 1-5. Empty means "any".
   *
   * Distinct from selectedDays: that asks *which* days, this asks *how many*
   * — the difference between "free on Tuesdays" and "only want a one-off".
   */
  meetingDays: number[];
  timeOfDay: TimeOfDay;
  showFavoritesOnly: boolean;
  favoriteIds: Set<string>;
}

export const EMPTY_CLASS_FILTERS: ClassFilterOptions = {
  searchTerm: '',
  selectedCategories: [],
  availability: 'all',
  selectedWeeks: [],
  selectedDays: [],
  meetingDays: [],
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
  if (
    options.meetingDays.length > 0 &&
    !options.meetingDays.includes(session.daysOfWeek.length)
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
  return options.selectedWeeks.length > 0 || hasNonWeekSessionFilters(options);
}

/**
 * Session filters other than week.
 *
 * Week is separated out because it is the one session property the catalog
 * also knows, so it can still be answered for a class whose sessions are
 * gone. Availability, day, time and favourites cannot: they are facts about
 * a specific session, and a class with none has no answer to give.
 */
export function hasNonWeekSessionFilters(options: ClassFilterOptions): boolean {
  return (
    options.availability !== 'all' ||
    options.selectedDays.length > 0 ||
    options.meetingDays.length > 0 ||
    options.timeOfDay !== 'all' ||
    options.showFavoritesOnly
  );
}

/**
 * The weeks a class is scheduled for.
 *
 * Falls back to the weeks its sessions cover when `weeks` is absent, which
 * happens with a catalog file published before the field existed — those sit
 * in CDN and browser caches for a while after a deploy, and a page that
 * throws on one is worse than a page that offers slightly fewer weeks.
 */
export function weeksOf(chqClass: ChqClass): number[] {
  if (Array.isArray(chqClass.weeks)) return chqClass.weeks;
  return [...new Set((chqClass.sessions ?? []).map((s) => s.week))].sort((a, b) => a - b);
}

/**
 * The hour from a printed time like "9:00 AM" or "12:30 PM", 0-23.
 *
 * The catalog prints a clock face where the crawl gives an ISO datetime, so
 * this is what lets a week already past answer a time-of-day question at all.
 * Returns null for anything it does not recognise rather than guessing an
 * hour, since a wrong bucket is worse than no bucket.
 */
export function parsePrintedHour(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(label.trim());
  if (!m) return null;
  const hour = Number(m[1]) % 12;
  return /pm/i.test(m[3]) ? hour + 12 : hour;
}

/** The same buckets as `getTimeBucket`, read off the catalog's printed time. */
export function scheduledTimeBucket(scheduled: ScheduledWeek): Exclude<TimeOfDay, 'all'> | null {
  const hour = parsePrintedHour(scheduled.startTime);
  if (hour === null) return null;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Filters no source but the crawl can answer.
 *
 * Availability and favourites are facts about a specific session: how full a
 * class was is something only a crawl could have seen, and a favourite is
 * keyed on a session id the catalog does not have. A week already past has
 * neither, so asking for them is asking for nothing.
 */
export function hasCrawlOnlyFilters(options: ClassFilterOptions): boolean {
  return options.availability !== 'all' || options.showFavoritesOnly;
}

/**
 * Whether a week the catalog printed satisfies every filter that can be
 * judged without a session.
 *
 * Day, time of day and how many days a week the class meets are all printed
 * in the catalog, so a finished week can answer them exactly as a live
 * session would.
 */
export function scheduledMatches(scheduled: ScheduledWeek, options: ClassFilterOptions): boolean {
  if (options.selectedWeeks.length > 0 && !options.selectedWeeks.includes(scheduled.week)) return false;
  if (
    options.selectedDays.length > 0 &&
    !scheduled.daysOfWeek.some((day) => options.selectedDays.includes(day))
  ) return false;
  if (
    options.meetingDays.length > 0 &&
    !options.meetingDays.includes(scheduled.daysOfWeek.length)
  ) return false;
  if (options.timeOfDay !== 'all') {
    const bucket = scheduledTimeBucket(scheduled);
    // An unreadable printed time cannot claim to be in any bucket.
    if (bucket !== options.timeOfDay) return false;
  }
  return true;
}

/**
 * Whether a session has already finished.
 *
 * The ticket site is slow to drop a session once its week is over — seven
 * were still listed with live spot counts three days after they ran. Trusting
 * the listing alone therefore offers people a Register button for a class
 * that already happened, so the clock gets the final say on what is past.
 *
 * `todayKey` is passed in rather than read here so the caller reads the
 * Institution's date once, and so tests are not at the mercy of the clock.
 */
export function isSessionOver(session: ClassSession, todayKey: string): boolean {
  return session.endDate.slice(0, 10) < todayKey;
}

/** Sessions that have not finished yet — what "still running" actually means. */
export function upcomingSessions(chqClass: ChqClass, todayKey: string): ClassSession[] {
  return chqClass.sessions.filter((s) => !isSessionOver(s, todayKey));
}

/** Whether the class is scheduled in any of the weeks asked for. */
export function matchesWeeks(chqClass: ChqClass, selectedWeeks: number[]): boolean {
  if (selectedWeeks.length === 0) return true;
  return weeksOf(chqClass).some((w) => selectedWeeks.includes(w));
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
  const categories = options.selectedCategories;
  // Only require a matching session when a session-level filter is actually
  // set. A class whose sessions have all passed has none to match, so an
  // unconditional `.some()` would drop every finished class the moment
  // someone typed a search term.
  const bySession = hasSessionFilters(options);
  return classes.filter((c) => {
    if (!matchesSearch(c, term)) return false;
    // Category is a property of the class, not of a session, so it joins the
    // search rather than the per-session conjunction.
    if (categories.length > 0 && !c.categories.some((k) => categories.includes(k))) return false;
    if (!bySession) return true;

    // With sessions, the conjunction is resolved per session as before, which
    // is what keeps "Monday" and "evening" meaning one Monday evening.
    if (c.sessions.length > 0 && c.sessions.some((s) => sessionMatches(c.id, s, options))) return true;

    // No session in scope, so fall back to the week the catalog printed —
    // which knows the days, the clock times and how many days a week the
    // class met, and can answer all three exactly as a session would.
    //
    // Availability and favourites it cannot answer, and must not appear to:
    // a finished week has no spot count and no session id, so those filters
    // correctly match nothing rather than being waved through.
    if (hasCrawlOnlyFilters(options)) return false;

    const printed = c.scheduledWeeks ?? [];
    if (printed.length > 0) return printed.some((w) => scheduledMatches(w, options));

    // No printed schedule either: a listing the catalog never covered, or a
    // file published before the field existed. The week is then genuinely all
    // that is known, so day, time and meeting length have to fail rather than
    // be answered from nothing.
    if (hasNonWeekSessionFilters(options)) return false;
    return matchesWeeks(c, options.selectedWeeks);
  });
}

/** True when anything at all is being filtered. */
export function hasActiveFilters(options: ClassFilterOptions): boolean {
  return (
    options.searchTerm.trim().length > 0 ||
    options.selectedCategories.length > 0 ||
    hasSessionFilters(options)
  );
}

/** How many filters are set, for the collapsed panel's summary. */
export function activeFilterCount(options: ClassFilterOptions): number {
  return (
    (options.searchTerm.trim() ? 1 : 0) +
    options.selectedCategories.length +
    (options.availability === 'all' ? 0 : 1) +
    options.selectedWeeks.length +
    options.selectedDays.length +
    options.meetingDays.length +
    (options.timeOfDay === 'all' ? 0 : 1) +
    (options.showFavoritesOnly ? 1 : 0)
  );
}

/**
 * Every week the catalog schedules something in, not only those with sessions
 * still to come.
 *
 * Reading this off sessions alone made the picker shrink as the season went
 * on — by late August it offered week 9 and nothing else, so the history now
 * in the data was unreachable.
 */
export function availableWeeks(classes: ChqClass[]): number[] {
  const weeks = new Set<number>();
  for (const c of classes) {
    for (const w of weeksOf(c)) weeks.add(w);
    for (const s of c.sessions) weeks.add(s.week);
  }
  return [...weeks].sort((a, b) => a - b);
}

/** Categories present in the catalog, commonest first, then alphabetical. */
export function availableCategories(classes: ChqClass[]): string[] {
  const counts = new Map<string, number>();
  for (const c of classes) {
    for (const k of c.categories) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/**
 * The meeting lengths present, ascending. Every class in the 2026 catalog
 * met between one and five days a week, but this reads the data rather than
 * assuming that range holds.
 */
export function availableMeetingDays(classes: ChqClass[]): number[] {
  const lengths = new Set<number>();
  for (const c of classes) {
    for (const s of c.sessions) if (s.daysOfWeek.length > 0) lengths.add(s.daysOfWeek.length);
  }
  return [...lengths].sort((a, b) => a - b);
}

/** The days that actually have sessions, in week order. */
export function availableDays(classes: ChqClass[]): string[] {
  const days = new Set<string>();
  for (const c of classes) for (const s of c.sessions) for (const d of s.daysOfWeek) days.add(d);
  return DAYS_OF_WEEK.filter((d) => days.has(d));
}
