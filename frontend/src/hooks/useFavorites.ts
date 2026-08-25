import { useState, useCallback, useEffect } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

/** Starred events on the calendar. Live data — do not repurpose this key. */
export const EVENT_FAVORITES_KEY = 'chq-calendar-favorites';

/**
 * Starred class weeks, kept apart from events on purpose.
 *
 * They were one set, which meant starring a class raised the calendar's
 * "★ 3" badge without putting anything in it — the count is over the whole
 * set, and a class id matches no event. Showing both together is a real
 * feature and a deliberately deferred one; until it is designed, the two
 * simply do not touch.
 */
export const CLASS_FAVORITES_KEY = 'chq-classes-favorites';

/** Ids written by the classes page, back when both shared one store. */
const CLASS_ID_PREFIX = 'class:';

interface StoredFavorites {
  /**
   * Named for events because that is what the live store already contains,
   * and renaming it would orphan every calendar favourite in the wild. The
   * classes store reuses the shape rather than the name's meaning.
   */
  eventIds: string[];
  lastSaved: number;
}

function readIds(storageKey: string): string[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed: StoredFavorites = JSON.parse(stored);
    if (!parsed.lastSaved || Date.now() - parsed.lastSaved >= USER_STATE_EXPIRY_MS) return [];
    return Array.isArray(parsed.eventIds) ? parsed.eventIds : [];
  } catch (e) {
    console.warn('Failed to load favorites:', e);
    return [];
  }
}

/**
 * The starting set for a store, healing the period when both shared one.
 *
 * The events store drops any class id it picked up then, so the calendar's
 * count stops including things it cannot show. The classes store adopts them
 * if it is empty, so nobody loses a star to the split.
 */
function initialIds(storageKey: string): Set<string> {
  const own = readIds(storageKey);
  if (storageKey === EVENT_FAVORITES_KEY) {
    return new Set(own.filter((id) => !id.startsWith(CLASS_ID_PREFIX)));
  }
  if (storageKey === CLASS_FAVORITES_KEY && own.length === 0) {
    return new Set(readIds(EVENT_FAVORITES_KEY).filter((id) => id.startsWith(CLASS_ID_PREFIX)));
  }
  return new Set(own);
}

export function useFavorites(storageKey: string = EVENT_FAVORITES_KEY) {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => initialIds(storageKey));

  useEffect(() => {
    try {
      const data: StoredFavorites = {
        eventIds: Array.from(favoriteIds),
        lastSaved: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save favorites:', e);
    }
  }, [favoriteIds, storageKey]);

  const isFavorite = useCallback(
    (eventId: string) => favoriteIds.has(eventId),
    [favoriteIds]
  );

  const toggleFavorite = useCallback((eventId: string) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    favoriteCount: favoriteIds.size,
  };
}
