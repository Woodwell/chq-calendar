# Class catalog: a printed baseline, and a crawl that reports change

**Status:** Implemented on `feat/classes-catalog`; the backend half is
proposed upstream from `feat/classes-backend`. Kept as the rationale for the
compiled-catalog approach. Current state and next steps are in
`2026-08-28-special-studies-classes-status.md`.
**Follows:** issue #246 (the `/classes` page and its scraper, built)

## The problem this solves

The scraper built for #246 treats tickets.chq.org as the only source, and pays
for that twice over. It spends 143 paginated listing requests per season
learning which classes belong to which subject, and it can only report what
the site chooses to expose — free-text ages, one location string, times
embedded in prose.

There is a better source. Chautauqua publishes the Special Studies catalog as
a PDF before the season, and `config/SpecialStudies.csv` is that document
transcribed: 492 rows, 483 distinct classes, with fields the site never
exposes.

| The catalog has | The crawl gets |
| --- | --- |
| `Min Age` / `Max Age` as numbers (486 of 492 filled) | free text, parsed best-effort |
| `Category`, the editorial subject | membership across 19 subjects, 143 pages |
| `W1`–`W9`, `Mon`–`Sun` as booleans | parsed from prose |
| `Start` / `End` as times | parsed from `"4–4:30p.m."` |
| `Location` and `Room` separately | one string |
| `Fee`, `Fee - Materials`, `Student Materials`, `Instructor Materials` | one `priceLabel`, no materials |

So the proposal inverts the design: the catalog describes the season, and the
crawl reports how reality has diverged from it — additions, cancellations, and
enrollment.

## Authority

Neither source wins outright. Each is authoritative for what it actually
knows.

**The catalog is authoritative for description.** Category, ages, materials,
fees, the intended schedule, room. It was written deliberately by people who
run the programme, and it is the same text a reader holds in their hand.

**The crawl is authoritative for everything observable now** — enrollment
above all, but also the actual time, day, and place of a session, which can
move after the catalog goes to print. Where both sides carry a field and they
disagree, the crawl wins, because it reflects what will happen rather than
what was planned.

**The crawl is authoritative for existence — but only forwards.** This is the
constraint that shapes the whole design, and it is stated as a rule rather
than inferred: *a class cannot be created or cancelled in the past.*

## The temporal rule

A crawl on date D can say three things and no more:

- A class with a session after D **exists**.
- A class the catalog scheduled after D, absent from the crawl, **has been
  cancelled**.
- A class whose sessions were all before D and which is absent — **nothing**.
  It may have run and been delisted, or never happened at all. The crawl
  cannot tell, and neither can we.

That last case is not hypothetical. Of the 483 catalog classes, 49 were never
seen in an August crawl, and their absence tracks how long ago they finished:

```
rate of "in catalog, never listed", by the class's last scheduled week
   week 1:   8.1%  (3/37)    week 4:  21.7%  (10/46)   week 7:   7.0%  (4/57)
   week 2:  10.2%  (5/49)    week 5:  11.1%  (7/63)    week 8:   3.4%  (2/58)
   week 3:  24.0%  (12/50)   week 6:   8.3%  (4/48)    week 9:   2.7%  (2/75)
```

Counted per distinct class, not per catalog row: a class the catalog lists
twice because it runs two offerings counts once, and counts as observed if
either offering was seen. Per row the series is noisier — week 7 rises above
week 6 — because the rows that split into offerings are not spread evenly
across the weeks.

From week 3 onward the rate falls steadily as the last week approaches the
crawl date. If the listing kept every class all season, that line would be
flat. It is not, so the site evidently drops classes some time after they
finish — and absence therefore means "gone" rather than "never existed".

This is suggestive rather than proven: it is one crawl, so a time effect is
being read off a cross-section. Crawls at intervals would settle it. Either
way the rule holds, because it is a statement about what can be known.

**Consequences.** Backfill from a late-season crawl cannot establish
cancellation, so the 49 are recorded as *unobserved*, never as *cancelled*.
Cancellation is only ever asserted when a class the catalog scheduled in the
future is missing from a crawl made before that date — which means it can only
be detected by crawling through the season, not retrospectively.

## Categories

