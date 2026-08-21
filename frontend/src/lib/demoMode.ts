/**
 * Demo builds: a preview of unreleased work, served somewhere other than
 * www.chqcal.org for early comment.
 *
 * Turned on by building with VITE_DEMO=true (`npm run build:demo`), so a
 * normal production build carries none of it. Two things depend on it — a
 * link to /classes from the calendar's menu, which is deliberately absent
 * from shared/links.json until the page is real, and a banner on /classes
 * saying what this is and how old it is.
 */

export const isDemoBuild = import.meta.env.VITE_DEMO === 'true';

export interface BuildInfo {
  /** Short git SHA of the commit built, or a timestamp when git is absent. */
  version: string;
  /** ISO timestamp of the build itself. */
  builtAt: string;
}

export const buildInfo: BuildInfo = {
  version: import.meta.env.VITE_APP_VERSION ?? 'unknown',
  builtAt: import.meta.env.VITE_BUILD_TIME ?? '',
};

/** "21 Aug 2026, 14:32" — short, unambiguous, and not locale-dependent. */
export function formatBuildTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
