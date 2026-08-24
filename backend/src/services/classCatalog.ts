/**
 * The pre-season Special Studies catalog, read from config/SpecialStudies.csv.
 *
 * That file is a transcription of the PDF Chautauqua publishes before the
 * season, and it carries what the ticket site never exposes: ages as numbers,
 * an editorial category, fees split from materials fees, location split from
 * room, and the intended schedule as booleans rather than prose.
 *
 * It describes the season as planned. It cannot know what actually happened —
 * that is the crawl's job — so nothing here is treated as evidence about
 * whether a class ran. See classCatalogMatcher for the join and
 * classesIngestRunner for how the two sources are given authority.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseCsvRecords } from '../utils/parseCsv';
import type { ClassAgeRange } from '../types/classes';

/** Materials a class needs, and who is expected to bring them. */
export interface CatalogMaterials {
  /** Extra fee for materials, as printed, e.g. "$20". Empty when none. */
  fee: string;
  /** The student brings their own materials. */
  student: boolean;
  /** The instructor supplies them. */
  instructor: boolean;
}

/** One class as the printed catalog describes it. */
export interface CatalogClass {
  /** Row id from the catalog. Unique within it; unrelated to the site's ids. */
  id: string;
  title: string;
  instructor: string;
  description: string;
  /**
   * Every category the class is printed under, in the catalog's own
   * vocabulary — which is the vocabulary a reader holding the PDF sees.
   *
   * "Youth" is a category here, and that is deliberate: it names 24 rows the
   * programme groups as youth offerings. It is not the site's "Youth"
   * subject, which is applied to 355 of 466 classes as a de facto age flag.
   * Same word, different thing — the age flag lives in `ageRange`.
   */
  categories: string[];
  ageRange: ClassAgeRange;
  /** True when the class admits a child accompanied by an adult. */
  caregiver: boolean;
  /** Tuition as printed, e.g. "$115". */
  fee: string;
  materials: CatalogMaterials;
  location: string;
  /** Room within the location; empty for venues that do not subdivide. */
  room: string;
  /** Season weeks the class is scheduled for, ascending. */
  weeks: number[];
  /** Full day names, Monday-first. */
  daysOfWeek: string[];
  /** As printed, e.g. "4:30 PM". Empty when the catalog leaves it blank. */
  startTime: string;
  endTime: string;
}

/** The catalog writes booleans as the literal strings TRUE and FALSE. */
const isTrue = (v: string | undefined): boolean => (v ?? '').trim().toUpperCase() === 'TRUE';

const DAY_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'],
  ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday'],
];

function weeksOf(row: Record<string, string>): number[] {
  const weeks: number[] = [];
  for (let w = 1; w <= 9; w++) if (isTrue(row[`W${w}`])) weeks.push(w);
  return weeks;
}

function daysOf(row: Record<string, string>): string[] {
  return DAY_COLUMNS.filter(([col]) => isTrue(row[col])).map(([, name]) => name);
}

/**
 * Ages as numbers.
 *
 * `Max Age` is blank on 468 of 492 rows, which means "no upper bound" rather
 * than "unknown" — the catalog prints a maximum only where one applies. A
 * blank `Min Age` (6 rows) is treated the same way, as unbounded below.
 */
function ageRangeOf(row: Record<string, string>): ClassAgeRange {
  const num = (v: string | undefined): number | null => {
    const t = (v ?? '').trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  return { min: num(row['Min Age']), max: num(row['Max Age']) };
}

/**
 * Identity of an offering, for collapsing the catalog's one-row-per-category
 * layout.
 *
 * Title alone is not enough: the catalog carries "Non-Traditional Watercolor:
 * Monday Session" and "…: Tuesday Session" as genuinely different classes at
 * different times, and several titles repeat across instructors. Weeks and
 * day/time are what separate them, so they are part of the key.
 */
function offeringKey(row: Record<string, string>): string {
  return [row.Title, row.Weeks, row['Day/Time'], row.Instructor]
    .map((s) => (s ?? '').trim().toLowerCase())
    .join('|');
}

/**
 * Parse the catalog CSV into one record per class.
 *
 * Rows sharing an offering key are the same class printed under more than one
 * category; they collapse into a single record whose `categories` lists them
 * all. Five classes in the 2026 catalog carry two.
 */
export function parseCatalog(csvText: string): CatalogClass[] {
  // Row 0 spans column groups ("Weeks Offered", "Course days and time");
  // row 1 carries the real names.
  const rows = parseCsvRecords(csvText, 1).filter((r) => r.id && r.Title);

  const byOffering = new Map<string, CatalogClass>();
  for (const row of rows) {
    const key = offeringKey(row);
    const existing = byOffering.get(key);
    const category = (row.Category ?? '').trim();

    if (existing) {
      if (category && !existing.categories.includes(category)) existing.categories.push(category);
      continue;
    }

    byOffering.set(key, {
      id: row.id,
      title: row.Title,
      instructor: row.Instructor ?? '',
      description: row.Description ?? '',
      categories: category ? [category] : [],
      ageRange: ageRangeOf(row),
      caregiver: isTrue(row.Caregiver),
      fee: row.Fee ?? '',
      materials: {
        fee: row['Fee - Materials'] ?? '',
        student: isTrue(row['Student Materials']),
        instructor: isTrue(row['Instructor Materials']),
      },
      location: row.Location ?? '',
      room: row.Room ?? '',
      weeks: weeksOf(row),
      daysOfWeek: daysOf(row),
      startTime: row.Start ?? '',
      endTime: row.End ?? '',
    });
  }

  return [...byOffering.values()];
}

/**
 * Where the catalog CSV lives.
 *
 * Checked into the repo rather than fetched: it is derived by hand from the
 * season's PDF once a year, so there is nothing to fetch it from. The env var
 * exists because the Lambda bundle lays the file out differently from a
 * checkout, and a deploy that forgets to ship it should fail loudly on the
 * path rather than quietly publish a catalog with no descriptions.
 */
export function catalogPath(): string {
  const override = process.env.CLASSES_CATALOG_PATH;
  if (override) return override;
  // From src/services (checkout) or dist/services (bundle), the repo root is
  // three levels up in both layouts.
  return resolve(__dirname, '../../../config/SpecialStudies.csv');
}

/** Read and parse the catalog, or fail with the path that was tried. */
export function loadCatalog(path: string = catalogPath()): CatalogClass[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `[classes] no Special Studies catalog at ${path} — set CLASSES_CATALOG_PATH, ` +
      'or check that config/SpecialStudies.csv shipped with this build',
    );
  }
  const catalog = parseCatalog(text);
  if (catalog.length === 0) {
    throw new Error(`[classes] catalog at ${path} parsed to zero classes`);
  }
  return catalog;
}
