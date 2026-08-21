import type { ChqClass, ClassSession } from '@/lib/classTypes';
import { classSessionKey } from '@/lib/classTypes';

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

interface SessionRowProps {
  session: ClassSession;
  classId: string;
  registerUrl: string;
  isFavorite: boolean;
  onToggleFavorite: (key: string) => void;
  /** False when filters are active and this session is not one of the matches. */
  matches: boolean;
}

function SessionRow({ session, classId, registerUrl, isFavorite, onToggleFavorite, matches }: SessionRowProps) {
  const badge = availabilityLabel(session);
  const key = classSessionKey(classId, session.performanceId);

  return (
    <li className={`flex items-start gap-2 py-2 border-t border-gray-100 dark:border-gray-700 first:border-t-0 ${
      matches ? '' : 'opacity-40'
    }`}>
      <button
        type="button"
        onClick={() => onToggleFavorite(key)}
        className={`p-1 rounded-full transition-colors shrink-0 ${
          isFavorite ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
        }`}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={`${isFavorite ? 'Remove' : 'Add'} Week ${session.week} session ${isFavorite ? 'from' : 'to'} favorites`}
      >
        <svg className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

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
        <a
          href={registerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Register
        </a>
      </div>
    </li>
  );
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
}

export function ClassCard({ chqClass, isExpanded, onToggleDescription, isFavorite, onToggleFavorite, sessionMatches }: ClassCardProps) {
  const { sessions } = chqClass;

  return (
    <article className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
            <a href={chqClass.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {chqClass.title}
            </a>
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {chqClass.instructor && <>{chqClass.instructor} · </>}
            {chqClass.ageRangeText}
            {chqClass.priceLabel && <> · {chqClass.priceLabel}</>}
          </p>
          {chqClass.subjects.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {chqClass.subjects.map((subject) => (
                <span
                  key={subject}
                  className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                >
                  {subject}
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
        {sessions.length === 0 ? (
          // Sessions disappear from the ticket site once their week is over,
          // so this is what a finished class looks like, not an error.
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No sessions remaining this season.
          </p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <SessionRow
                key={session.performanceId}
                session={session}
                classId={chqClass.id}
                registerUrl={chqClass.sourceUrl}
                isFavorite={isFavorite(classSessionKey(chqClass.id, session.performanceId))}
                onToggleFavorite={onToggleFavorite}
                matches={sessionMatches ? sessionMatches(session) : true}
              />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
