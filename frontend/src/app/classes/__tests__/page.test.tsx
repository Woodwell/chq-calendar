import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import ClassesPage, { bySoonestSession, describeAge } from '../page';
import type { ChqClass } from '@/lib/classTypes';

const useClassData = vi.fn();
vi.mock('@/hooks/useClassData', () => ({ useClassData: (year: number) => useClassData(year) }));

const makeClass = (over: Partial<ChqClass> = {}): ChqClass => ({
  id: 'CHQ.EVN1',
  title: 'Watercolors for Beginners',
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('bySoonestSession', () => {
  it('puts the soonest session first and the finished classes last', () => {
    const soon = makeClass({ id: 'a', title: 'A' });
    const later = makeClass({
      id: 'b', title: 'B',
      sessions: [{ ...makeClass().sessions[0], startDate: '2026-08-24 13:00:00' }],
    });
    // Sessions vanish once their week passes, so this class has none left.
    const done = makeClass({ id: 'c', title: 'C', sessions: [] });

    expect([done, later, soon].sort(bySoonestSession).map(c => c.id)).toEqual(['a', 'b', 'c']);
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

    expect(await screen.findByText('Waitlist')).toBeInTheDocument();
    expect(screen.queryByText(/spots left/)).not.toBeInTheDocument();
  });

  it('says so plainly when a class has nothing left this season', async () => {
    useClassData.mockReturnValue(loaded([makeClass({ sessions: [] })]));
    render(<ClassesPage />);

    expect(await screen.findByText('No sessions remaining this season.')).toBeInTheDocument();
  });

  it('stars a single session, under a key that cannot collide with an event', async () => {
    useClassData.mockReturnValue(loaded([makeClass()]));
    render(<ClassesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Week 8 session to favorites/ }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('chq-calendar-favorites') ?? '{}');
      // Favorites are one flat set shared with the calendar, so the class
      // prefix is what keeps a session from colliding with an event id.
      expect(stored.eventIds).toEqual(['class:CHQ.EVN1:CHQ.EVN1.PRF1']);
    });
  });

  it('offers the ticket site when the catalog cannot be loaded', async () => {
    useClassData.mockReturnValue({ classes: [], generatedAt: null, loading: false, error: 'Could not load classes (404)' });
    render(<ClassesPage />);

    expect(await screen.findByText('Classes are not available right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse them on tickets.chq.org/ })).toBeInTheDocument();
  });
});
