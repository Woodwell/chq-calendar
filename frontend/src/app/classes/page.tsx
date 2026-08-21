/**
 * Classes — public page at /classes/.
 *
 * Chautauqua's Special Studies catalog, with the live spot counts the ticket
 * site publishes. Deliberately separate from the calendar: a class is one
 * entity with several sessions and a capacity, which is not what an event is.
 * Registration stays on tickets.chq.org; every session links there.
 */

import { useMemo, useState } from 'react';
import { ClassCard } from '@/components/classes/ClassCard';
import { ClassFilters } from '@/components/classes/ClassFilters';
import { useClassData } from '@/hooks/useClassData';
import { useClassFilterState } from '@/hooks/useClassFilterState';
import { useFavorites } from '@/hooks/useFavorites';
import { getDefaultYear } from '@/lib/constants';
import type { ChqClass, ClassSession } from '@/lib/classTypes';
import {
  activeFilterCount,
  availableDays,
  availableWeeks,
  filterClasses,
  hasActiveFilters,
  hasSessionFilters,
  sessionMatches,
} from '@/lib/utils/classFilterHelpers';

const CATALOG_URL =
  'https://tickets.chq.org/searchclasses.html?subjectParentCat=L2_CC_SUB&weekParentCat=SEAS_WKS';

/** Soonest first, and classes with nothing left this season last. */
export function bySoonestSession(a: ChqClass, b: ChqClass): number {
  const first = (c: ChqClass) =>
    c.sessions.reduce<string | null>(
      (min, s) => (min === null || s.startDate < min ? s.startDate : min),
      null,
    );
  const aFirst = first(a);
  const bFirst = first(b);
  if (aFirst === null && bFirst === null) return a.title.localeCompare(b.title);
  if (aFirst === null) return 1;
  if (bFirst === null) return -1;
  if (aFirst === bFirst) return a.title.localeCompare(b.title);
  return aFirst < bFirst ? -1 : 1;
}

/**
 * "12 minutes ago" — spot counts are a snapshot taken on a schedule, not a
 * reservation, so the page says how old the numbers are rather than implying
 * they are live.
 */
export function describeAge(generatedAt: string, now: number = Date.now()): string {
  // Floored, not rounded: "5 minutes ago" should mean at least five minutes
  // have passed. Rounding reports a 30-second-old crawl as a minute stale.
  const minutes = Math.max(0, Math.floor((now - new Date(generatedAt).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function ClassesPage() {
  const year = getDefaultYear();
  const { classes, generatedAt, loading, error } = useClassData(year);
  const favorites = useFavorites();
  const filterState = useClassFilterState();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const options = useMemo(
    () => ({ ...filterState.filters, favoriteIds: favorites.favoriteIds }),
    [filterState.filters, favorites.favoriteIds],
  );
  const filtering = hasActiveFilters(options);
  const dimming = hasSessionFilters(options);

  const weeks = useMemo(() => availableWeeks(classes), [classes]);
  const days = useMemo(() => availableDays(classes), [classes]);

  // A class with no sessions left cannot be signed up for, and by late
  // August that is most of the catalog. Hidden unless asked for, and the
  // count is offered rather than the classes, so the page opens on what is
  // actually available.
  const finished = useMemo(() => classes.filter((c) => c.sessions.length === 0), [classes]);
  const inScope = useMemo(
    () => (filterState.filters.includeFinished
      ? classes
      : classes.filter((c) => c.sessions.length > 0)),
    [classes, filterState.filters.includeFinished],
  );

  const visible = useMemo(
    () => (filtering ? filterClasses(inScope, options) : [...inScope]).sort(bySoonestSession),
    [inScope, options, filtering],
  );
  const matchingSessions = useMemo(
    () => visible.reduce(
      (n, c) => n + (dimming
        ? c.sessions.filter((sx) => sessionMatches(c.id, sx, options)).length
        : c.sessions.length),
      0,
    ),
    [visible, options, dimming],
  );

  const toggleDescription = (classId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <a href="/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Classes
              </h1>
            </a>
            <a href="/" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
              Calendar
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Special Studies classes for the {year} season. Spot counts come from{' '}
          <a
            className="text-blue-600 dark:text-blue-400 hover:underline"
            href={CATALOG_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            tickets.chq.org
          </a>
          , which is also where you register.
        </p>

        {loading && <p className="text-gray-600 dark:text-gray-400">Loading classes…</p>}

        {error && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-gray-900 dark:text-gray-100 font-medium">
              Classes are not available right now.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{error}</p>
            <a
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block"
              href={CATALOG_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Browse them on tickets.chq.org instead
            </a>
          </div>
        )}

        {!loading && !error && (
          <>
            <ClassFilters
              filters={filterState.filters}
              weeks={weeks}
              days={days}
              favoriteCount={favorites.favoriteCount}
              finishedCount={finished.length}
              activeCount={activeFilterCount(options)}
              onSetSearchTerm={filterState.setSearchTerm}
              onToggleIncludeFinished={filterState.toggleIncludeFinished}
              onSetAvailability={filterState.setAvailability}
              onSetTimeOfDay={filterState.setTimeOfDay}
              onToggleWeek={filterState.toggleWeek}
              onToggleDay={filterState.toggleDay}
              onToggleFavoritesOnly={filterState.toggleFavoritesOnly}
            />

            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {filtering
                  ? `${visible.length} of ${inScope.length} classes · ${matchingSessions} matching sessions`
                  : `${visible.length} classes · ${matchingSessions} sessions still scheduled`}
                {filtering && (
                  <button
                    type="button"
                    onClick={filterState.clearAll}
                    className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </p>
              {generatedAt && (
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  Spot counts updated {describeAge(generatedAt)}
                </p>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center">
                <p className="text-gray-900 dark:text-gray-100 font-medium">No classes match these filters.</p>
                <button
                  type="button"
                  onClick={filterState.clearAll}
                  className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {visible.map((chqClass) => (
                  <ClassCard
                    key={chqClass.id}
                    chqClass={chqClass}
                    isExpanded={expanded.has(chqClass.id)}
                    onToggleDescription={toggleDescription}
                    isFavorite={favorites.isFavorite}
                    onToggleFavorite={favorites.toggleFavorite}
                    sessionMatches={dimming
                      ? (sx: ClassSession) => sessionMatches(chqClass.id, sx, options)
                      : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
