import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import ClassesPage, { describeAge } from '../page';
import { byLifecycle } from '@/lib/utils/classFilterHelpers';
import type { ChqClass } from '@/lib/classTypes';

const useClassData = vi.fn();
vi.mock('@/hooks/useClassData', () => ({ useClassData: (year: number) => useClassData(year) }));

// The banner is compiled out of a normal build, so it is switched here.
const demoState = { isDemoBuild: false };
vi.mock('@/lib/demoMode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/demoMode')>('@/lib/demoMode');
  return {
    ...actual,
    get isDemoBuild() { return demoState.isDemoBuild; },
    buildInfo: { version: 'abc1234', builtAt: '2026-08-21T14:32:00Z' },
  };
});

const makeClass = (over: Partial<ChqClass> = {}): ChqClass => ({
  id: 'CHQ.EVN1',
  title: 'Watercolors for Beginners',
  catalogId: null,
  weeks: [8],
  scheduledWeeks: [],
  venues: [],
  materials: null,
  fee: null,
  room: null,
  provenance: { catalog: false, lastObserved: '2026-08-22', status: 'listed' },
  weeksLabel: 'Week 8',
  daysLabel: 'M, Tu, W, Th, F',
  location: 'Pier Building Classroom',
  ageRangeText: 'Ages 14+',
  ageRange: { min: 14, max: null },
  instructor: 'Kim Kloecker',
  priceLabel: 'Sessions: $145.00',
  summary: 'Watercolor.',
  sessionCount: 1,
  sourceUrl: 'https://tickets.chq.org/class.html?eventAk=CHQ.EVN1',
  categories: ['Art'],
  description: 'An introduction.\nMaterials:\n• Sketchbook',
  timezone: 'America/New_York',
  sessions: [{
    performanceId: 'CHQ.EVN1.PRF1',
    week: 8,
    dateRangeLabel: 'Aug 17 - Aug 21',
    startDate: '2026-08-17 13:00:00',
    endDate: '2026-08-21 15:00:00',
    daysOfWeek: ['Monday', 'Friday'],
    timeRangeLabel: '1:00 pm - 3:00 pm',
    location: 'Pier Building Classroom',
    spotsRemaining: 12,
    availability: 'open',
  }],
  ...over,
});

const loaded = (classes: ChqClass[]) => ({
  classes, generatedAt: new Date().toISOString(), loading: false, error: null,
});

/**
 * Mid-week 8, while the fixture's Aug 17-21 session is running.
 *
 * Pinned because the page asks the clock whether a session is over — the
 * ticket site keeps one listed for days after it runs, so the date decides.
 * Left to the real clock these tests would pass until late August and then
 * quietly invert.
 */
const NOW = new Date('2026-08-18T12:00:00Z');

