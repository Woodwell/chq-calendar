import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ClassFilterState } from '@/hooks/useClassFilterState';
import type { AvailabilityFilter, TimeOfDay } from '@/lib/utils/classFilterHelpers';
import { TIME_OF_DAY_LABELS } from '@/lib/utils/classFilterHelpers';

/**
 * The active/inactive pair used throughout the calendar's filters. Repeated
 * here rather than imported because those components are wired to the
 * calendar's drag-select and week-theme popovers, which this page has no use
 * for; only the look is shared.
 */
const toggleClasses = (active: boolean): string =>
  `px-3 py-1 rounded-full text-sm font-medium transition-colors ${
    active
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-600'
  }`;

interface ToggleProps {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
  /**
   * Spoken name, when the visible label is too short to mean anything on its
   * own — a week button reads "8", which announces as "8".
   */
  name?: string;
}

function Toggle({ label, active, onClick, title, name }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={toggleClasses(active)}
      aria-pressed={active}
      aria-label={name}
      title={title}
    >
      {label}
    </button>
  );
}

/**
 * A group whose options are too many to show at once.
 *
 * Category runs to seventeen and venue to forty-four, which buries the rest
 * of the panel. Whatever is selected always stays visible — a filter you
 * cannot see is a filter you cannot undo — and the rest sit behind a count.
 */
const COLLAPSE_ABOVE = 8;

function CollapsibleGroup({ label, options, onToggle }: {
  label: string;
  options: Array<{ value: string; active: boolean }>;
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selected = options.filter((o) => o.active);
  // A short list is cheaper to read than to unfold, so only the long ones
  // collapse. Venue runs to forty-four, category to seventeen; time of day is
  // three and would be silly behind a button.
  const collapses = options.length > COLLAPSE_ABOVE;
  const shown = !collapses || expanded ? options : selected;
  const hidden = options.length - shown.length;

  return (
    <Group label={label}>
      {shown.map((o) => (
        <Toggle
          key={o.value}
          label={o.value}
          active={o.active}
          onClick={() => onToggle(o.value)}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="px-2 py-1 rounded-full text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${options.length}`}
        </button>
      )}
    </Group>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 w-20 shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

const AVAILABILITY: { value: AvailabilityFilter; label: string; title: string }[] = [
  { value: 'all', label: 'Any', title: 'Every class, whether or not it has room' },
  { value: 'open', label: 'Open', title: 'Sessions with spots left' },
  { value: 'waitlist', label: 'Waitlist', title: 'Sessions that are full but taking a waitlist' },
];

const TIMES: { value: TimeOfDay; label: string }[] = [
  { value: 'all', label: 'Any' },
  { value: 'morning', label: TIME_OF_DAY_LABELS.morning },
  { value: 'afternoon', label: TIME_OF_DAY_LABELS.afternoon },
  { value: 'evening', label: TIME_OF_DAY_LABELS.evening },
];

interface ClassFiltersProps {
  filters: ClassFilterState;
  categories: string[];
  venues: string[];
  weeks: number[];
  days: string[];
  meetingDayOptions: number[];
  favoriteCount: number;
  activeCount: number;
  onSetSearchTerm: (value: string) => void;
  onSetAvailability: (value: AvailabilityFilter) => void;
  onSetTimeOfDay: (value: TimeOfDay) => void;
  onToggleCategory: (category: string) => void;
  onToggleVenue: (venue: string) => void;
  onToggleWeek: (week: number) => void;
  onToggleDay: (day: string) => void;
  onToggleMeetingDays: (days: number) => void;
  onToggleFavoritesOnly: () => void;
}

export function ClassFilters({
  filters, categories, venues, weeks, days, meetingDayOptions, favoriteCount, activeCount,
  onSetSearchTerm,
  onSetAvailability, onSetTimeOfDay, onToggleCategory, onToggleVenue, onToggleWeek, onToggleDay,
  onToggleMeetingDays, onToggleFavoritesOnly,
}: ClassFiltersProps) {
  // Open on a wide screen, closed on a phone. Expanded, the pickers run to
  // roughly 590px, which on a 812px-tall screen means scrolling past the
  // whole panel before reaching a single class. Read once at mount rather
  // than tracked: this decides a starting state, and re-collapsing a panel
  // under someone because they rotated the phone would be worse.
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(min-width: 640px)').matches;
  });

  return (
    <section
      aria-label="Filter classes"
      className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={filters.searchTerm}
          onInput={(e) => onSetSearchTerm((e.target as HTMLInputElement).value)}
          placeholder="Search class or instructor…"
          aria-label="Search class or instructor"
          className="flex-1 min-w-0 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 dark:placeholder-gray-500"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </div>

      {!open ? null : (
      <>
      <Group label="Spots">
        {AVAILABILITY.map(({ value, label, title }) => (
          <Toggle
            key={value}
            label={label}
            title={title}
            active={filters.availability === value}
            onClick={() => onSetAvailability(value)}
          />
        ))}
        <Toggle
          label={`★ ${favoriteCount}`}
          title="Only the sessions you have starred"
          active={filters.showFavoritesOnly}
          onClick={onToggleFavoritesOnly}
        />
      </Group>

      {categories.length > 0 && (
        <CollapsibleGroup
          label="Category"
          options={categories.map((category) => ({
            value: category,
            active: filters.selectedCategories.includes(category),
          }))}
          onToggle={onToggleCategory}
        />
      )}

      {venues.length > 0 && (
        <CollapsibleGroup
          label="Venue"
          options={venues.map((venue) => ({
            value: venue,
            active: filters.selectedVenues.includes(venue),
          }))}
          onToggle={onToggleVenue}
        />
      )}

      {/* Weeks come from the printed schedule, so all nine stay selectable
          once the season is under way — the catalog remembers a week the
          ticket site has already dropped. Days still come from the sessions
          themselves, where a button that matches nothing is worse than none. */}
      {weeks.length > 0 && (
        <Group label="Week">
          {weeks.map((week) => (
            <Toggle
              key={week}
              label={String(week)}
              name={`Week ${week}`}
              title={`Week ${week}`}
              active={filters.selectedWeeks.includes(week)}
              onClick={() => onToggleWeek(week)}
            />
          ))}
        </Group>
      )}

      {days.length > 0 && (
        <Group label="Day">
          {days.map((day) => (
            <Toggle
              key={day}
              label={day.slice(0, 3)}
              name={day}
              title={day}
              active={filters.selectedDays.includes(day)}
              onClick={() => onToggleDay(day)}
            />
          ))}
        </Group>
      )}

      {/* How many days a week, as against which days — "only want a one-off"
          rather than "free on Tuesdays". */}
      {meetingDayOptions.length > 0 && (
        <Group label="Classes/wk">
          {meetingDayOptions.map((n) => (
            <Toggle
              key={n}
              label={String(n)}
              name={`Meets ${n} ${n === 1 ? 'day' : 'days'} a week`}
              title={`Classes meeting ${n} ${n === 1 ? 'day' : 'days'} a week`}
              active={filters.meetingDays.includes(n)}
              onClick={() => onToggleMeetingDays(n)}
            />
          ))}
        </Group>
      )}

      <Group label="Time">
        {TIMES.map(({ value, label }) => (
          <Toggle
            key={value}
            label={label}
            active={filters.timeOfDay === value}
            onClick={() => onSetTimeOfDay(value)}
          />
        ))}
      </Group>

      {/* Not one of the pickers: this decides what the catalog even contains,
          so it sits apart from them and survives "clear filters". */}
      </>
      )}
    </section>
  );
}
