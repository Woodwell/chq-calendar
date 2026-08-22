import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import { Header } from '../Header';

const defaultProps = {
  selectedYear: 2026,
  availableYears: [2026],
  defaultYear: 2026,
  onYearChange: () => {},
};

const demoState = { isDemoBuild: false };
vi.mock('@/lib/demoMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/demoMode')>()),
  get isDemoBuild() { return demoState.isDemoBuild; },
}));

vi.mock('@/lib/iosPromo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/iosPromo')>()),
  isAppPromoAvailable: vi.fn(() => false),
}));

beforeEach(() => { demoState.isDemoBuild = false; });

/** The menu's items only render once it is opened. */
function openMenu(area: 'header-desktop' | 'header-mobile') {
  const scope = within(screen.getByTestId(area));
  fireEvent.click(scope.getAllByRole('button')[0]);
  return scope;
}

describe('the demo badge', () => {
  it('is absent from a normal build', () => {
    render(<Header {...defaultProps} />);
    expect(screen.queryByTestId('demo-badge')).not.toBeInTheDocument();
  });

  it('marks the calendar itself as a preview', () => {
    // The classes page has a full banner; the calendar needs to say it too,
    // or someone landing there has no idea this is not the live site.
    demoState.isDemoBuild = true;
    render(<Header {...defaultProps} />);

    const badge = screen.getByTestId('demo-badge');
    expect(badge).toHaveTextContent(/demo/i);
    // Events really are live here — only the class counts are a snapshot —
    // so the tooltip must not claim the whole page is stale.
    expect(badge).toHaveAttribute('title', expect.stringContaining('Events are live'));
  });

  it('stays out of the title row, which has no room to give', () => {
    // At 375px "CHQ Calendar" fits in exactly the space it has; a badge
    // beside it truncated the title to "CHQ C…".
    demoState.isDemoBuild = true;
    render(<Header {...defaultProps} />);

    const identity = screen.getByTestId('header-identity');
    expect(identity).not.toContainElement(screen.getByTestId('demo-badge'));
  });
});

describe('the demo link to /classes', () => {
  it('is absent from a normal build', () => {
    render(<Header {...defaultProps} />);
    // The real entry belongs in shared/links.json, which would also put it
    // on the live site and in the iOS About screen.
    expect(screen.queryByText('Classes (demo)')).not.toBeInTheDocument();
  });

  it('appears in the top-right menu of a demo build', () => {
    demoState.isDemoBuild = true;
    render(<Header {...defaultProps} />);

    const link = openMenu('header-desktop').getByText('Classes (demo)');
    expect(link.closest('a')).toHaveAttribute('href', '/classes');
  });

  it('appears in the mobile menu too', () => {
    demoState.isDemoBuild = true;
    render(<Header {...defaultProps} />);
    expect(openMenu('header-mobile').getByText('Classes (demo)')).toBeInTheDocument();
  });
});
