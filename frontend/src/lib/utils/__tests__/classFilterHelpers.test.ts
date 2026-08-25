import {
  EMPTY_CLASS_FILTERS,
  availableMeetingDays,
  availableCategories,
  activeFilterCount,
  hasSessionFilters,
  matchesSearch,
  availableDays,
  availableWeeks,
  filterClasses,
  isSessionOver,
  parsePrintedHour,
  getTimeBucket,
  hasActiveFilters,
  sessionMatches,
  upcomingSessions,
} from '../classFilterHelpers';
import type { ChqClass, ClassSession } from '@/lib/classTypes';

const session = (over: Partial<ClassSession> = {}): ClassSession => ({
  performanceId: 'CHQ.EVN1.PRF1',
  week: 8,
  dateRangeLabel: 'Aug 17 - Aug 21',
  startDate: '2026-08-17 13:00:00',
  endDate: '2026-08-21 15:00:00',
  daysOfWeek: ['Monday'],
  timeRangeLabel: '1:00 pm - 3:00 pm',
  location: 'Pier Building Classroom',
  spotsRemaining: 12,
  availability: 'open',
  ...over,
});

const chqClass = (id: string, sessions: ClassSession[]): ChqClass => ({
  id,
  title: id,
  catalogId: null,
  weeks: [8],
  scheduledWeeks: [],
  venues: [],
  materials: null,
  fee: null,
  room: null,
  provenance: { catalog: false, lastObserved: '2026-08-22', status: 'listed' },
  weeksLabel: 'Week 8',
  daysLabel: 'M',
  location: 'Pier Building Classroom',
  ageRangeText: 'Ages 14+',
  ageRange: { min: 14, max: null },
  instructor: 'Someone',
  priceLabel: 'Sessions: $145.00',
  summary: '',
  sessionCount: sessions.length,
  sourceUrl: `https://tickets.chq.org/class.html?eventAk=${id}`,
  categories: [],
  description: '',
  timezone: 'America/New_York',
  sessions,
});