The catalog's vocabulary wins, because it is the vocabulary of the printed
document a reader is holding. That means **Youth is a category again**, which
reverses a decision made a day earlier — and the reversal is right. Youth was
dropped as a *scraped* subject because the site applies it to 355 of 466
classes as a de facto age flag, duplicating `ageRange` less precisely. In the
catalog it is a deliberate editorial grouping of 25 classes. Same word,
different thing.

The two vocabularies do not align, and the catalog's is not a superset:

| Catalog | Site |
| --- | --- |
| `Fitness & Health` | `Health & Fitness` |
| `Culinary` | `Culinary Arts` |
| `Handcrafts` | `Handcrafts & Hobbies` |
| `Literature, Language & Writing` | `Literature & Writing` + `Language` |
| `Sailing` (4 classes) | — |
| — | `Master Classes`, `Photography`, `On Theme` |

Since the catalog supplies the category, the site's subject taxonomy is not
mapped onto it — it is simply not used, and the 143-page subject crawl goes
away. A class the catalog does not cover has no category rather than a guessed
one.

The catalog is one row per *(class, category)* pair, so a class can carry more
than one: 5 do. `categories` stays a list.

## The join

`classCatalogMatcher.ts`, already built and tested. Tiered, and it declines
rather than guesses: exact title, then a bare catalog title against the site's
per-day listings, then instructor as a tiebreak, then rename detection
accepted only when the instructor agrees.

Against August data: 441 of 466 listings matched (94.6%), 25 listed but not in
the catalog, 49 in the catalog but unobserved, 5 held for review — all five
genuine matches it was right not to assume.

The 25 are mostly Masters Series masterclasses, which are booked after the
catalog prints. They are not an error to be tuned away; they are the reason
the crawl stays authoritative for existence.

## Shape of the published record

```
ChqClass {
  id            // eventAk when listed; catalog id when only in the catalog
  catalogId     // null when the site added it after the catalog printed
  title, instructor, description
  categories[]  // from the catalog; empty when it did not cover the class
  ageRange      // catalog numbers when known, else parsed from the listing
  materials, fee, room          // catalog only
  sessions[]    // crawl only: week, dates, days, times, place, availability
  provenance {  // which source said what, and when it was last seen
    catalog: boolean
    lastObserved: string | null   // ISO date of the last crawl that saw it
    status: 'listed' | 'unobserved' | 'cancelled'
  }
}
```

`provenance.status` is the temporal rule made visible. `unobserved` and
`cancelled` are deliberately different words for deliberately different
claims, and the page can treat them differently — a cancelled class is worth
showing struck through, an unobserved one is just history.

## What the crawl becomes

Not a catalog builder. A change detector, reporting three things:

- **additions** — listed, no catalog row, first seen on this run
- **cancellations** — catalog scheduled it in the future, the crawl no longer
  lists it
- **enrollment** — spots and waitlist, the only thing that moves hourly

The full crawl still runs, because existence has to be observed. But it stops
carrying the 143-page subject pass, which is the single largest cost in it: a
first crawl of a season falls from ~605s to roughly 175s.

## Decisions

Taken 2026-08-24. All three questions this document raised are now closed.

**The catalog stays a checked-in CSV.** `config/SpecialStudies.csv` is the base
catalog, hand-derived from the season's PDF once a year. A season therefore
opens with a manual transcription step, and that is accepted rather than
designed around — parsing the PDF would automate a job nobody does twice.

**The sheet is accepted as transcribed, with one exception.** Where it
disagrees with the site about a time or a room the crawl wins anyway, so
transcription differences are not worth chasing. Genuine duplication is the
exception, because the crawl cannot resolve it: a duplicate changes what the
catalog *is*, not what it says. The duplicated *Design Your Own Board Game*
row is removed — `id` 16 dropped, `id` 24 kept, because 24 carries the
`Location` / `Room` split the other seven Heinz Center rows use. Which of the
two matched the crawl was not evidence either way: only one listing exists,
so whichever row is reached first claims it and the other falls through.

**Unobserved classes are published.** They are real classes that really ran,
they carry the richest description in the dataset, and withholding them would
discard the only remaining record of a class the site has already dropped.
They ship with `provenance.status: 'unobserved'` so the page can present them
as history rather than as something bookable.

## Still open

**Off-season and past-week content.** Publishing unobserved classes means that
from roughly September to June the page is almost entirely history. That is
the same problem the parked synthetic-data note describes, and it is left
there rather than solved here by hiding data.
