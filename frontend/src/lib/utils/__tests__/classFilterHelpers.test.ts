import {
  EMPTY_CLASS_FILTERS,
  availableDays,
  availableWeeks,
  filterClasses,
  getTimeBucket,
  hasActiveFilters,
  sessionMatches,
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

  it('filters to starred sessions by their namespaced key', () => {
    const options = {
      ...EMPTY_CLASS_FILTERS,
      showFavoritesOnly: true,
      favoriteIds: new Set(['class:a:p2']),
    };
    expect(filterClasses(classes, options).map(c => c.id)).toEqual(['a']);
    // The same performance under a different class is a different favorite.
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
