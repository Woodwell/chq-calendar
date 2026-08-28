> **Status:** In progress. The backend is proposed upstream as a PR from
> `feat/classes-backend`; the frontend and the offline compiler are still only
> on `feat/classes-catalog`. Nothing is deployed to production, and no schedule
> is enabled anywhere. This is the working context document — the original
> design rationale is in `2026-08-22-class-catalog-backfill-design.md`.

# Special Studies classes — where this stands

**Date:** 2026-08-28
**Scope:** A `/classes` page backed by Chautauqua's Special Studies catalog,
with the live spot counts the ticket site publishes.

## The shape of it

Three separable pieces, deliberately:

1. **Runtime backend** — a scheduled Lambda that crawls `tickets.chq.org` and
   publishes `classes-{year}.json` to the CDN. Mirrors the article/program
   ingest pipelines: scrape, cheerio parse, S3 state, no DynamoDB.
2. **Frontend** — `/classes`, a self-contained page following the repo's
   four-file pattern, with its own filter state and favourites store.
3. **Offline compiler** — turns a hand transcription of the printed catalog
   into `backend/src/data/catalog-2026.json`, which is checked in. Run once,
   by a human, not in any pipeline.

The third piece exists because of a refactor worth understanding before
changing anything. The 2026 catalog came from a PDF transcribed by hand into a
spreadsheet. That is *this season's accident*, not the contract — 2027's will
come from somewhere else. So the fuzzy title-matching that joins the printed
catalog to the ticket site was moved **out of the ingest run and into a
one-time compile**. The join (`eventAks`) and the season's week-to-date
calendar (`weeks`) are resolved once, reviewed in a diff, and shipped as data.
Nothing at runtime re-derives them.

That is why the Lambda bundle carries a 17.5k-line JSON: esbuild inlines it, so
there is no file to ship and no path to resolve. `seasonCatalog.ts` is the only
thing that reads it, and a season with no catalog is a normal state — the crawl
still publishes, just without descriptions attached.

## Two passes, one function

| pass | what it does | measured |
| :--- | :--- | :--- |
| `full` | paginated search + every class's detail page | 466 details, 259.5s |
| `spots` | refetches only classes running within ~10 days | 49 details, 14.3s |

The split is about being a good citizen: a full pass is ~513 requests against
someone else's ticketing site, and what it observes changes over days. Spot
counts are the only thing that moves in between, and the only number anyone
acts on.

## Where the code is

| branch | contents |
| :--- | :--- |
| `feat/classes-backend` | runtime backend + `classes-ingest.tf` + deploy step + runbook. Open as a PR against `Woodwell/main`. |
| `feat/classes-catalog` | everything: the above plus the frontend, the offline compiler, the sandbox stack, and demo tooling. |

The backend PR was carved out of the full branch rather than developed
separately, so the two will drift. Treat `feat/classes-catalog` as the source
of truth and re-carve if needed.

The offline compiler is deliberately **not** in the backend PR. The catalog's
provenance travels as prose instead — a `provenance` field on every class, and
a `source.catalog` string on the file. Several comments were rewritten during
the carve-out to stop referencing files that are not in that PR; if you merge
the compiler upstream later, those comments should point at it again.

## What is actually running

- **Sandbox AWS** (a personal account, not production): the Lambda, a private
  S3 bucket, and a CloudFront distribution reading it through an Origin Access
  Control. Both EventBridge rules exist and are **DISABLED** — every run so far
  has been a manual invoke.
- **A password-protected demo host**: serves a demo build, proxying the catalog
  from that CloudFront rather than shipping a copy. It is `noindex`, behind
  basic auth, and its `robots.txt` is overridden at the proxy.
- **Production**: nothing. No function, no schedule, no page.

`infrastructure/classes-ingest.tf` (production) and
`infrastructure/sandbox-classes/` (sandbox) are separate modules. The
production one is *not* standalone — it references `aws_s3_bucket.frontend_bucket`
and `var.app_name` from `main.tf`, so it cannot be applied on its own.

## What has been verified, and how

- A full pass in the sandbox returned 516 classes, 466 details, **zero parse
  failures**, and reconciled 441 matched / 25 listed-only / 48 unobserved / 2
  cancelled — identical to a local run, same class ids.
- A spots pass ran in 14s, left all 516 classes byte-identical, and moved the
  object's ETag, proving the conditional write executes against real S3.
- The extrapolated season calendar was cross-checked against the independent
  events feed: week 2 = Jul 4, week 3 = Jul 11, week 9 = Aug 22. Exact match.
- Resource sizing is measured, not guessed: 259.5s against a 900s timeout,
  229 MB against 512 MB.

## Next steps

1. **Land the backend PR.** Currently against `Woodwell/main` as a staging
   ground; retargeting at `bbernstein` is a separate decision.
2. **A cold-start rehearsal** — tear the sandbox down, merge, then build and
   `terraform plan` from a *fresh clone* of main. The clone matters: it is the
   only way to catch a dependency on something gitignored or on state a
   long-lived working tree happens to have.
3. **The frontend PR.** Not yet carved out. It is ~25 files and depends on the
   published JSON shape, so it should follow the backend rather than lead it.
4. **Production rollout**, when the shape has survived review: apply the
   Terraform (schedules land disabled), verify by hand from the runbook, then
   enable schedules deliberately with `-var classes_schedules_enabled=true`.

## Parked

- **Synthetic data off-season.** From roughly September to June every class
  reports zero sessions, so the page has nothing to show and a broken crawl is
  indistinguishable from a correct one. Two constraints when this is picked up:
  it must be unmistakably fake to anyone looking at it, and it should be a
  fixture the page can be pointed at rather than an `if (offSeason)` branch in
  the runner that only runs when nobody is watching.
- **Age-range filtering.** The data is captured (`ageRangeText` plus a
  best-effort parse); the UI is a later phase.
- **Cross-page favourites** between `/classes` and the calendar. The ID scheme
  is namespaced now so this needs no migration.

## Things that cost time, so you do not pay twice

- **The catalog listing is not server-rendered.** The obvious GET returns a
  promo carousel. The real listing is a POST needing a session cookie and a
  CSRF token from the GET page, and it returns gate passes instead of classes
  if the week filter is empty.
- **Subjects hide in the wrong field.** There is a `subjectCategories` select,
  but the server never reads it — the page's own JavaScript copies the value
  into `eventCategories`. Filtering by the field named after it silently
  returns everything, which reads exactly like a catalog with no subjects.
- **Past sessions vanish from detail pages entirely.** Late-season and
  off-season crawls legitimately return classes with zero sessions. This is
  also what an interstitial looks like, which is why the client aborts on one
  rather than publishing what it received.
- **`ListBucket` is not optional** in the IAM policy. Without it, S3 answers
  403 for a key that merely does not exist, so the first run — when the catalog
  cannot exist yet — cannot tell "nothing published" from a real failure.
- **A new AWS account cannot reserve Lambda concurrency at all.** The default
  limit is 10 and the unreserved pool may not drop below 10, so
  `reserved_concurrent_executions = 1` is rejected outright. Correctness does
  not depend on it — the conditional write does — but the cap is what spares
  you losing a run.
- **`gh pr edit` fails silently in this repo** on a Projects-classic GraphQL
  error. Use `gh api -X PATCH repos/.../pulls/N` and re-read the result.
