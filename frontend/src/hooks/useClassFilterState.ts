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
  searchTerm: string;
  selectedCategories: string[];
  availability: AvailabilityFilter;
  selectedWeeks: number[];
  selectedDays: string[];
  meetingDays: number[];
  timeOfDay: TimeOfDay;
  showFavoritesOnly: boolean;
  /**
   * Whether to list classes whose sessions have all passed. Off by default:
   * late in the season they are most of the catalog — 361 of 466 in late
   * August — and none of them can be signed up for.
   */
  includeFinished: boolean;
}

const EMPTY: ClassFilterState = {
  searchTerm: '',
  selectedCategories: [],
  availability: 'all',
  selectedWeeks: [],
  selectedDays: [],
  meetingDays: [],
  timeOfDay: 'all',
  showFavoritesOnly: false,
  includeFinished: false,
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
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : '',
      selectedCategories: Array.isArray(parsed.selectedCategories) ? parsed.selectedCategories : [],
      availability: parsed.availability ?? EMPTY.availability,
      selectedWeeks: Array.isArray(parsed.selectedWeeks) ? parsed.selectedWeeks : [],
      selectedDays: Array.isArray(parsed.selectedDays) ? parsed.selectedDays : [],
      meetingDays: Array.isArray(parsed.meetingDays) ? parsed.meetingDays : [],
      timeOfDay: parsed.timeOfDay ?? EMPTY.timeOfDay,
      showFavoritesOnly: parsed.showFavoritesOnly ?? false,
      includeFinished: parsed.includeFinished ?? false,
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

  const setSearchTerm = useCallback((searchTerm: string) => {
    setFilters((f) => ({ ...f, searchTerm }));
  }, []);

  const toggleIncludeFinished = useCallback(() => {
    setFilters((f) => ({ ...f, includeFinished: !f.includeFinished }));
  }, []);

  const setAvailability = useCallback((availability: AvailabilityFilter) => {
    setFilters((f) => ({ ...f, availability }));
  }, []);

  const setTimeOfDay = useCallback((timeOfDay: TimeOfDay) => {
    setFilters((f) => ({ ...f, timeOfDay }));
  }, []);

  const toggleCategory = useCallback((subject: string) => {
    setFilters((f) => ({ ...f, selectedCategories: toggle(f.selectedCategories, subject) }));
  }, []);

  const toggleWeek = useCallback((week: number) => {
    setFilters((f) => ({ ...f, selectedWeeks: toggle(f.selectedWeeks, week) }));
  }, []);

  const toggleDay = useCallback((day: string) => {
    setFilters((f) => ({ ...f, selectedDays: toggle(f.selectedDays, day) }));
  }, []);

  const toggleMeetingDays = useCallback((days: number) => {
    setFilters((f) => ({ ...f, meetingDays: toggle(f.meetingDays, days) }));
  }, []);

  const toggleFavoritesOnly = useCallback(() => {
    setFilters((f) => ({ ...f, showFavoritesOnly: !f.showFavoritesOnly }));
  }, []);

  // Clearing filters is about the search and the pickers; whether finished
  // classes are listed is a separate choice and stays where it was put.
  const clearAll = useCallback(
    () => setFilters((f) => ({ ...EMPTY, includeFinished: f.includeFinished })),
    [],
  );

  return {
    filters,
    setSearchTerm,
    toggleIncludeFinished,
    setAvailability,
    setTimeOfDay,
    toggleCategory,
    toggleWeek,
    toggleDay,
    toggleMeetingDays,
    toggleFavoritesOnly,
    clearAll,
  };
}