beforeEach(() => {
  // shouldAdvanceTime keeps testing-library's async queries working; without
  // it findBy* waits on timers that never fire.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  localStorage.clear();
  demoState.isDemoBuild = false;
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The pickers are behind a toggle, and the suite's matchMedia stub reports
 * `matches: false`, so every test sees the narrow-screen default: collapsed.
 */
async function openFilters() {
  fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
}

/** Finished weeks fold away on a card; this opens the first card's fold. */
async function showFinishedWeeks() {
  fireEvent.click(await screen.findByRole('button', { name: /Show \d+ finished week/ }));
}

describe('byLifecycle', () => {
  const NOW_LOCAL = '2026-08-25 09:00:00';
  const withSession = (id: string, start: string, end: string, over = {}) => makeClass({
    id, title: id, ...over,
    sessions: [{ ...makeClass().sessions[0], startDate: start, endDate: end }],
  });

  it('puts what has not started above what is under way, and history last', () => {
    const notStarted = withSession('a', '2026-08-28 13:00:00', '2026-08-28 15:00:00');
    const underWay = withSession('b', '2026-08-24 13:00:00', '2026-08-28 15:00:00');
    // Ran on Saturday and is over, but the ticket site still lists it. Sorting
    // on its start date alone used to float it to the very top of the page.
    const finishedButListed = withSession('c', '2026-08-22 13:00:00', '2026-08-22 15:00:00');
    const noSessionsLeft = makeClass({ id: 'd', title: 'd', sessions: [] });

    expect([finishedButListed, noSessionsLeft, underWay, notStarted]
      .sort(byLifecycle(NOW_LOCAL)).map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reads the time of day, not just the date', () => {
    // Two classes on the same day. On dates alone they are indistinguishable;
    // which is over and which is still to come depends on the hour.
    const thisAfternoon = withSession('afternoon', '2026-08-25 16:00:00', '2026-08-25 18:00:00');
    const thisMorning = withSession('morning', '2026-08-25 09:30:00', '2026-08-25 10:30:00');

    // Before either: both to come, soonest first.
    expect(byLifecycle('2026-08-25 08:00:00')(thisMorning, thisAfternoon)).toBeLessThan(0);
    // Late morning: the morning class is over, the afternoon one is not.
    expect(byLifecycle('2026-08-25 11:00:00')(thisAfternoon, thisMorning)).toBeLessThan(0);
    // Mid-afternoon: the afternoon class is under way, still above history.
    expect(byLifecycle('2026-08-25 17:00:00')(thisAfternoon, thisMorning)).toBeLessThan(0);
    // After both: the more recent finish leads the history.
    expect(byLifecycle('2026-08-25 23:00:00')(thisAfternoon, thisMorning)).toBeLessThan(0);
  });

  it('orders what has not started by what starts soonest', () => {
    const later = withSession('later', '2026-08-30 13:00:00', '2026-08-30 15:00:00');
    const sooner = withSession('sooner', '2026-08-26 13:00:00', '2026-08-26 15:00:00');
    expect([later, sooner].sort(byLifecycle(NOW_LOCAL)).map(c => c.id)).toEqual(['sooner', 'later']);
  });

  it('orders history most recent first', () => {
    const old = withSession('old', '2026-07-01 13:00:00', '2026-07-05 15:00:00');
    const recent = withSession('recent', '2026-08-17 13:00:00', '2026-08-21 15:00:00');
    expect([old, recent].sort(byLifecycle(NOW_LOCAL)).map(c => c.id)).toEqual(['recent', 'old']);
  });

  it('dates history by the last week when there are no sessions to date it', () => {
    const week2 = makeClass({ id: 'w2', title: 'w2', sessions: [], weeks: [2] });
    const week7 = makeClass({ id: 'w7', title: 'w7', sessions: [], weeks: [7] });
    expect([week2, week7].sort(byLifecycle(NOW_LOCAL)).map(c => c.id)).toEqual(['w7', 'w2']);
  });
});

describe('describeAge', () => {
  it.each([
    [30_000, 'just now'],
    [60_000, '1 minute ago'],
    [15 * 60_000, '15 minutes ago'],
    [2 * 3_600_000, '2 hours ago'],
    [3 * 86_400_000, '3 days ago'],
  ])('%i ms ago reads as %s', (ms, expected) => {
    const now = Date.parse('2026-08-20T12:00:00Z');
    expect(describeAge(new Date(now - ms).toISOString(), now)).toBe(expected);
  });
});

describe('ClassesPage', () => {
  it('shows each class with its session and availability', async () => {
    useClassData.mockReturnValue(loaded([makeClass()]));
    render(<ClassesPage />);

    expect(await screen.findByText('Watercolors for Beginners')).toBeInTheDocument();
    expect(screen.getByText(/Kim Kloecker/)).toBeInTheDocument();
    expect(screen.getByText('12 spots left')).toBeInTheDocument();
    expect(screen.getByText(/Week 8/)).toBeInTheDocument();
  });

  it('marks a catalog class the crawl never saw, and offers no dead link', async () => {
    // Published as history: it carries the richest description in the
    // dataset, and withholding it would discard the only record of a class
    // the ticket site has already dropped.
    useClassData.mockReturnValue(loaded([makeClass({
      id: 'catalog:12', catalogId: '12', title: 'Long Since Finished',
      sourceUrl: '', sessions: [],
      provenance: { catalog: true, lastObserved: null, status: 'unobserved' },
    })]));
    render(<ClassesPage />);

    // Hidden with the rest of the finished catalog until asked for.

    expect(await screen.findByText('Not listed online')).toBeInTheDocument();
    // No page to register on, so the title must not be a link to nowhere.
    expect(screen.queryByRole('link', { name: 'Long Since Finished' })).not.toBeInTheDocument();
    expect(screen.getByText('Long Since Finished')).toBeInTheDocument();
  });

  it('says cancelled only when the crawl could actually tell', async () => {
    useClassData.mockReturnValue(loaded([makeClass({
      id: 'catalog:13', catalogId: '13', title: 'Pulled From The Schedule',
      sourceUrl: '', sessions: [],
      provenance: { catalog: true, lastObserved: '2026-08-13', status: 'cancelled' },
    })]));
    render(<ClassesPage />);
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Not listed online')).not.toBeInTheDocument();
  });

  it('sends people to the ticket site to register', async () => {
    useClassData.mockReturnValue(loaded([makeClass()]));
    render(<ClassesPage />);

    const register = await screen.findByRole('link', { name: 'Register' });
    expect(register).toHaveAttribute('href', 'https://tickets.chq.org/class.html?eventAk=CHQ.EVN1');
    // Registration happens off-site, so the link must leave safely.
    expect(register).toHaveAttribute('target', '_blank');
    expect(register).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('reads a full session as a waitlist rather than a count', async () => {
    useClassData.mockReturnValue(loaded([makeClass({
      sessions: [{ ...makeClass().sessions[0], availability: 'waitlist', spotsRemaining: null }],
    })]));
    render(<ClassesPage />);

    // Scoped to the badge: "Waitlist" is also the name of a filter button.
    expect(await screen.findByText('Waitlist', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText(/spots left/)).not.toBeInTheDocument();
  });

  it('lists a class whose weeks have all passed, from the printed schedule', async () => {
    useClassData.mockReturnValue(loaded([makeClass(), makeClass({
      id: 'CHQ.EVN9', title: 'Finished Class', sessions: [], weeks: [2],
      scheduledWeeks: [{
        week: 2, daysOfWeek: ['Monday', 'Wednesday'],
        startTime: '9:00 AM', endTime: '10:15 AM',
        location: 'Hultquist', room: '101',
      }],
    })]));
    render(<ClassesPage />);

    // Shown by default now. The season's history is the point of the page
    // off-season, and Spots is the control for narrowing to what is joinable.
    expect(await screen.findByText('Finished Class')).toBeInTheDocument();
    // Every week of it is finished, so its rows start folded away.
    await showFinishedWeeks();
    // The ticket site dropped the week 2 session, so the card falls back to
    // the schedule the catalog printed rather than going blank.
    expect(screen.getByText('Week 2')).toBeInTheDocument();
    expect(screen.getByText(/Monday, Wednesday · 9:00 AM - 10:15 AM · 📍 Hultquist 101/))
      .toBeInTheDocument();
    // No spot count and no register link for a week that is over.
    expect(screen.getByText('Over')).toBeInTheDocument();
  });

  it('answers a week filter with that week and anything still joinable', async () => {
    // A class running all season would otherwise reply to "week 2?" with
    // seven rows about weeks nobody asked about.
    useClassData.mockReturnValue(loaded([makeClass({
      title: 'Runs All Season',
      weeks: [2, 3, 4, 8],
      scheduledWeeks: [2, 3, 4].map((week) => ({
        week, daysOfWeek: ['Monday'], startTime: '9:00 AM', endTime: '10:00 AM',
        location: 'Hultquist', room: '101',
      })),
    })]));
    render(<ClassesPage />);
    await openFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Week 2' }));

    await showFinishedWeeks();
    await waitFor(() => expect(screen.getByText('Week 2')).toBeInTheDocument());
    // Weeks 3 and 4 are finished and were not asked about.
    expect(screen.queryByText('Week 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Week 4')).not.toBeInTheDocument();
    // Week 8 still has a live session, which is the other half of the question.
    expect(screen.getByText(/Week 8/)).toBeInTheDocument();
    expect(screen.getByText('12 spots left')).toBeInTheDocument();
  });

  it('stars a week the ticket site has stopped listing', async () => {
    // A Masters Series masterclass whose week is over: still a real class
    // with a real schedule, and 377 of the catalog look like this in late
    // August. Keying the star on the session id made all of them unstarrable.
    useClassData.mockReturnValue(loaded([makeClass({
      id: 'CHQ.EVN1908', title: 'Masters Series Culinary Masterclass',
      sessions: [], weeks: [8],
      scheduledWeeks: [{
        week: 8, daysOfWeek: ['Thursday'], startTime: '4:00 PM', endTime: '6:00 PM',
        location: 'Athenaeum Hotel', room: '',
      }],
    })]));
    render(<ClassesPage />);

    await showFinishedWeeks();
    fireEvent.click(await screen.findByRole('button', { name: /Add Week 8 to favorites/ }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('chq-classes-favorites') ?? '{}');
      expect(stored.eventIds).toEqual(['class:CHQ.EVN1908:week8']);
    });
  });

  it('keeps a starred week out of the fold', async () => {
    // Folding away a week someone has starred would hide their own mark.
    localStorage.setItem('chq-classes-favorites', JSON.stringify({
      eventIds: ['class:CHQ.EVN9:week2'], lastSaved: Date.now(),
    }));
    useClassData.mockReturnValue(loaded([makeClass({
      id: 'CHQ.EVN9', title: 'Finished Class', sessions: [], weeks: [2, 3],
      scheduledWeeks: [2, 3].map((week) => ({
        week, daysOfWeek: ['Monday'], startTime: '9:00 AM', endTime: '10:15 AM',
        location: 'Hultquist', room: '101',
      })),
    })]));
    render(<ClassesPage />);

    // Week 2 is starred, so it shows; week 3 is folded.
    expect(await screen.findByText('Week 2')).toBeInTheDocument();
    expect(screen.queryByText('Week 3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show 1 finished week/ })).toBeInTheDocument();
  });

  it('shows the price without the ticket site\'s "Sessions:" prefix', async () => {
    useClassData.mockReturnValue(loaded([makeClass({
      fee: null, priceLabel: 'Sessions: $145.00',
    })]));
    render(<ClassesPage />);
    expect(await screen.findByText(/\$145/)).toBeInTheDocument();
    expect(screen.queryByText(/Sessions: \$145/)).not.toBeInTheDocument();
  });

  it('folds a long group into a disclosure, like the calendar does', async () => {
    const venues = Array.from({ length: 9 }, (_, i) => `Venue ${i + 1}`);
    useClassData.mockReturnValue(loaded(venues.map((v, i) => makeClass({
      id: `CHQ.EVN${i}`, title: `Class ${i}`, venues: [v],
    }))));
    const { container } = render(<ClassesPage />);
    await openFilters();

    const section = [...container.querySelectorAll('details')]
      .find((d) => /Venue/.test(d.querySelector('summary')?.textContent ?? ''));
    expect(section).toBeTruthy();
    // Starts closed, and says nothing is picked yet.
    expect(section!.open).toBe(false);
    expect(section!.querySelector('summary')!.textContent).not.toMatch(/selected/);
  });

  it('shows what is picked on the summary row, so a collapsed filter is still visible', async () => {
    const venues = Array.from({ length: 9 }, (_, i) => `Venue ${i + 1}`);
    useClassData.mockReturnValue(loaded(venues.map((v, i) => makeClass({
      id: `CHQ.EVN${i}`, title: `Class ${i}`, venues: [v],
    }))));
    const { container } = render(<ClassesPage />);
    await openFilters();

    fireEvent.click(await screen.findByRole('button', { name: 'Venue 3' }));

    const summary = [...container.querySelectorAll('details')]
      .map((d) => d.querySelector('summary')!)
      .find((el) => /Venue/.test(el.textContent ?? ''))!;
    await waitFor(() => expect(summary.textContent).toMatch(/\(1 selected\)/));
    // The chosen tag itself rides along, so it can be unpicked without
    // opening the section.
    expect(summary.querySelector('button')!.textContent).toBe('Venue 3');
  });

  it('filters by venue', async () => {
    useClassData.mockReturnValue(loaded([
      makeClass({ title: 'At Hultquist', venues: ['Hultquist Center'] }),
      makeClass({ id: 'CHQ.EVN2', title: 'At Turner', venues: ['Turner Community Center'] }),
    ]));
    render(<ClassesPage />);
    await openFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Hultquist Center' }));
    await waitFor(() => expect(screen.queryByText('At Turner')).not.toBeInTheDocument());
    expect(screen.getByText('At Hultquist')).toBeInTheDocument();
  });

  it('narrows to what can still be joined through the Spots picker', async () => {
    useClassData.mockReturnValue(loaded([makeClass(), makeClass({
      id: 'CHQ.EVN9', title: 'Finished Class', sessions: [], weeks: [2],
      scheduledWeeks: [],
    })]));
    render(<ClassesPage />);
    await openFilters();

    // Open needs a live session, so a class with none drops out — which is
    // the job the separate "include finished" checkbox used to duplicate.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.queryByText('Finished Class')).not.toBeInTheDocument());
    expect(screen.getByText('Watercolors for Beginners')).toBeInTheDocument();
  });

  it('stars a single week, under a key that cannot collide with an event', async () => {
    useClassData.mockReturnValue(loaded([makeClass()]));
    render(<ClassesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Week 8 to favorites/ }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('chq-classes-favorites') ?? '{}');
      // Favorites are one flat set shared with the calendar, so the class
      // prefix is what keeps a week from colliding with an event id. The week
      // rather than the session id, so the star survives the site dropping
      // that session once the week is over.
      expect(stored.eventIds).toEqual(['class:CHQ.EVN1:week8']);
    });
  });

  it('offers the ticket site when the catalog cannot be loaded', async () => {
    useClassData.mockReturnValue({ classes: [], generatedAt: null, loading: false, error: 'Could not load classes (404)' });
    render(<ClassesPage />);

    expect(await screen.findByText('Classes are not available right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse them on tickets.chq.org/ })).toBeInTheDocument();
  });
});

describe('ClassesPage filters', () => {
  const twoWeekClass = makeClass({
    id: 'CHQ.EVN1',
    title: 'Watercolors for Beginners',
    sessions: [
      { ...makeClass().sessions[0], performanceId: 'p8', week: 8, startDate: '2026-08-17 09:00:00' },
      {
        ...makeClass().sessions[0],
        performanceId: 'p9', week: 9, startDate: '2026-08-24 19:00:00',
        availability: 'waitlist', spotsRemaining: null,
      },
    ],
  });

  it('offers only the weeks that still have sessions', async () => {
    useClassData.mockReturnValue(loaded([twoWeekClass]));
    render(<ClassesPage />);
    await openFilters();

    expect(await screen.findByRole('button', { name: 'Week 8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week 9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Week 1' })).not.toBeInTheDocument();
  });

  it('narrows to the classes with an open session', async () => {
    const waitlistOnly = makeClass({
      id: 'CHQ.EVN2', title: 'Full Class',
      sessions: [{ ...makeClass().sessions[0], availability: 'waitlist', spotsRemaining: null }],
    });
    useClassData.mockReturnValue(loaded([twoWeekClass, waitlistOnly]));
    render(<ClassesPage />);
    await openFilters();

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    await waitFor(() => expect(screen.queryByText('Full Class')).not.toBeInTheDocument());
    expect(screen.getByText('Watercolors for Beginners')).toBeInTheDocument();
    expect(screen.getByText(/^1 class/)).toBeInTheDocument();
  });

  it('keeps a filtered-out session visible but dimmed', async () => {
    useClassData.mockReturnValue(loaded([twoWeekClass]));
    const { container } = render(<ClassesPage />);
    await openFilters();

    fireEvent.click(await screen.findByRole('button', { name: 'Week 8' }));

    // Someone filtering to Week 8 still wants to see the class also runs in
    // Week 9 — hiding it would make a two-session class look like one.
    await waitFor(() => expect(container.querySelectorAll('li.opacity-40')).toHaveLength(1));
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('says so when the filters match nothing, and offers a way back', async () => {
    useClassData.mockReturnValue(loaded([twoWeekClass]));
    render(<ClassesPage />);
    await openFilters();

    // Week 8 here is a morning session; Week 9 is an evening one. Asking for
    // a Week 8 evening should find nothing rather than matching either half.
    fireEvent.click(await screen.findByRole('button', { name: 'Week 8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Evening' }));

    expect(await screen.findByText('No classes match these filters.')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    await waitFor(() => expect(screen.getByText('Watercolors for Beginners')).toBeInTheDocument());
  });

  it('remembers the filters for next time', async () => {
    useClassData.mockReturnValue(loaded([twoWeekClass]));
    const { unmount } = render(<ClassesPage />);
    await openFilters();
    fireEvent.click(await screen.findByRole('button', { name: 'Waitlist' }));

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('chq-classes-user-state') ?? '{}');
      expect(saved.availability).toBe('waitlist');
    });
    unmount();

    render(<ClassesPage />);
    await openFilters();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Waitlist' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it("keeps its filters out of the calendar's saved state", async () => {
    useClassData.mockReturnValue(loaded([twoWeekClass]));
    render(<ClassesPage />);
    await openFilters();
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    await waitFor(() => expect(localStorage.getItem('chq-classes-user-state')).toBeTruthy());
    // The calendar filters on entirely different things; one page's saved
    // state must never decide how the other reads.
    expect(localStorage.getItem('chq-calendar-user-state')).toBeNull();
  });
});

describe('the "meets" filter', () => {
  const oneOff = makeClass({
    id: 'CHQ.ONE', title: 'One Off Tasting',
    sessions: [{ ...makeClass().sessions[0], performanceId: 'p1', daysOfWeek: ['Friday'] }],
  });
  const fullWeek = makeClass({
    id: 'CHQ.FIVE', title: 'Five Day Intensive',
    sessions: [{
      ...makeClass().sessions[0], performanceId: 'p5',
      daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    }],
  });

  it('offers only the lengths present in the catalog', async () => {
    useClassData.mockReturnValue(loaded([oneOff, fullWeek]));
    render(<ClassesPage />);
    await openFilters();

    expect(screen.getByRole('button', { name: 'Meets 1 day a week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meets 5 days a week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meets 3 days a week' })).not.toBeInTheDocument();
  });

  it('narrows to classes meeting that many days', async () => {
    useClassData.mockReturnValue(loaded([oneOff, fullWeek]));
    render(<ClassesPage />);
    await openFilters();

    fireEvent.click(screen.getByRole('button', { name: 'Meets 1 day a week' }));

    await waitFor(() => expect(screen.queryByText('Five Day Intensive')).not.toBeInTheDocument());
    expect(screen.getByText('One Off Tasting')).toBeInTheDocument();
  });
});

describe('demo build', () => {
  it('shows nothing extra in a normal build', async () => {
    useClassData.mockReturnValue(loaded([makeClass()]));
    render(<ClassesPage />);

    expect(await screen.findByText('Watercolors for Beginners')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
  });

  it('says what it is, how stale it is, and which build made it', async () => {
    demoState.isDemoBuild = true;
    useClassData.mockReturnValue(loaded([makeClass()]));
    render(<ClassesPage />);

    const banner = await screen.findByTestId('demo-banner');
    // All three, because a preview missing any of them invites someone to
    // act on numbers that are neither live nor bookable.
    expect(banner).toHaveTextContent(/not the live site/i);
    expect(banner).toHaveTextContent(/snapshot/i);
    expect(banner).toHaveTextContent('build abc1234');
    expect(banner).toHaveTextContent(/21 Aug 2026/);
    expect(banner.querySelector('a')).toHaveAttribute('href', expect.stringContaining('tickets.chq.org'));
  });
});
