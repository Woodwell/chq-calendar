import type { ChqClass, ClassProvenance, ClassSession, ScheduledWeek } from '@/lib/classTypes';
import { useState } from 'react';
import { classWeekKey } from '@/lib/classTypes';
import { isSessionOver } from '@/lib/utils/classFilterHelpers';

/**
 * How a session's availability reads. Spot counts come straight from the
 * ticket site and are a snapshot, not a reservation — the page says when it
 * was taken, and every session links out to the page that actually knows.
 */
function availabilityLabel(session: ClassSession): { text: string; className: string } {
  if (session.availability === 'waitlist') {
    return { text: 'Waitlist', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' };
  }
  if (session.availability === 'open' && session.spotsRemaining !== null) {
    // A single-digit count is the one worth hurrying for, so it reads louder.
    const urgent = session.spotsRemaining <= 5;
    return {
      text: `${session.spotsRemaining} ${session.spotsRemaining === 1 ? 'spot' : 'spots'} left`,
      className: urgent
        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    };
  }
  return { text: 'Check availability', className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' };
}

/**
 * The star for one week of a class.
 *
 * Shared by both kinds of row, and keyed on the week, so a class the ticket
 * site has stopped listing can still be starred from its printed schedule —
 * which is most of the catalog by late August.
 */
function FavoriteStar({ week, isFavorite, onToggle }: {
  week: number;
  isFavorite: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`p-1 rounded-full transition-colors shrink-0 ${
        isFavorite ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
      }`}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-label={`${isFavorite ? 'Remove' : 'Add'} Week ${week} ${isFavorite ? 'from' : 'to'} favorites`}
    >
      <svg className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  );
}

/**
 * A week the class was scheduled for, which the ticket site no longer lists.
 *
 * Shown from the printed catalog so that filtering to a week already past
 * still produces a card that talks about that week. It offers no spot count
 * and no register link, because neither means anything once the week is over
 * — but it can still be starred, since the star is keyed on the week rather
 * than on a session id the catalog never had.
 */
function ScheduledRow({ scheduled, classId, isFavorite, onToggleFavorite, matches }: {
  scheduled: ScheduledWeek;
  classId: string;
  isFavorite: boolean;
  onToggleFavorite: (key: string) => void;
  matches: boolean;
}) {
  const place = [scheduled.location, scheduled.room].filter(Boolean).join(' ');
  const time = scheduled.startTime && scheduled.endTime
    ? `${scheduled.startTime} - ${scheduled.endTime}`
    : scheduled.startTime;

  return (
    <li className={`flex items-start gap-2 py-2 border-t border-gray-100 dark:border-gray-700 first:border-t-0 ${
      matches ? '' : 'opacity-40'
    }`}>
      <FavoriteStar
        week={scheduled.week}
        isFavorite={isFavorite}
        onToggle={() => onToggleFavorite(classWeekKey(classId, scheduled.week))}
      />

      <div className="flex-1 min-w-0 text-sm">
        <div className="text-gray-900 dark:text-gray-100">
          <span className="font-medium">Week {scheduled.week}</span>
        </div>
        <div className="text-gray-500 dark:text-gray-400 text-xs">
          {scheduled.daysOfWeek.join(', ')}
          {time && <> · {time}</>}
          {place && <> · 📍 {place}</>}
        </div>
      </div>

      <span className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
        Over
      </span>
    </li>
  );
}

interface SessionRowProps {
  session: ClassSession;
  classId: string;
  registerUrl: string;
  /**
   * The session has already run. The ticket site keeps one listed for days
   * afterwards, spot count and all, so without this the card offers a
   * Register button for a class that is over.
   */
  isOver: boolean;
  isFavorite: boolean;
  onToggleFavorite: (key: string) => void;
  /** False when filters are active and this session is not one of the matches. */
  matches: boolean;
}

function SessionRow({ session, classId, registerUrl, isOver, isFavorite, onToggleFavorite, matches }: SessionRowProps) {
  const badge = isOver
    ? { text: 'Over', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
    : availabilityLabel(session);
  const key = classWeekKey(classId, session.week);

  return (
    <li className={`flex items-start gap-2 py-2 border-t border-gray-100 dark:border-gray-700 first:border-t-0 ${
      matches ? '' : 'opacity-40'
    }`}>
      <FavoriteStar week={session.week} isFavorite={isFavorite} onToggle={() => onToggleFavorite(key)} />

      <div className="flex-1 min-w-0 text-sm">
        <div className="text-gray-900 dark:text-gray-100">
          <span className="font-medium">Week {session.week}</span>
          <span className="text-gray-500 dark:text-gray-400"> · {session.dateRangeLabel}</span>
        </div>
        <div className="text-gray-500 dark:text-gray-400 text-xs">
          {session.daysOfWeek.join(', ')} · {session.timeRangeLabel}
          {session.location && <> · 📍 {session.location}</>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
          {badge.text}
        </span>
        {!isOver && (
          <a
            href={registerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Register
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * The price, without the ticket site's "Sessions:" prefix.
 *
 * The site labels every price "Sessions: $145.00", which next to the class's
 * own session rows reads as a count rather than a price. The catalog's plain
 * "$145" is preferred where there is one; otherwise the prefix is dropped and
 * a trailing ".00" with it, since no fee in the catalog has cents.
 */
export function priceText(chqClass: ChqClass): string {
  if (chqClass.fee) return chqClass.fee;
  return (chqClass.priceLabel || '')
    .replace(/^\s*sessions?\s*:\s*/i, '')
    .replace(/\.00\b/g, '')
    .trim();
}

/** One line on the card: a live session where there is one, else the plan. */
type ScheduleRow =
  | { session: ClassSession; scheduled?: undefined }
  | { session?: undefined; scheduled: ScheduledWeek };

/**
 * Every week the class runs, in order, each shown from the best source.
 *
 * The ticket site drops a session once its week is over, so late in the
 * season a card built from sessions alone talks only about the weeks still to
 * come — which reads as nonsense next to a filter set to week 2. Weeks the
 * crawl can still see keep their live detail and spot count; the rest fall
 * back to the schedule the catalog printed.
 */
export function scheduleRows(chqClass: ChqClass, selectedWeeks: number[] = []): ScheduleRow[] {
  const bySession = new Map(chqClass.sessions.map((s) => [s.week, s]));
  const scheduled = new Map((chqClass.scheduledWeeks ?? []).map((w) => [w.week, w]));
  // Newest first: what is still to come is what someone can act on, and by
  // late August the weeks already gone outnumber it eight to one.
  const weeks = [...new Set([...bySession.keys(), ...scheduled.keys()])].sort((a, b) => b - a);

  // Filtering to a week is a question about that week. A class running all
  // nine would otherwise answer with seven rows nobody asked about, so the
  // finished weeks outside the selection are dropped — but every week with a
  // live session stays, because "and what can I still join?" is the other
  // half of the same question.
  const inScope = selectedWeeks.length === 0
    ? weeks
    : weeks.filter((w) => selectedWeeks.includes(w) || bySession.has(w));

  return inScope.map((week) => {
    const session = bySession.get(week);
    if (session) return { session };
    return { scheduled: scheduled.get(week)! };
  });
}

interface ClassCardProps {
  chqClass: ChqClass;
  isExpanded: boolean;
  onToggleDescription: (classId: string) => void;
  isFavorite: (key: string) => boolean;
  onToggleFavorite: (key: string) => void;
  /**
   * Whether a session survives the active filters. Non-matching sessions are
   * dimmed rather than removed: someone filtering to Week 8 still wants to
   * see that the class also runs in Week 9, and hiding it would make a
   * two-session class look like a one-session class.
   */
  sessionMatches?: (session: ClassSession) => boolean;
  /**
   * Whether a week the catalog printed survives the active filters. Separate
   * from `sessionMatches` because there is no session to hand it — the
   * printed schedule answers day, time and meeting length, but never
   * availability.
   */
  scheduledMatches?: (scheduled: ScheduledWeek) => boolean;
  /**
   * Weeks the reader has filtered to. Narrows which rows the card draws at
   * all, rather than only which are dimmed.
   */
  selectedWeeks?: number[];
  /**
   * The Institution's date, YYYY-MM-DD. Supplied by the caller so it is read
   * once per render rather than once per session row.
   */
  todayKey?: string;
}

/**
 * Says why a class has nothing to book, when the reason is not simply that
 * the season moved on.
 *
 * The distinction is the point: `cancelled` means the crawl looked for a
 * class scheduled ahead of it and did not find it. `unobserved` means the
 * class had already finished by the time anything looked, so nothing can be
 * concluded — it is shown as a record, not as a claim.
 */
function ProvenanceNote({ provenance }: { provenance: ClassProvenance }) {
  if (provenance.status === 'listed') return null;

  const cancelled = provenance.status === 'cancelled';
  return (
    <p className="mt-1">
      <span
        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
          cancelled
            ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        }`}
      >
        {cancelled ? 'Cancelled' : 'Not listed online'}
      </span>
      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
        {cancelled
          ? 'Was in the printed catalog; the ticket site no longer lists it.'
          : 'From the printed catalog. It had already finished when we looked, so we cannot tell whether it ran.'}
      </span>
    </p>
  );
}

/** Whether a row is finished: no session left, or one that has already run. */
export function isRowPast(row: ScheduleRow, todayKey?: string): boolean {
  if (!row.session) return true;
  return todayKey ? isSessionOver(row.session, todayKey) : false;
}

export function ClassCard({
  chqClass, isExpanded, onToggleDescription, isFavorite, onToggleFavorite,
  sessionMatches, scheduledMatches, selectedWeeks = [], todayKey,
}: ClassCardProps) {
  const rows = scheduleRows(chqClass, selectedWeeks);
  const [showPast, setShowPast] = useState(false);

  // Finished weeks are folded away, except any that is starred — a star is
  // someone saying they want to keep seeing it, and hiding it behind a
  // disclosure would make their own mark invisible.
  const isStarred = (row: ScheduleRow) => isFavorite(
    classWeekKey(chqClass.id, row.session ? row.session.week : row.scheduled.week),
  );
  const past = rows.filter((r) => isRowPast(r, todayKey) && !isStarred(r));
  const kept = rows.filter((r) => !past.includes(r));

  return (
    <article className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
            {/* A class only in the printed catalog has no page to link to.
                Rendering an empty href would navigate to this page instead. */}
            {chqClass.sourceUrl ? (
              <a href={chqClass.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {chqClass.title}
              </a>
            ) : (
              chqClass.title
            )}
          </h2>
          <ProvenanceNote provenance={chqClass.provenance} />
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {chqClass.instructor && <>{chqClass.instructor} · </>}
            {chqClass.ageRangeText}
            {priceText(chqClass) && <> · {priceText(chqClass)}</>}
          </p>
          {chqClass.categories.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {chqClass.categories.map((category) => (
                <span
                  key={category}
                  className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                >
                  {category}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      {chqClass.description && (
        <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
          {/* The catalog publishes plain text with its line breaks kept, so
              it renders as written without any markup being injected. */}
          <p className={`whitespace-pre-line ${isExpanded ? '' : 'line-clamp-3'}`}>
            {chqClass.description}
          </p>
          <button
            type="button"
            onClick={() => onToggleDescription(chqClass.id)}
            className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      )}

      <div className="mt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No schedule recorded for this class.
          </p>
        ) : (
          <ul>
            {(showPast ? rows : kept).map((row) => (row.session ? (
              <SessionRow
                key={row.session.performanceId}
                session={row.session}
                classId={chqClass.id}
                registerUrl={chqClass.sourceUrl}
                isOver={todayKey ? isSessionOver(row.session, todayKey) : false}
                isFavorite={isFavorite(classWeekKey(chqClass.id, row.session.week))}
                onToggleFavorite={onToggleFavorite}
                matches={sessionMatches ? sessionMatches(row.session) : true}
              />
            ) : (
              <ScheduledRow
                key={`week-${row.scheduled.week}`}
                scheduled={row.scheduled}
                classId={chqClass.id}
                isFavorite={isFavorite(classWeekKey(chqClass.id, row.scheduled.week))}
                onToggleFavorite={onToggleFavorite}
                matches={scheduledMatches ? scheduledMatches(row.scheduled) : true}
              />
            )))}
          </ul>
        )}

        {past.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showPast
              ? 'Hide finished weeks'
              : `Show ${past.length} finished ${past.length === 1 ? 'week' : 'weeks'}`}
          </button>
        )}
      </div>
    </article>
  );
}
