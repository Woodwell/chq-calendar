import { formatBuildTime } from '../demoMode';

describe('formatBuildTime', () => {
  it('renders a build timestamp people can read', () => {
    expect(formatBuildTime('2026-08-21T14:32:00Z')).toMatch(/21 Aug 2026/);
  });

  it('says nothing rather than "Invalid Date" when there is no timestamp', () => {
    // A demo build made outside the normal build path still has to render.
    expect(formatBuildTime('')).toBe('');
    expect(formatBuildTime('not-a-date')).toBe('');
  });
});
