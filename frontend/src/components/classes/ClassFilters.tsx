import { useState } from 'react';
import type { ReactNode } from 'react';
import { useHorizontalScroll, useVerticalScroll } from '@/hooks/useScrollState';
import type { ClassFilterState } from '@/hooks/useClassFilterState';
import type { AvailabilityFilter, TimeOfDay } from '@/lib/utils/classFilterHelpers';
import { TIME_OF_DAY_LABELS } from '@/lib/utils/classFilterHelpers';

/**
 * The calendar's own filter styling, repeated rather than imported: its
 * components are wired to drag-select and week-theme popovers this page has
 * no use for, so only the look travels.
 *
 * Two shapes, and the distinction is the calendar's. A pill is one of many
 * things you can pick at once — a category, a day. A segment is one of a few
 * mutually exclusive answers to a single question, and looks like a control
 * with a border rather than a tag.
 */
const pillClasses = (active: boolean): string =>
  `px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
    active
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
  }`;

const segmentClasses = (active: boolean): string =>
  `px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
  }`;

/** The section heading, matching the calendar's `<summary>` type. */
const SECTION_LABEL = 'text-sm font-medium text-gray-700 dark:text-gray-300';

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
  /** A single-answer control rather than one tag among many. */
  segment?: boolean;
}

