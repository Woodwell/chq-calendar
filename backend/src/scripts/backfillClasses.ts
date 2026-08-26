#!/usr/bin/env ts-node
/**
 * Merge the printed catalog into an already-crawled classes-<year>.json,
 * offline.
 *
 * This is the backfill without the crawl: it makes no network requests, so it
 * can be run repeatedly while the join is being tuned, and it works
 * off-season when the ticket site has nothing to say. The crawl half is
 * `sync:classes`; this is everything that happens after it.
 *
 * Usage:
 *   npm run backfill:classes                      # report only, writes nothing
 *   npm run backfill:classes -- --write           # rewrite the file in place
 *   npm run backfill:classes -- --out=/tmp/x.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { catalogForSeason } from '../services/seasonCatalog';
import { mergeCatalog, type CrawledClass } from '../services/classCatalogMerge';
import { institutionDateKey, institutionSeasonYear } from '../services/classesIngestRunner';
import type { ChqClass, ClassesFile } from '../types/classes';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : ['', ''];
  }),
) as Record<string, string | boolean | undefined>;

const year = Number(args.year ?? institutionSeasonYear(new Date()));
const inPath = typeof args.in === 'string'
  ? resolve(args.in)
  : resolve(__dirname, `../../../frontend/public/data/classes-${year}.json`);
const outPath = typeof args.out === 'string' ? resolve(args.out) : inPath;

/**
 * The crawl date.
 *
 * Taken from the file's own `generatedAt`, not from today: the temporal rule
 * turns on when the crawl happened, and re-running this script a week later
 * must not start reclassifying classes as cancelled on the strength of a
 * crawl that never looked for them.
 */
function crawlDateOf(file: ClassesFile): string {
  const stamp = file.generatedAt ? new Date(file.generatedAt) : new Date();
  const at = Number.isNaN(stamp.getTime()) ? new Date() : stamp;
  // The same reading the Lambda takes. Anything else — UTC, most obviously —
  // dates an Eastern evening crawl to the following day, and the temporal
  // rule compares that date against a week's end to decide `cancelled` from
  // `unobserved`. Merging offline must not reach a different verdict from
  // merging in the pipeline.
  return institutionDateKey(at);
}

/** Strip any previous merge, so re-running is idempotent rather than cumulative. */
function asCrawled(c: ChqClass): CrawledClass {
  const {
    catalogId: _catalogId, categories: _categories, materials: _materials,
    fee: _fee, room: _room, provenance: _provenance, ...crawled
  } = c as ChqClass;
  return crawled;
}

function main(): void {
  const catalog = catalogForSeason(year);
  const file = JSON.parse(readFileSync(inPath, 'utf8')) as ClassesFile;

  // Only classes the crawl actually returned are input. Catalog-only records
  // from an earlier merge are re-derived, never fed back in as listings.
  const previous = file.classes;
  const listed = previous
    .filter((c) => (c.provenance?.status ?? 'listed') === 'listed')
    .map(asCrawled);

  const crawlDate = crawlDateOf(file);
  const { classes, summary } = mergeCatalog({ catalog, listed, previous, crawlDate });

  console.log(`catalog      ${catalog?.classes.length ?? 0} classes, compiled for season ${year}`);
  console.log(`crawl        ${listed.length} listings, crawled ${crawlDate}`);
  console.log('');
  console.log(`matched      ${summary.matched} listings joined to a catalog row`);
  console.log(`listed only  ${summary.listedOnly} (added after the catalog printed)`);
  console.log(`unobserved   ${summary.unobserved} (finished before the crawl — unknowable)`);
  console.log(`cancelled    ${summary.cancelled} (scheduled ahead, and gone)`);
  console.log('');
  console.log(`published    ${classes.length} classes total`);

  const withCategories = classes.filter((c) => c.categories.length > 0).length;
  console.log(`             ${withCategories} carry a category, ${classes.length - withCategories} do not`);

  if (args.write || typeof args.out === 'string') {
    const merged: ClassesFile = { ...file, classes };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`\nwrote ${outPath}`);
  } else {
    console.log('\n(report only — pass --write to update the file)');
  }
}

main();
