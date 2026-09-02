import { useCallback, useEffect, useState } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { chqParts } from '@/lib/utils/chqTime';
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
  /** Buildings, not rooms. Any-of, like categories. */
  selectedVenues: string[];
  availability: AvailabilityFilter;
  selectedWeeks: number[];
  selectedDays: string[];
  meetingDays: number[];
  timeOfDay: TimeOfDay;
  showFavoritesOnly: boolean;
}

/**
 * `'open'` during the season, `'all'` outside it.
 *
 * Opening on what can actually be joined is right while the season runs: most
 * of the catalog has finished by late August, and a page that opens on 454
 * classes nobody can sign up for buries the sixty that are live.
 *
 * It is exactly wrong once the season ends. The ticket site drops a session
 * from its detail page the moment it has passed, so by September every class
 * reports none at all — and availability is a question only a session can
 * answer. Defaulting to `'open'` then hides the entire catalog behind a
 * filter the reader never set, leaving whichever stragglers the last crawl
 * caught. Observed on 2026-09-01: 41 of 516 classes, all week 9.
 *
 * The season's own calendar decides, not a month boundary, so this needs no
 * revisiting when the Institution moves its dates.
 */
export function defaultAvailability(now: Date = new Date()): AvailabilityFilter {
  const weeks = getChautauquaSeasonWeeks(chqParts(now).year);
  if (weeks.length === 0) return 'all';
  const opens = weeks[0].start;
  const closes = weeks[weeks.length - 1].end;
  return now >= opens && now <= closes ? 'open' : 'all';
}

function emptyState(now?: Date): ClassFilterState {
  return {
    searchTerm: '',
    selectedCategories: [],
    selectedVenues: [],
    availability: defaultAvailability(now),
    selectedWeeks: [],
    selectedDays: [],
    meetingDays: [],
    timeOfDay: 'all',
    showFavoritesOnly: false,
  };
}

interface StoredState extends ClassFilterState {
  lastSaved: number;
}

/** Anything unrecognised falls back to the default rather than throwing. */
function load(): ClassFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (!parsed.lastSaved || Date.now() - parsed.lastSaved > USER_STATE_EXPIRY_MS) return emptyState();
    return {
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : '',
      selectedCategories: Array.isArray(parsed.selectedCategories) ? parsed.selectedCategories : [],
      selectedVenues: Array.isArray(parsed.selectedVenues) ? parsed.selectedVenues : [],
      availability: parsed.availability ?? emptyState().availability,
      selectedWeeks: Array.isArray(parsed.selectedWeeks) ? parsed.selectedWeeks : [],
      selectedDays: Array.isArray(parsed.selectedDays) ? parsed.selectedDays : [],
      meetingDays: Array.isArray(parsed.meetingDays) ? parsed.meetingDays : [],
      timeOfDay: parsed.timeOfDay ?? emptyState().timeOfDay,
      showFavoritesOnly: parsed.showFavoritesOnly ?? false,
    };
  } catch {
    return emptyState();
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

  const setAvailability = useCallback((availability: AvailabilityFilter) => {
    setFilters((f) => ({ ...f, availability }));
  }, []);

  const setTimeOfDay = useCallback((timeOfDay: TimeOfDay) => {
    setFilters((f) => ({ ...f, timeOfDay }));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setFilters((f) => ({ ...f, selectedCategories: toggle(f.selectedCategories, category) }));
  }, []);

  const toggleVenue = useCallback((venue: string) => {
    setFilters((f) => ({ ...f, selectedVenues: toggle(f.selectedVenues, venue) }));
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

  const clearAll = useCallback(() => setFilters(emptyState()), []);

  return {
    filters,
    setSearchTerm,
    setAvailability,
    setTimeOfDay,
    toggleCategory,
    toggleVenue,
    toggleWeek,
    toggleDay,
    toggleMeetingDays,
    toggleFavoritesOnly,
    clearAll,
  };
}