function Toggle({ label, active, onClick, title, name, segment }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={segment ? segmentClasses(active) : pillClasses(active)}
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
/**
 * A long list of tags, folded into the calendar's disclosure.
 *
 * The same `<details>` shape the calendar uses for categories and locations:
 * a chevron, the count of what is picked, and the picked tags themselves
 * along the summary row so a filter is never hidden by being collapsed. The
 * body scrolls rather than growing, because venue runs to forty-six and would
 * otherwise push everything else off the screen.
 */
function CollapsibleGroup({ label, options, onToggle }: {
  label: string;
  options: Array<{ value: string; active: boolean }>;
  onToggle: (value: string) => void;
}) {
  const pillScroll = useHorizontalScroll();
  const listScroll = useVerticalScroll();
  const selected = options.filter((o) => o.active);

  return (
    <details>
      <summary className={`${SECTION_LABEL} mb-2 cursor-pointer flex items-center gap-2 min-w-0`}>
        <span className="flex-shrink-0 flex items-center gap-1">
          <svg className="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {label} {selected.length > 0 && `(${selected.length} selected)`}
        </span>
        {selected.length > 0 && (
          <div className={`flex-1 min-w-0 pills-scroll-container ${pillScroll.scrollState.canScrollLeft ? 'scrolled-right' : ''} ${!pillScroll.scrollState.canScrollRight ? 'scrolled-to-end' : ''}`}>
            <div
              ref={pillScroll.scrollRef}
              className="flex gap-2 pb-1 overflow-x-auto overflow-y-hidden scrollbar-hide pr-4"
              onScroll={pillScroll.handleScroll}
            >
              {selected.map((o) => (
                <button
                  key={`selected-${o.value}`}
                  type="button"
                  title={o.value}
                  onClick={(e) => {
                    // The summary is a toggle; picking a tag inside it must
                    // not also open or close the section.
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle(o.value);
                  }}
                  className={`flex-shrink-0 ${pillClasses(true)}`}
                >
                  {o.value}
                </button>
              ))}
            </div>
          </div>
        )}
      </summary>
      <div className={`filter-list-container mb-2 ${listScroll.scrollState.canScrollUp ? 'scrolled-down' : ''} ${listScroll.scrollState.canScrollDown ? 'can-scroll-down' : ''}`}>
        <div
          ref={listScroll.scrollRef}
          className="max-h-24 sm:max-h-32 overflow-y-auto scrollable-list"
          onScroll={listScroll.handleScroll}
        >
          <div className="flex flex-wrap gap-1 sm:gap-2">
            {options.map((o) => (
              <Toggle
                key={o.value}
                label={o.value}
                title={o.value}
                active={o.active}
                onClick={() => onToggle(o.value)}
              />
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

/**
 * The nine weeks as one joined strip, the shape the calendar uses.
 *
 * Not `WeekSelector` itself: that one carries drag-selection and the
 * long-press theme popover, both wired to the calendar's own state. Only the
 * look is borrowed — a bordered strip of cells rather than nine loose pills,
 * which is what makes a week read as a position in the season.
 */
function WeekStrip({ weeks, selected, onToggle }: {
  weeks: number[];
  selected: number[];
  onToggle: (week: number) => void;
}) {
  return (
    <div className="flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden select-none w-fit">
      {weeks.map((week) => {
        const active = selected.includes(week);
        return (
          <button
            type="button"
            key={week}
            onClick={() => onToggle(week)}
            aria-pressed={active}
            aria-label={`Week ${week}`}
            title={`Week ${week}`}
            className={`w-8 h-8 flex items-center justify-center cursor-pointer border-r border-gray-300 dark:border-gray-600 last:border-r-0 transition-all text-xs flex-shrink-0 ${
              active
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700'
            }`}
          >
            {week}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A short row of controls beside its heading.
 *
 * One line where it fits, wrapping under the label where it does not — the
 * panel is seven of these, and a heading on its own line for each spent more
 * vertical space than a phone has.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={`${SECTION_LABEL} shrink-0`}>{label}</span>
      <div className="flex flex-wrap items-center gap-1 sm:gap-2">
        {children}
      </div>
    </div>
  );
}


// Open first because it is where nearly everyone starts, and the default.
// "Any" is the widening move, so it reads last rather than as the norm.
const AVAILABILITY: { value: AvailabilityFilter; label: string; name: string; title: string }[] = [
  { value: 'open', label: 'Open', name: 'Open', title: 'Sessions with spots left' },
  { value: 'waitlist', label: 'Waitlist', name: 'Waitlist', title: 'Sessions that are full but taking a waitlist' },
  // "Any" appears in this row and in Time of day, so each says what it is any
  // of — two buttons announcing "Any" is a coin toss for anyone not seeing
  // which row they are in.
  { value: 'all', label: 'Any', name: 'Any availability', title: 'Every class, whether or not it has room' },
];

const TIMES: { value: TimeOfDay; label: string; name?: string }[] = [
  { value: 'all', label: 'Any', name: 'Any time of day' },
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
        {/* Not a filter dimension like the pickers below — it switches what
            the page is showing you, so it lives with the search and the
            panel toggle rather than inside a row about spot counts. */}
        <button
          type="button"
          onClick={onToggleFavoritesOnly}
          aria-pressed={filters.showFavoritesOnly}
          title="Only the weeks you have starred"
          className={`shrink-0 px-3 py-2 rounded-md text-sm font-medium border transition-all ${
            filters.showFavoritesOnly
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
          }`}
        >
          {`★ ${favoriteCount}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen((wasOpen: boolean) => !wasOpen)}
          aria-expanded={open}
          className="shrink-0 px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </div>

      {!open ? null : (
      <>
      {/* Weeks come from the printed schedule, so all nine stay selectable
          once the season is under way — the catalog remembers a week the
          ticket site has already dropped. Days still come from the sessions
          themselves, where a button that matches nothing is worse than none. */}
      {weeks.length > 0 && (
        <Group label="Week">
          <WeekStrip
            weeks={weeks}
            selected={filters.selectedWeeks}
            onToggle={onToggleWeek}
          />
        </Group>
      )}

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

      <Group label="Availability">
        {AVAILABILITY.map(({ value, label, name, title }) => (
          <Toggle
            key={value}
            segment
            label={label}
            name={name}
            title={title}
            active={filters.availability === value}
            onClick={() => onSetAvailability(value)}
          />
        ))}
      </Group>

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

      <Group label="Time">
        {TIMES.map(({ value, label, name }) => (
          <Toggle
            key={value}
            segment
            label={label}
            name={name}
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
