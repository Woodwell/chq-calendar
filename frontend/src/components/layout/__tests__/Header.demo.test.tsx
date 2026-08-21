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
