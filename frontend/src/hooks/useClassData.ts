import { useEffect, useState } from 'react';
import type { ChqClass, ClassesFile } from '@/lib/classTypes';

interface ClassData {
  classes: ChqClass[];
  /** When the catalog was crawled, for the "updated" note on the page. */
  generatedAt: string | null;
  /**
   * The season actually loaded, which is not always the one asked for — see
   * the fallback below. The page says so when they differ, rather than
   * presenting last season's classes as this one's.
   */
  year: number;
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
    classes: [], generatedAt: null, year, loading: true, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    // In dev the catalog is written to frontend/public/data by
    // `npm run sync:classes`; in production it is on the CDN.
    const base = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';

    /**
     * The season asked for, then the one before it.
     *
     * The season year turns over on 1 October, months before the ticket site
     * lists anything for it — so from October until the following summer the
     * requested file does not exist, and asking only for it left the page
     * reading "not available" all winter with the complete previous season
     * sitting on the CDN. Falling back one year shows that season instead,
     * which is the honest answer to "what were the classes?" out of season.
     *
     * One step back only. Two would mean serving a catalog from a season
     * nobody is asking about.
     */
    const load = async (): Promise<{ file: ClassesFile; year: number }> => {
      const errors: string[] = [];
      for (const candidate of [year, year - 1]) {
        try {
          const res = await fetch(`${base}/classes-${candidate}.json`, {
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) { errors.push(`${candidate}: ${res.status}`); continue; }
          return { file: (await res.json()) as ClassesFile, year: candidate };
        } catch (err) {
          errors.push(`${candidate}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      throw new Error(`Could not load classes (${errors.join(', ')})`);
    };

    load()
      .then(({ file, year: loadedYear }) => {
        if (cancelled) return;
        setState({
          classes: file.classes ?? [],
          generatedAt: file.generatedAt ?? null,
          year: loadedYear,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          classes: [], generatedAt: null, year, loading: false,
          error: err instanceof Error ? err.message : 'Could not load classes',
        });
      });

    return () => { cancelled = true; };
  }, [year]);

  return state;
}
