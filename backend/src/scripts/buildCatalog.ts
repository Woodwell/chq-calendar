#!/usr/bin/env ts-node
/**
 * Compiles the season catalog once, so nothing downstream has to.
 *
 * Reads the hand-made CSV and one crawl snapshot, resolves the fuzzy join
 * between them, derives the season's week calendar, and writes
 * `src/data/catalog-<year>.json` — which is checked in and bundled into the
 * Lambda, so the ingest pipeline never parses a CSV or matches a title again.
 *
 * Run it when the catalog changes, which is about once a year. Read the
 * report it prints before committing the result: the join is the part a
 * machine can get wrong, and this is the moment a human can see it.
 *
 * Usage:
 *   npm run build:catalog
 *   npm run build:catalog -- --year=2026
 *   npm run build:catalog -- --crawl=/path/to/classes-2026.json
 *   npm run build:catalog -- --check     # fail if the output would change
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parseCatalog } from '../services/classCatalog';
import { reconcileCatalog, type CatalogEntry, type ListedClass } from '../services/classCatalogMatcher';
import type { CatalogClass, CatalogFile, CatalogWeekRange } from '../types/catalog';
import type { ClassesFile } from '../types/classes';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : ['', ''];
  }),
) as Record<string, string | boolean | undefined>;

const REPO = resolve(__dirname, '../../..');
const year = Number(args.year ?? 2026);
const csvPath = typeof args.csv === 'string' ? resolve(args.csv) : `${REPO}/config/SpecialStudies.csv`;
const crawlPath = typeof args.crawl === 'string'
  ? resolve(args.crawl)
  : `${REPO}/frontend/public/data/classes-${year}.json`;
const outPath = typeof args.out === 'string'
  ? resolve(args.out)
  : resolve(__dirname, `../data/catalog-${year}.json`);

/** Paths as they read in the file, so provenance survives a different machine. */
const relative = (p: string): string => p.startsWith(REPO) ? p.slice(REPO.length + 1) : p;

/**
 * The season calendar, from the crawl's own sessions.
 *
 * A week's dates are a fixed fact about the year, but a crawl late in the
 * season can only date the weeks it still lists — one in nine, by late
 * August. The season is nine consecutive weeks, so the rest follow at seven
 * days each from any week that was observed.
 */
function seasonWeeks(listed: ClassesFile['classes']): Record<string, CatalogWeekRange> {
  const observed = new Map<number, CatalogWeekRange>();
  for (const c of listed) {
    for (const s of c.sessions) {
      const start = s.startDate.slice(0, 10);
      const end = s.endDate.slice(0, 10);
      if (!start || !end) continue; // an unparseable session dates nothing
      const known = observed.get(s.week);
      if (!known) { observed.set(s.week, [start, end]); continue; }
      if (start < known[0]) known[0] = start;
      if (end > known[1]) known[1] = end;
    }
  }
  // Week 0 is the scraper's sentinel for an unreadable week label. It is not a
  // season week, and anchoring on it would misdate all nine.
  observed.delete(0);

  const anchorWeek = [...observed.keys()].filter((w) => w >= 1 && w <= 9).sort((a, b) => a - b)[0];
  if (anchorWeek === undefined) {
    throw new Error(
      `[catalog] no session in ${relative(crawlPath)} dates any season week, so the ` +
      'calendar cannot be established. Build from a crawl taken during the season.',
    );
  }

  const shift = (key: string, days: number): string => {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const anchor = observed.get(anchorWeek)!;
  const weeks: Record<string, CatalogWeekRange> = {};
  for (let w = 1; w <= 9; w++) {
    const seen = observed.get(w);
    const offset = (w - anchorWeek) * 7;
    weeks[String(w)] = seen ?? [shift(anchor[0], offset), shift(anchor[1], offset)];
  }
  return weeks;
}

function main(): void {
  const rows = parseCatalog(readFileSync(csvPath, 'utf8'));
  if (rows.length === 0) throw new Error(`[catalog] ${relative(csvPath)} parsed to zero classes`);

  const crawl = JSON.parse(readFileSync(crawlPath, 'utf8')) as ClassesFile;
  // Only what the site itself listed. A previous merge may have left
  // catalog-only records in the file; feeding those back would match the
  // catalog against itself.
  const listed = crawl.classes.filter((c) => !c.id.startsWith('catalog:'));

  const catalogEntries: CatalogEntry[] = rows.map((r) => ({
    id: r.id, title: r.title, instructor: r.instructor,
  }));
  const listedEntries: ListedClass[] = listed.map((c) => ({
    id: c.id, title: c.title, instructor: c.instructor,
  }));
  const rec = reconcileCatalog(catalogEntries, listedEntries);

  const eventAksFor = new Map<string, string[]>();
  for (const m of rec.matches) {
    eventAksFor.set(m.catalogId, [...(eventAksFor.get(m.catalogId) ?? []), m.listedId]);
  }

  const classes: CatalogClass[] = rows.map((r) => ({
    id: r.id,
    eventAks: (eventAksFor.get(r.id) ?? []).sort(),
    title: r.title,
    instructor: r.instructor,
    description: r.description,
    categories: r.categories,
    ageRange: r.ageRange,
    caregiver: r.caregiver,
    fee: r.fee,
    materials: r.materials,
    location: r.location,
    room: r.room,
    weeks: r.weeks,
    daysOfWeek: r.daysOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
  }));

  const file: CatalogFile = {
    season: year,
    generatedAt: new Date().toISOString(),
    source: {
      catalog: relative(csvPath),
      crawl: relative(crawlPath),
      crawledAt: crawl.generatedAt,
    },
    weeks: seasonWeeks(listed),
    classes,
    listedOnly: rec.listedOnly.map((l) => l.id).sort(),
    needsReview: rec.needsReview.map((n) => ({
      catalogId: n.catalogId,
      catalogTitle: n.catalogTitle,
      eventAk: n.listedId,
      listedTitle: n.listedTitle,
      similarity: n.similarity ?? 0,
    })),
  };

  const matched = classes.filter((c) => c.eventAks.length > 0).length;
  console.log(`catalog     ${classes.length} classes from ${relative(csvPath)}`);
  console.log(`crawl       ${listed.length} listings from ${relative(crawlPath)} (${crawl.generatedAt})`);
  console.log('');
  console.log(`joined      ${rec.matches.length} listings to ${matched} catalog rows`);
  console.log(`unmatched   ${classes.length - matched} catalog rows the crawl did not list`);
  console.log(`listed only ${file.listedOnly.length} listings with no catalog row`);
  console.log(`for review  ${file.needsReview.length} plausible pairs the join declined`);
  for (const n of file.needsReview) {
    console.log(`   ${n.similarity.toFixed(2)}  ${n.catalogTitle}  ~  ${n.listedTitle}`);
  }
  console.log('');
  console.log('season weeks:');
  for (let w = 1; w <= 9; w++) console.log(`   week ${w}  ${file.weeks[String(w)].join('  ..  ')}`);

  // `generatedAt` moves every run, so --check compares everything else. It is
  // the difference between "the catalog changed" and "the clock did".
  const body = (f: CatalogFile) => JSON.stringify({ ...f, generatedAt: '' }, null, 2);
  if (args.check) {
    const existing = JSON.parse(readFileSync(outPath, 'utf8')) as CatalogFile;
    if (body(existing) !== body(file)) {
      console.error(`\n[catalog] ${relative(outPath)} is out of date — run npm run build:catalog`);
      process.exit(1);
    }
    console.log(`\n${relative(outPath)} is up to date`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\nwrote ${relative(outPath)}`);
}

main();