describe('getTimeBucket', () => {
  it.each([
    ['2026-08-17 07:30:00', 'morning'],
    ['2026-08-17 11:59:00', 'morning'],
    ['2026-08-17 12:00:00', 'afternoon'],
    ['2026-08-17 16:59:00', 'afternoon'],
    ['2026-08-17 17:00:00', 'evening'],
    ['2026-08-17 20:15:00', 'evening'],
  ])('%s is %s', (start, expected) => {
    expect(getTimeBucket(start)).toBe(expected);
  });

  it('reads the hour as written, without the viewer timezone touching it', () => {
    // Session times are naive Institution-local. Going through Date would
    // make this answer depend on where the reader happens to be sitting.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Australia/Sydney';
      expect(getTimeBucket('2026-08-17 09:00:00')).toBe('morning');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('filterClasses', () => {
  const open8Mon = session({ performanceId: 'p1', week: 8, daysOfWeek: ['Monday'], availability: 'open' });
  const waitlist9Fri = session({
    performanceId: 'p2', week: 9, daysOfWeek: ['Friday'],
    availability: 'waitlist', spotsRemaining: null, startDate: '2026-08-28 19:00:00',
  });
  const classes = [chqClass('a', [open8Mon, waitlist9Fri]), chqClass('b', [waitlist9Fri])];

  it('keeps everything when nothing is filtered', () => {
    expect(filterClasses(classes, EMPTY_CLASS_FILTERS)).toHaveLength(2);
    expect(hasActiveFilters(EMPTY_CLASS_FILTERS)).toBe(false);
  });

  it('keeps a class when any one of its sessions matches', () => {
    const open = filterClasses(classes, { ...EMPTY_CLASS_FILTERS, availability: 'open' });
    expect(open.map(c => c.id)).toEqual(['a']);
  });

  it('matches on week and on day', () => {
    expect(filterClasses(classes, { ...EMPTY_CLASS_FILTERS, selectedWeeks: [9] }).map(c => c.id))
      .toEqual(['a', 'b']);
    expect(filterClasses(classes, { ...EMPTY_CLASS_FILTERS, selectedDays: ['Monday'] }).map(c => c.id))
      .toEqual(['a']);
  });

  describe('a finished week, answered from the printed schedule', () => {
    const printed = (over = {}) => ({
      week: 2, daysOfWeek: ['Monday', 'Wednesday'],
      startTime: '9:00 AM', endTime: '10:15 AM',
      location: 'Hultquist', room: '101', weekStart: null, weekEnd: null, ...over,
    });
    const past = (over = {}) => {
      const c = chqClass('past', []);
      c.weeks = [2];
      c.scheduledWeeks = [printed(over)];
      return c;
    };
    const pick = (c: ChqClass, f: Partial<typeof EMPTY_CLASS_FILTERS>) =>
      filterClasses([c], { ...EMPTY_CLASS_FILTERS, selectedWeeks: [2], ...f }).length;

    it('answers the day filter', () => {
      expect(pick(past(), { selectedDays: ['Monday'] })).toBe(1);
      expect(pick(past(), { selectedDays: ['Tuesday'] })).toBe(0);
    });

    it('answers how many days a week it met', () => {
      expect(pick(past(), { meetingDays: [2] })).toBe(1);
      expect(pick(past(), { meetingDays: [5] })).toBe(0);
    });

    it('answers time of day from the printed clock time', () => {
      expect(pick(past(), { timeOfDay: 'morning' })).toBe(1);
      expect(pick(past(), { timeOfDay: 'afternoon' })).toBe(0);
      expect(pick(past({ startTime: '12:30 PM' }), { timeOfDay: 'afternoon' })).toBe(1);
      expect(pick(past({ startTime: '7:00 PM' }), { timeOfDay: 'evening' })).toBe(1);
    });

    it('answers the favourites filter, since the star is keyed on the week', () => {
      const c = past();
      const starred = { ...EMPTY_CLASS_FILTERS, selectedWeeks: [2],
        showFavoritesOnly: true, favoriteIds: new Set(['class:past:week2']) };
      expect(filterClasses([c], starred)).toHaveLength(1);
      const other = { ...starred, favoriteIds: new Set(['class:past:week3']) };
      expect(filterClasses([c], other)).toHaveLength(0);
    });

    it('still refuses the questions only a crawl could answer', () => {
      // No spot count ever existed for a finished week, and the catalog
      // never knew one. Favourites are fine — see above.
      expect(pick(past(), { availability: 'open' })).toBe(0);
      expect(pick(past(), { availability: 'waitlist' })).toBe(0);
    });

    it('answers only the week when there is no printed schedule at all', () => {
      // A listing the catalog never covered, or an older published file.
      const bare = chqClass('bare', []);
      bare.weeks = [2];
      bare.scheduledWeeks = [];
      expect(pick(bare, {})).toBe(1);
      // Nothing knows its days or times, so those must not appear answerable.
      expect(pick(bare, { selectedDays: ['Monday'] })).toBe(0);
      expect(pick(bare, { timeOfDay: 'morning' })).toBe(0);
    });

    it('will not bucket a printed time it cannot read', () => {
      expect(parsePrintedHour('9:00 AM')).toBe(9);
      expect(parsePrintedHour('12:30 PM')).toBe(12);
      expect(parsePrintedHour('12:15 AM')).toBe(0);
      expect(parsePrintedHour('noon')).toBeNull();
      // Unreadable means it belongs to no bucket, rather than to morning.
      expect(pick(past({ startTime: 'noon' }), { timeOfDay: 'morning' })).toBe(0);
    });
  });

  it('treats a session as over once its end time has passed', () => {
    // The ticket site keeps a session listed for days after it runs, spot
    // count and all. The clock is what settles it.
    const ran = session({ endDate: '2026-08-22 15:00:00' });
    expect(isSessionOver(ran, '2026-08-25 09:00:00')).toBe(true);
    // On the day itself the time decides, not the date: still going at two,
    // over by four.
    expect(isSessionOver(ran, '2026-08-22 14:00:00')).toBe(false);
    expect(isSessionOver(ran, '2026-08-22 16:00:00')).toBe(true);
    expect(isSessionOver(ran, '2026-08-21 23:59:59')).toBe(false);
  });

  it('counts only unfinished sessions as still running', () => {
    const c = chqClass('mixed', [
      session({ week: 8, endDate: '2026-08-21 15:00:00' }),
      session({ week: 9, endDate: '2026-08-28 15:00:00' }),
    ]);
    expect(upcomingSessions(c, '2026-08-25 09:00:00').map(s => s.week)).toEqual([9]);
    // Every session behind us: the class is over, however the site lists it.
    expect(upcomingSessions(c, '2026-09-01 09:00:00')).toEqual([]);
  });

  it('finds a class by a week whose sessions the site has already dropped', () => {
    // The whole point of keeping history: week 3 is long past, so the ticket
    // site lists no session for it, but the printed catalog remembers that
    // this class ran then.
    const past = chqClass('past', []);
    past.weeks = [3];
    expect(filterClasses([past], { ...EMPTY_CLASS_FILTERS, selectedWeeks: [3] }).map(c => c.id))
      .toEqual(['past']);
    expect(filterClasses([past], { ...EMPTY_CLASS_FILTERS, selectedWeeks: [4] })).toEqual([]);
  });

  it('will not answer a session question for a class with no sessions', () => {
    // It ran in week 3 and we know nothing else about it. Asking for week 3
    // *and* Monday morning is a question only a session can answer, so this
    // must drop out rather than be waved through on the week alone.
    const past = chqClass('past', []);
    past.weeks = [3];
    expect(filterClasses([past], {
      ...EMPTY_CLASS_FILTERS, selectedWeeks: [3], selectedDays: ['Monday'],
    })).toEqual([]);
    expect(filterClasses([past], {
      ...EMPTY_CLASS_FILTERS, selectedWeeks: [3], availability: 'open',
    })).toEqual([]);
  });

  it('still resolves week against the session when there is one', () => {
    // A listed class whose catalog schedule spans weeks 3 and 9, but which
    // only has a week 9 session left. Week 3 comes from the schedule; week 9
    // from the session, and pairs precisely with its day.
    const spanning = chqClass('spanning', [session({ week: 9, daysOfWeek: ['Tuesday'] })]);
    spanning.weeks = [3, 9];
    expect(filterClasses([spanning], { ...EMPTY_CLASS_FILTERS, selectedWeeks: [3] }).map(c => c.id))
      .toEqual(['spanning']);
    // Week 9 has a session, so day still has to agree with it.
    expect(filterClasses([spanning], {
      ...EMPTY_CLASS_FILTERS, selectedWeeks: [9], selectedDays: ['Tuesday'],
    }).map(c => c.id)).toEqual(['spanning']);
    expect(filterClasses([spanning], {
      ...EMPTY_CLASS_FILTERS, selectedWeeks: [9], selectedDays: ['Monday'],
    })).toEqual([]);
  });

  it('survives a catalog published before weeks existed', () => {
    // Old files sit in CDN and browser caches for a while after a deploy.
    // Falling back to the session weeks costs a little history; throwing
    // would cost the whole page.
    const legacy = chqClass('legacy', [session({ week: 9 })]);
    delete (legacy as Partial<ChqClass>).weeks;

    expect(availableWeeks([legacy])).toEqual([9]);
    expect(filterClasses([legacy], { ...EMPTY_CLASS_FILTERS, selectedWeeks: [9] }).map(c => c.id))
      .toEqual(['legacy']);
    expect(filterClasses([legacy], { ...EMPTY_CLASS_FILTERS, selectedWeeks: [3] })).toEqual([]);
  });

  it('offers every scheduled week, not only those with sessions left', () => {
    const finished = chqClass('finished', []);
    finished.weeks = [1, 2];
    const running = chqClass('running', [session({ week: 9 })]);
    running.weeks = [9];
    expect(availableWeeks([finished, running])).toEqual([1, 2, 9]);
  });

  it('requires one session to satisfy every filter at once', () => {
    // The reason this cannot be a chain of per-dimension filters, the way the
    // calendar's filterEvents is: this class has a Monday session and an
    // evening session, but no Monday evening. Narrowing by day and then by
    // time would keep it; asking each session to satisfy both drops it.
    const mondayMorning = session({ performanceId: 'm', daysOfWeek: ['Monday'], startDate: '2026-08-17 09:00:00' });
    const thursdayEvening = session({ performanceId: 't', daysOfWeek: ['Thursday'], startDate: '2026-08-20 19:00:00' });
    const trap = [chqClass('trap', [mondayMorning, thursdayEvening])];

    expect(filterClasses(trap, { ...EMPTY_CLASS_FILTERS, selectedDays: ['Monday'] })).toHaveLength(1);
    expect(filterClasses(trap, { ...EMPTY_CLASS_FILTERS, timeOfDay: 'evening' })).toHaveLength(1);
    expect(filterClasses(trap, {
      ...EMPTY_CLASS_FILTERS, selectedDays: ['Monday'], timeOfDay: 'evening',
    })).toHaveLength(0);
  });

  it('filters to starred weeks by their namespaced key', () => {
    const options = {
      ...EMPTY_CLASS_FILTERS,
      showFavoritesOnly: true,
      // Keyed on the week, so the star outlives the session the ticket site
      // drops the moment that week ends.
      favoriteIds: new Set(['class:a:week9']),
    };
    expect(filterClasses(classes, options).map(c => c.id)).toEqual(['a']);
    // The same week under a different class is a different favorite.
    expect(sessionMatches('b', waitlist9Fri, options)).toBe(false);
  });
});

describe('the pickers offer only what exists', () => {
  it('lists the weeks and days that still have sessions', () => {
    // Sessions vanish once their week passes, so late in the season most
    // weeks are gone; offering buttons that match nothing is worse than none.
    const classes = [
      chqClass('a', [session({ week: 8, daysOfWeek: ['Monday', 'Friday'] })]),
      chqClass('b', [session({ week: 9, daysOfWeek: ['Wednesday'] })]),
      chqClass('c', []),
    ];
    expect(availableWeeks(classes)).toEqual([8, 9]);
    expect(availableDays(classes)).toEqual(['Monday', 'Wednesday', 'Friday']);
  });
});

describe('search', () => {
  const c = chqClass('a', [session()]);
  c.title = 'Watercolors for Beginners';
  c.instructor = 'Kim Kloecker';

  it('matches the title or the instructor, either case', () => {
    expect(matchesSearch(c, 'watercolor')).toBe(true);
    expect(matchesSearch(c, 'KLOECKER')).toBe(true);
    expect(matchesSearch(c, 'pottery')).toBe(false);
    expect(matchesSearch(c, '')).toBe(true);
  });

  it('finds a finished class, which has no session to match', () => {
    // Search is about the class, not its sessions. Requiring a matching
    // session would make finished classes unsearchable even when the reader
    // has asked to see them.
    const finished = chqClass('done', []);
    finished.title = 'Watercolors for Beginners';
    const found = filterClasses([finished], { ...EMPTY_CLASS_FILTERS, searchTerm: 'watercolor' });
    expect(found).toHaveLength(1);
  });

  it('combines with the session filters', () => {
    const open = chqClass('open', [session({ availability: 'open' })]);
    open.title = 'Watercolors for Beginners';
    const full = chqClass('full', [session({ availability: 'waitlist', spotsRemaining: null })]);
    full.title = 'Watercolors Advanced';

    const options = { ...EMPTY_CLASS_FILTERS, searchTerm: 'watercolors', availability: 'open' as const };
    expect(filterClasses([open, full], options).map(x => x.id)).toEqual(['open']);
  });
});

describe('activeFilterCount', () => {
  it('counts every selection, so the collapsed panel can say how many', () => {
    expect(activeFilterCount(EMPTY_CLASS_FILTERS)).toBe(0);
    expect(activeFilterCount({
      ...EMPTY_CLASS_FILTERS,
      searchTerm: 'yoga',
      availability: 'open',
      selectedWeeks: [8, 9],
      timeOfDay: 'morning',
    })).toBe(5);
  });

  it('separates search from the session filters', () => {
    // Search alone must not make the page think a session filter is on, or
    // finished classes would vanish the moment someone typed.
    const searching = { ...EMPTY_CLASS_FILTERS, searchTerm: 'yoga' };
    expect(hasSessionFilters(searching)).toBe(false);
    expect(hasActiveFilters(searching)).toBe(true);
  });
});

describe('categories', () => {
  const art = chqClass('art', [session()]);
  art.categories = ['Art', 'Youth'];
  const music = chqClass('music', [session()]);
  music.categories = ['Music'];
  const none = chqClass('none', [session()]);
  none.categories = [];

  it('matches a class carrying any of the chosen categories', () => {
    // A class belongs to several categories at once, so this is an "any of"
    // rather than the per-session "all of" the pickers use.
    const pick = (picked: string[]) =>
      filterClasses([art, music, none], { ...EMPTY_CLASS_FILTERS, selectedCategories: picked })
        .map(c => c.id);

    expect(pick(['Art'])).toEqual(['art']);
    expect(pick(['Youth'])).toEqual(['art']);
    expect(pick(['Art', 'Music'])).toEqual(['art', 'music']);
    expect(pick(['Dance'])).toEqual([]);
  });

  it('excludes a class with no category when a category is chosen', () => {
    // A class the printed catalog does not cover carries no category at all;
    // it simply is not an Art class, so asking for Art must not turn it up.
    const found = filterClasses([none], { ...EMPTY_CLASS_FILTERS, selectedCategories: ['Art'] });
    expect(found).toEqual([]);
  });

  it('is a class-level filter, so it does not require a matching session', () => {
    const finished = chqClass('finished', []);
    finished.categories = ['Art'];
    expect(filterClasses([finished], { ...EMPTY_CLASS_FILTERS, selectedCategories: ['Art'] }))
      .toHaveLength(1);
  });

  it('lists the subjects present, commonest first', () => {
    expect(availableCategories([art, music, none])).toEqual(['Art', 'Music', 'Youth']);
  });
});

describe('how many days a class meets', () => {
  const oneOff = chqClass('oneoff', [session({ daysOfWeek: ['Friday'] })]);
  const threeDay = chqClass('three', [session({ daysOfWeek: ['Monday', 'Wednesday', 'Friday'] })]);
  const fullWeek = chqClass('five', [session({
    daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  })]);
  const all = [oneOff, threeDay, fullWeek];

  it('selects on the count, not on which days', () => {
    const pick = (n: number[]) =>
      filterClasses(all, { ...EMPTY_CLASS_FILTERS, meetingDays: n }).map(c => c.id);

    expect(pick([1])).toEqual(['oneoff']);
    expect(pick([3])).toEqual(['three']);
    expect(pick([1, 5])).toEqual(['oneoff', 'five']);
    expect(pick([])).toEqual(['oneoff', 'three', 'five']);
  });

  it('is independent of the day-of-week filter', () => {
    // "Meets 1 day" and "meets on Friday" are different questions: the
    // three-day class also meets on Friday, but is not a one-off.
    const friday = { ...EMPTY_CLASS_FILTERS, selectedDays: ['Friday'] };
    expect(filterClasses(all, friday).map(c => c.id)).toEqual(['oneoff', 'three', 'five']);
    expect(filterClasses(all, { ...friday, meetingDays: [1] }).map(c => c.id)).toEqual(['oneoff']);
  });

  it('has to hold within one session, not across a class', () => {
    // A class offering a one-off in Week 8 and a full week in Week 9 is a
    // one-off only if you take the Week 8 session.
    const mixed = chqClass('mixed', [
      session({ performanceId: 'a', week: 8, daysOfWeek: ['Friday'] }),
      session({ performanceId: 'b', week: 9, daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }),
    ]);
    expect(filterClasses([mixed], { ...EMPTY_CLASS_FILTERS, meetingDays: [1] })).toHaveLength(1);
    expect(filterClasses([mixed], {
      ...EMPTY_CLASS_FILTERS, meetingDays: [1], selectedWeeks: [9],
    })).toHaveLength(0);
  });

  it('offers only the lengths that exist', () => {
    expect(availableMeetingDays(all)).toEqual([1, 3, 5]);
    expect(availableMeetingDays([chqClass('none', [])])).toEqual([]);
  });

  it('counts toward the active filter total', () => {
    expect(activeFilterCount({ ...EMPTY_CLASS_FILTERS, meetingDays: [1, 2] })).toBe(2);
    expect(hasActiveFilters({ ...EMPTY_CLASS_FILTERS, meetingDays: [1] })).toBe(true);
  });
});
