import type { ChqClass, ClassSession, ClassStatus, ScheduledWeek } from '@/lib/classTypes';
import { classWeekKey } from '@/lib/classTypes';

export type AvailabilityFilter = 'all' | 'open' | 'waitlist';
export type TimeOfDay = 'all' | 'morning' | 'afternoon' | 'evening';

export interface ClassFilterOptions {
  /** Matched against the class title and instructor, not its sessions. */
  searchTerm: string;
  /** Category names; empty means "any". A class matches if it has any of them. */
  selectedCategories: string[];
  /** Buildings; a class matches if it uses any of them. */
  selectedVenues: string[];
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
  selectedVenues: [],
  // Neutral: this is the predicate's "nothing is filtered" object, not the
  // page's opening state. The page opens on Open, which useClassFilterState
  // decides — conflating the two makes every caller of filterClasses inherit
  // a UI choice.
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
    !options.favoriteIds.has(classWeekKey(classId, session.week))
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
 * Just availability. How full a class was is something only a crawl could
 * ever have seen, and the printed catalog never knew it — so a finished week
 * has no answer and must not appear to.
 *
 * Favourites used to be here too, back when a star was keyed on the ticket
 * site's session id. It is keyed on the week now, so the printed schedule can
 * answer it perfectly well.
 */
export function hasCrawlOnlyFilters(options: ClassFilterOptions): boolean {
  return options.availability !== 'all';
}

/**
 * Whether a week the catalog printed satisfies every filter that can be
 * judged without a session.
 *
 * Day, time of day and how many days a week the class meets are all printed
 * in the catalog, so a finished week can answer them exactly as a live
 * session would.
 */
export function scheduledMatches(
  classId: string,
  scheduled: ScheduledWeek,
  options: ClassFilterOptions,
): boolean {
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
  if (
    options.showFavoritesOnly &&
    !options.favoriteIds.has(classWeekKey(classId, scheduled.week))
  ) return false;
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
 * Compared as a full local datetime: a session that finished at half past
 * ten this morning is over by lunchtime, and one starting at four this
 * afternoon has not run yet.
 *
 * `nowLocal` is passed in rather than read here so the caller reads the
 * Institution's clock once, and so tests are not at the mercy of it.
 */
export function isSessionOver(session: ClassSession, nowLocal: string): boolean {
  return session.endDate < nowLocal;
}

/**
 * Where a class is in its own life, as of the Institution's today.
 *
 * The page used to sort on a class's earliest session, which put a class that
 * finished on Saturday above one starting tomorrow: an early start date says
 * nothing about whether there is anything left. What a reader wants first is
 * what has not begun, then what is under way, then history.
 */
export type ClassLifecycle = 'upcoming' | 'running' | 'ended';

/**
 * The sessions a class is being judged on.
 *
 * With filters set, only the ones that satisfy them. Asking about week 8 and
 * being told a class is under way — because it also runs in week 9 — is an
 * answer to a question nobody asked.
 */
function sessionsInScope(
  chqClass: ChqClass,
  options?: ClassFilterOptions,
): ClassSession[] {
  if (!options || !hasSessionFilters(options)) return chqClass.sessions;
  return chqClass.sessions.filter((sn) => sessionMatches(chqClass.id, sn, options));
}

export function classLifecycle(
  chqClass: ChqClass,
  nowLocal: string,
  options?: ClassFilterOptions,
): ClassLifecycle {
  // Turns on sessions, not on the printed schedule. Ten classes are listed
  // all season with nothing bookable in any week; those are labelled honestly
  // week by week, but they are not something anyone can start, so they do not
  // belong above the classes that are.
  //
  // With a filter set this is the sessions that pass it, so a class matched
  // only by a printed week the crawl cannot see has none in scope and is
  // finished as far as the question goes.
  const sessions = sessionsInScope(chqClass, options);
  if (sessions.length === 0) return 'ended';

  // Compared as full local datetimes, not day keys. On a date alone a class
  // starting at four in the afternoon reads as under way all morning, and one
  // that finished at half past ten reads as under way until midnight — both
  // of which are wrong at the moment somebody is looking.
  const starts = sessions.map((sn) => sn.startDate).sort();
  const ends = sessions.map((sn) => sn.endDate).sort();
  if (nowLocal < starts[0]) return 'upcoming';
  if (nowLocal > ends[ends.length - 1]) return 'ended';
  return 'running';
}

const LIFECYCLE_ORDER: Record<ClassLifecycle, number> = { upcoming: 0, running: 1, ended: 2 };

/**
 * Not started first, then under way, then over.
 *
 * Within each group the tie-break is the one that group is asked about:
 * what starts soonest, what ends soonest, and — for history — what happened
 * most recently, which is what someone scrolling back is looking for.
 */
export function byLifecycle(nowLocal: string, options?: ClassFilterOptions) {
  // Ordered on the same sessions the counts are taken over, so the sentence
  // above the cards describes the cards below it.
  const firstStart = (c: ChqClass) =>
    sessionsInScope(c, options).reduce<string | null>((min, sn) => (min === null || sn.startDate < min ? sn.startDate : min), null);
  const lastEnd = (c: ChqClass) =>
    sessionsInScope(c, options).reduce<string | null>((max, sn) => (max === null || sn.endDate > max ? sn.endDate : max), null);
  const lastWeek = (c: ChqClass) => (c.weeks ?? []).reduce((m, w) => (w > m ? w : m), 0);

  return (a: ChqClass, b: ChqClass): number => {
    const la = classLifecycle(a, nowLocal, options);
    const lb = classLifecycle(b, nowLocal, options);
    if (la !== lb) return LIFECYCLE_ORDER[la] - LIFECYCLE_ORDER[lb];

    if (la === 'upcoming') {
      const sa = firstStart(a) ?? '';
      const sb = firstStart(b) ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
    } else if (la === 'running') {
      const ea = lastEnd(a) ?? '';
      const eb = lastEnd(b) ?? '';
      if (ea !== eb) return ea < eb ? -1 : 1;
    } else {
      // Most recent history first. Sessions date it exactly where they exist;
      // otherwise the last week the catalog scheduled is the best we have.
      const ea = lastEnd(a);
      const eb = lastEnd(b);
      if (ea && eb && ea !== eb) return ea < eb ? 1 : -1;
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      const wa = lastWeek(a);
      const wb = lastWeek(b);
      if (wa !== wb) return wb - wa;
    }
    return a.title.localeCompare(b.title);
  };
}

/**
 * What to say about a week the catalog printed and the crawl cannot see.
 *
 * Three different things, and calling all of them "Over" was wrong twice.
 * A cancelled class did not finish, it was pulled. A week still ahead has not
 * finished either — the ticket site simply offers nothing to book in it.
 */
export type ScheduledWeekState = 'over' | 'cancelled' | 'unavailable';

export function scheduledWeekState(
  scheduled: ScheduledWeek,
  status: ClassStatus,
  nowLocal: string,
): ScheduledWeekState {
  if (status === 'cancelled') return 'cancelled';
  // Undated weeks cannot be called past. Off-season that is all of them, and
  // "over" would then be a guess dressed as a fact.
  if (scheduled.weekEnd === null) return 'unavailable';
  return scheduled.weekEnd < nowLocal.slice(0, 10) ? 'over' : 'unavailable';
}

/** Sessions that have not finished yet — what "still running" actually means. */
export function upcomingSessions(chqClass: ChqClass, nowLocal: string): ClassSession[] {
  return chqClass.sessions.filter((s) => !isSessionOver(s, nowLocal));
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
  const venues = options.selectedVenues;
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
    // Venue is a property of the class too — a class that moves rooms between
    // weeks still meets in the buildings it meets in.
    if (venues.length > 0 && !(c.venues ?? []).some((v) => venues.includes(v))) return false;
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
    if (printed.length > 0) return printed.some((w) => scheduledMatches(c.id, w, options));

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
    options.selectedVenues.length > 0 ||
    hasSessionFilters(options)
  );
}

/** How many filters are set, for the collapsed panel's summary. */
export function activeFilterCount(options: ClassFilterOptions): number {
  return (
    (options.searchTerm.trim() ? 1 : 0) +
    options.selectedCategories.length +
    options.selectedVenues.length +
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

/** Venues in use, commonest first, then alphabetical. */
export function availableVenues(classes: ChqClass[]): string[] {
  const counts = new Map<string, number>();
  for (const c of classes) {
    for (const v of c.venues ?? []) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => name);
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
