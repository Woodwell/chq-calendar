import { useEffect, useState } from 'react';
import { chqNowLocal } from '@/lib/utils/chqTime';

/** Long enough that a card is never much out of date, short enough to be cheap. */
const TICK_MS = 60_000;

/**
 * The Institution's clock, as a naive local datetime that advances.
 *
 * Reading `new Date()` during render gave a new value on every render, which
 * invalidated the memos keyed on it — so typing in the search box re-filtered
 * and re-sorted the whole catalog because the second had changed. And in the
 * other direction, a page left open never moved at all: a session ending at
 * three kept its Register button into the evening, which is exactly what the
 * clock comparison was added to prevent.
 *
 * Ticking once a minute fixes both. Renders in between see a stable string,
 * and the page catches up on its own within a minute of a session ending.
 */
export function useChqNow(): string {
  const [now, setNow] = useState(() => chqNowLocal(new Date()));

  useEffect(() => {
    const id = setInterval(() => {
      // Only re-render when the value actually differs, so a tick that lands
      // inside the same minute costs nothing.
      setNow((previous) => {
        const next = chqNowLocal(new Date());
        return next === previous ? previous : next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return now;
}
