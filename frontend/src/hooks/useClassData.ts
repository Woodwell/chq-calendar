import { useEffect, useState } from 'react';
import type { ChqClass, ClassesFile } from '@/lib/classTypes';

interface ClassData {
  classes: ChqClass[];
  /** When the catalog was crawled, for the "updated" note on the page. */
  generatedAt: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the published class catalog.
 *
 * Its own fetch rather than GlobalEventDataProvider: that context carries the
 * calendar's event feed, which this page never reads, and classes come from a
 * different file with a different refresh rhythm.
 */
export function useClassData(year: number): ClassData {
  const [state, setState] = useState<ClassData>({
    classes: [], generatedAt: null, loading: true, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    // In dev the catalog is written to frontend/public/data by
    // `npm run sync:classes`; in production it is on the CDN.
    const base = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';

    fetch(`${base}/classes-${year}.json`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load classes (${res.status})`);
        return (await res.json()) as ClassesFile;
      })
      .then((file) => {
        if (cancelled) return;
        setState({
          classes: file.classes ?? [],
          generatedAt: file.generatedAt ?? null,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          classes: [], generatedAt: null, loading: false,
          error: err instanceof Error ? err.message : 'Could not load classes',
        });
      });

    return () => { cancelled = true; };
  }, [year]);

  return state;
}
