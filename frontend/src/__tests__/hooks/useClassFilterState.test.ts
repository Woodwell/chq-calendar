import { describe, it, expect } from 'vitest';
import { defaultAvailability } from '@/hooks/useClassFilterState';

/**
 * The 2026 season runs 27 Jun – 29 Aug. Dates are written in Institution time
 * because that is what decides the boundary; a UTC instant near midnight would
 * land on the wrong side of it.
 */
const at = (iso: string) => new Date(iso);

describe('defaultAvailability', () => {
  it('opens on what can be joined while the season is running', () => {
    expect(defaultAvailability(at('2026-06-27T12:00:00-04:00'))).toBe('open');
    expect(defaultAvailability(at('2026-07-15T12:00:00-04:00'))).toBe('open');
    expect(defaultAvailability(at('2026-08-29T12:00:00-04:00'))).toBe('open');
  });

  // The regression this exists for. Past the last week the ticket site has
  // dropped every session, so 'open' matches almost nothing and hides the
  // catalog behind a filter the reader never set — observed 2026-09-01 as
  // 41 of 516 classes, all of them week 9.
  it('shows everything once the season has ended', () => {
    expect(defaultAvailability(at('2026-08-30T12:00:00-04:00'))).toBe('all');
    expect(defaultAvailability(at('2026-09-01T12:00:00-04:00'))).toBe('all');
    expect(defaultAvailability(at('2026-12-25T12:00:00-05:00'))).toBe('all');
  });

  it('shows everything before the season opens', () => {
    expect(defaultAvailability(at('2026-06-26T12:00:00-04:00'))).toBe('all');
    expect(defaultAvailability(at('2026-02-01T12:00:00-05:00'))).toBe('all');
  });

  // Derived from the season calendar rather than a month boundary, so it needs
  // no revisiting when the Institution moves its dates.
  it('tracks a different year’s season rather than fixed dates', () => {
    expect(defaultAvailability(at('2027-07-15T12:00:00-04:00'))).toBe('open');
    expect(defaultAvailability(at('2027-09-15T12:00:00-04:00'))).toBe('all');
  });
});
