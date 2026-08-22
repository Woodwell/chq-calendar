#!/usr/bin/env ts-node
/**
 * Reconciles config/SpecialStudies.csv (the pre-season catalog, derived from
 * the printed PDF) against a published classes-<year>.json.
 *
 * Read-only and offline: it makes no requests and writes nothing unless asked.
 * The point is a number you can trust before anything is built on the join.
 *
 * Usage:
 *   ts-node src/scripts/reconcileCatalog.ts
 *   ts-node src/scripts/reconcileCatalog.ts --json=out.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseCsvRecords } from '../utils/parseCsv';
import { reconcileCatalog, type CatalogEntry, type ListedClass } from '../services/classCatalogMatcher';
import type { ClassesFile } from '../types/classes';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : ['', ''];
  }),
);

const year = Number(args.year ?? 2026);
const csvPath = resolve(__dirname, '../../../config/SpecialStudies.csv');
const jsonPath = typeof args.catalog === 'string'
  ? resolve(String(args.catalog))
  : resolve(__dirname, `../../../frontend/public/data/classes-${year}.json`);

// Row 0 is a spanning title row ("Weeks Offered", "Course days and time");
// row 1 carries the real column names.
const rows = parseCsvRecords(readFileSync(csvPath, 'utf8'), 1).filter((r) => r.id && r.Title);

// The printed catalog repeats a class once per category, and carries at least
// one true duplicate. Collapse on everything that identifies an offering, so
// the same class is not counted twice against the site.
const seen = new Map<string, CatalogEntry>();
for (const r of rows) {
  const key = [r.Title, r.Weeks, r['Day/Time'], r.Instructor].join('|').toLowerCase();
  if (!seen.has(key)) seen.set(key, { id: r.id, title: r.Title, instructor: r.Instructor });
}
const catalog = [...seen.values()];

const published = JSON.parse(readFileSync(jsonPath, 'utf8')) as ClassesFile;
const listed: ListedClass[] = published.classes.map((c) => ({
  id: c.id, title: c.title, instructor: c.instructor,
}));

const result = reconcileCatalog(catalog, listed);
const byMethod = result.matches.reduce<Record<string, number>>((acc, m) => {
  acc[m.method] = (acc[m.method] ?? 0) + 1;
  return acc;
}, {});

const listedMatched = new Set(result.matches.map((m) => m.listedId)).size;
const catalogMatched = new Set(result.matches.map((m) => m.catalogId)).size;

console.log(`catalog rows ${rows.length} -> ${catalog.length} distinct offerings`);
console.log(`listed on site ${listed.length}`);
console.log('');
console.log(`matched: ${catalogMatched}/${catalog.length} catalog (${(catalogMatched / catalog.length * 100).toFixed(1)}%), ` +
            `${listedMatched}/${listed.length} listed (${(listedMatched / listed.length * 100).toFixed(1)}%)`);
console.log('  by method:', JSON.stringify(byMethod));
console.log('');
console.log(`catalog only  ${result.catalogOnly.length}  (planned, never listed)`);
console.log(`listed only   ${result.listedOnly.length}  (added after the catalog printed)`);
console.log(`needs review  ${result.needsReview.length}  (plausible, not joined)`);

if (result.needsReview.length) {
  console.log('\n--- needs review ---');
  for (const r of result.needsReview.slice(0, 20)) {
    console.log(`  ${r.similarity}  "${r.catalogTitle.slice(0, 46)}"\n        vs "${r.listedTitle.slice(0, 46)}"`);
  }
}

if (typeof args.json === 'string') {
  writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nwrote ${args.json}`);
}
