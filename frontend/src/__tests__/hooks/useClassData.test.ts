/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/preact';
import { useClassData } from '@/hooks/useClassData';

/** A fetch that serves only the years named, and 404s everything else. */
function serving(years: Record<number, unknown>) {
  return vi.fn((url: string) => {
    const year = Number(/classes-(\d{4})\.json/.exec(url)?.[1]);
    const body = years[year];
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
  });
}

const file = (year: number) => ({
  generatedAt: `${year}-08-20T00:00:00.000Z`,
  year,
  classes: [{ id: 'CHQ.EVN1', title: 'A class' }],
});

describe('useClassData', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('loads the season it was asked for', async () => {
    vi.stubGlobal('fetch', serving({ 2026: file(2026) }));
    const { result } = renderHook(() => useClassData(2026));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.year).toBe(2026);
    expect(result.current.classes).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('falls back a season when the requested one is not published yet', async () => {
    // The season year turns over on 1 October, months before the ticket site
    // lists anything for it. Without this the page read "not available" all
    // winter with the whole previous season sitting on the CDN.
    vi.stubGlobal('fetch', serving({ 2026: file(2026) }));
    const { result } = renderHook(() => useClassData(2027));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.year).toBe(2026);
    expect(result.current.classes).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('gives up after one step back rather than trawling the archive', async () => {
    // Two years back would serve a catalog from a season nobody is asking
    // about, which is worse than saying nothing is there.
    vi.stubGlobal('fetch', serving({ 2025: file(2025) }));
    const { result } = renderHook(() => useClassData(2027));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.classes).toEqual([]);
    expect(result.current.error).toMatch(/2027: 404/);
    expect(result.current.error).toMatch(/2026: 404/);
  });

  it('reports the years it tried when nothing loads', async () => {
    vi.stubGlobal('fetch', serving({}));
    const { result } = renderHook(() => useClassData(2026));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The message names both attempts, so a 404 in the console can be matched
    // to what the page actually asked for.
    expect(result.current.error).toBe('Could not load classes (2026: 404, 2025: 404)');
    expect(result.current.year).toBe(2026);
  });

  it('survives a network failure on the first year and still falls back', async () => {
    const fetchFn = vi.fn((url: string) =>
      /classes-2027/.test(url)
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(file(2026)) } as Response));
    vi.stubGlobal('fetch', fetchFn);
    const { result } = renderHook(() => useClassData(2027));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.year).toBe(2026);
    expect(result.current.error).toBeNull();
  });
});
