import { useCallback, useEffect, useState } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';
import type { AvailabilityFilter, TimeOfDay } from '@/lib/utils/classFilterHelpers';

/**
 * Its own key, not the calendar's.
 *
 * The two pages filter on different things entirely — this has no search
 * term, locations, categories or day window, and the calendar has no notion
 * of availability. Sharing a key would mean one page's saved state deciding
 * how to read the other's.
 */
const STORAGE_KEY = 'chq-classes-user-state';

export interface ClassFilterState {
  availability: AvailabilityFilter;
  selectedWeeks: number[];
  selectedDays: string[];
  timeOfDay: TimeOfDay;
  showFavoritesOnly: boolean;
}

const EMPTY: ClassFilterState = {
  availability: 'all',
  selectedWeeks: [],
  selectedDays: [],
  timeOfDay: 'all',
  showFavoritesOnly: false,
};

interface StoredState extends ClassFilterState {
  lastSaved: number;
}

/** Anything unrecognised falls back to the default rather than throwing. */
function load(): ClassFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (!parsed.lastSaved || Date.now() - parsed.lastSaved > USER_STATE_EXPIRY_MS) return EMPTY;
    return {
      availability: parsed.availability ?? EMPTY.availability,
      selectedWeeks: Array.isArray(parsed.selectedWeeks) ? parsed.selectedWeeks : [],
      selectedDays: Array.isArray(parsed.selectedDays) ? parsed.selectedDays : [],
      timeOfDay: parsed.timeOfDay ?? EMPTY.timeOfDay,
      showFavoritesOnly: parsed.showFavoritesOnly ?? false,
    };
  } catch {
    return EMPTY;
  }
}

/** Toggles a value in a list, keeping it sorted for a stable saved shape. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value].sort();
}

export function useClassFilterState() {
  const [filters, setFilters] = useState<ClassFilterState>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...filters, lastSaved: Date.now() }));
    } catch {
      // A full or blocked store costs the saved filters, nothing more.
    }
  }, [filters]);

  const setAvailability = useCallback((availability: AvailabilityFilter) => {
    setFilters((f) => ({ ...f, availability }));
  }, []);

  const setTimeOfDay = useCallback((timeOfDay: TimeOfDay) => {
    setFilters((f) => ({ ...f, timeOfDay }));
  }, []);

  const toggleWeek = useCallback((week: number) => {
    setFilters((f) => ({ ...f, selectedWeeks: toggle(f.selectedWeeks, week) }));
  }, []);

  const toggleDay = useCallback((day: string) => {
    setFilters((f) => ({ ...f, selectedDays: toggle(f.selectedDays, day) }));
  }, []);

  const toggleFavoritesOnly = useCallback(() => {
    setFilters((f) => ({ ...f, showFavoritesOnly: !f.showFavoritesOnly }));
  }, []);

  const clearAll = useCallback(() => setFilters(EMPTY), []);

  return {
    filters,
    setAvailability,
    setTimeOfDay,
    toggleWeek,
    toggleDay,
    toggleFavoritesOnly,
    clearAll,
  };
}
