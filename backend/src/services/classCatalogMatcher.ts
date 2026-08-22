/**
 * Joins the pre-season Special Studies catalog to what tickets.chq.org
 * actually lists.
 *
 * The two sides share no identifier. The catalog numbers its rows 1..493; the
 * site keys on `eventAk` (CHQ.EVN1687). Title is the only bridge, and it is a
 * poor one on its own: neither side treats a title as unique, and the same
 * class is often worded differently in each.
 *
 * So this matches in tiers, strongest evidence first, and never guesses. What
 * it cannot resolve confidently it reports rather than joining — a wrong join
 * silently attaches one class's description to another, which is worse than a
 * gap somebody can see.
 */

export interface CatalogEntry {
  /** Row id from the catalog, unique within it. */
  id: string;
  title: string;
  instructor: string;
}

export interface ListedClass {
  /** eventAk, e.g. "CHQ.EVN1687". */
  id: string;
  title: string;
  instructor: string;
}

export type MatchMethod = 'exact' | 'offering' | 'instructor' | 'fuzzy';

export interface CatalogMatch {
  catalogId: string;
  listedId: string;
  method: MatchMethod;
  /** Filled for `fuzzy`, so a reviewer can sort by how sure the match is. */
  similarity?: number;
}

export interface CatalogReconciliation {
  matches: CatalogMatch[];
  /** In the pre-season catalog, never listed: cancelled, renamed, or missed. */
  catalogOnly: CatalogEntry[];
  /** Listed but not in the catalog: added after it went to print. */
  listedOnly: ListedClass[];
  /** Plausible but not certain. Deliberately not joined — read these. */
  needsReview: Array<CatalogMatch & { catalogTitle: string; listedTitle: string }>;
}

/**
 * Titles reduced to comparable text.
 *
 * The acronym rule earns its place: the catalog writes "The US and Europe"
 * where the site writes "The U.S. and Europe", and stripping punctuation
 * naively turns those into "us" and "u s" — a non-match on two strings a
 * reader would call identical.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\b([a-z])\./g, '$1') // u.s. -> us, ph.d. -> phd
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Splits off the suffix the site uses to name one offering of a class —
 * ": Wednesday Session", ": Weeks 4 and 5".
 *
 * This is a discriminator, not noise. The catalog carries
 * "Non-Traditional Watercolor: Monday Session" and "…: Tuesday Session" as
 * genuinely different classes at different times, so the suffix is only
 * discarded when matching a *bare* catalog title against a suffixed listing,
 * never to decide two suffixed titles are the same thing.
 */
export function splitOfferingSuffix(title: string): { base: string; suffix: string | null } {
  const m = /^(.*?)[:\-–—]\s*((?:mon|tues|wednes|thurs|fri|satur|sun)day\s+session|weeks?\b.*|session)$/i
    .exec(title.trim());
  if (!m) return { base: normalizeTitle(title), suffix: null };
  return { base: normalizeTitle(m[1]), suffix: m[2].toLowerCase() };
}

/** Surname, for disambiguating two same-titled classes. */
function surname(instructor: string): string {
  const first = instructor.split(/[,&]| and /i)[0].trim();
  const parts = normalizeTitle(first).split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** Dice coefficient over word sets — 1 is identical, 0 shares nothing. */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/** Above this, a fuzzy pair is worth a human's attention; below, it is noise. */
const FUZZY_FLOOR = 0.6;
/** At or above this, and with the instructor agreeing, treat it as a match. */
const FUZZY_ACCEPT = 0.8;

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    (out.get(k) ?? out.set(k, []).get(k)!).push(item);
  }
  return out;
}

export function reconcileCatalog(
  catalog: CatalogEntry[],
  listed: ListedClass[],
): CatalogReconciliation {
  const matches: CatalogMatch[] = [];
  const needsReview: CatalogReconciliation['needsReview'] = [];
  const catalogLeft = new Map(catalog.map((c) => [c.id, c]));
  const listedLeft = new Map(listed.map((l) => [l.id, l]));

  const take = (c: CatalogEntry, l: ListedClass, method: MatchMethod, similarity?: number) => {
    matches.push({ catalogId: c.id, listedId: l.id, method, ...(similarity ? { similarity } : {}) });
    listedLeft.delete(l.id);
  };

  // 1. Identical titles. Only when unambiguous on the listing side: two
  //    classes sharing a title are a question, not an answer.
  const byExact = groupBy([...listedLeft.values()], (l) => normalizeTitle(l.title));
  for (const c of [...catalogLeft.values()]) {
    const hits = (byExact.get(normalizeTitle(c.title)) ?? []).filter((l) => listedLeft.has(l.id));
    if (hits.length === 1) { take(c, hits[0], 'exact'); catalogLeft.delete(c.id); }
  }

  // 2. A bare catalog title against the site's per-offering listings. One
  //    catalog row legitimately becomes several listings here, so every
  //    remaining candidate is claimed rather than just the first.
  //
  //    Only listings that actually carry a suffix are eligible. Without that
  //    restriction this tier re-runs tier 1 with the ambiguity removed by
  //    force: two same-titled classes both look like "offerings" of the
  //    catalog row and both get claimed, when what is needed is to fall
  //    through and let the instructor decide.
  const byBase = groupBy(
    [...listedLeft.values()].filter((l) => splitOfferingSuffix(l.title).suffix !== null),
    (l) => splitOfferingSuffix(l.title).base,
  );
  for (const c of [...catalogLeft.values()]) {
    if (splitOfferingSuffix(c.title).suffix) continue; // a suffixed catalog title must match exactly
    const hits = (byBase.get(normalizeTitle(c.title)) ?? []).filter((l) => listedLeft.has(l.id));
    if (hits.length > 0) {
      for (const l of hits) take(c, l, 'offering');
      catalogLeft.delete(c.id);
    }
  }

  // 3. Same title on both sides but more than one candidate: let the
  //    instructor decide.
  for (const c of [...catalogLeft.values()]) {
    const hits = (byExact.get(normalizeTitle(c.title)) ?? []).filter((l) => listedLeft.has(l.id));
    const byTeacher = hits.filter((l) => surname(l.instructor) && surname(l.instructor) === surname(c.instructor));
    if (byTeacher.length === 1) { take(c, byTeacher[0], 'instructor'); catalogLeft.delete(c.id); }
  }

  // 4. Renames. Accepted only when the wording is close AND the instructor
  //    agrees; anything merely plausible is handed to a reviewer.
  for (const c of [...catalogLeft.values()]) {
    let best: { l: ListedClass; score: number } | null = null;
    for (const l of listedLeft.values()) {
      const score = titleSimilarity(c.title, l.title);
      if (!best || score > best.score) best = { l, score };
    }
    if (!best || best.score < FUZZY_FLOOR) continue;
    const sameTeacher = surname(c.instructor) !== '' && surname(c.instructor) === surname(best.l.instructor);
    if (best.score >= FUZZY_ACCEPT && sameTeacher) {
      take(c, best.l, 'fuzzy', Number(best.score.toFixed(2)));
      catalogLeft.delete(c.id);
    } else {
      needsReview.push({
        catalogId: c.id, listedId: best.l.id, method: 'fuzzy',
        similarity: Number(best.score.toFixed(2)),
        catalogTitle: c.title, listedTitle: best.l.title,
      });
    }
  }

  return {
    matches,
    catalogOnly: [...catalogLeft.values()],
    listedOnly: [...listedLeft.values()],
    needsReview: needsReview.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)),
  };
}
