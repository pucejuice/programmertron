# Job Router

A single-page web app that takes a list of job sites (CSV or XLSX with latitude and longitude),
splits them between workers, splits each worker's jobs into days, orders each day as a route that
starts and ends at a base, shows it all on a Leaflet map, and exports CSV, XLSX and printable
run sheets. Built with TypeScript and Vite; hosted as a static site on GitHub Pages.

## Data rules (in plain words)

- Your job data never leaves your browser. There is no server, no upload, no analytics and no
  telemetry. No third-party script is loaded at runtime other than the pinned libraries bundled
  into the site.
- No job coordinate or job row is ever sent to a third party, with these exceptions only:
  1. Map tiles. A tile server learns which area you are viewing, not where individual jobs are.
     The tile URL is a setting and there is a "no basemap" option that draws jobs on a blank
     background.
  2. Base lookup. One single averaged point (the centroid of all jobs) may be sent to
     OpenStreetMap Overpass to find the nearest town.
  3. Typed address. An address you type for a start or end point may be sent to Nominatim.
  4. Optional road routing, off by default. Switching Distances to "Road network" asks for an
     OSRM-compatible server URL (or offers the public OSRM demo server) and a confirmation tick;
     only then are job coordinates sent to that server.
- This repository contains no real job data. Tests and examples use synthetic data only.
- The app autosaves to this browser's storage (localStorage / IndexedDB) on your machine.
  The Clear all data button removes it.
- Every input row appears exactly once in every export. Rows with a blank, non-numeric or out of
  range location (|lat| > 90, |lon| > 180, or exactly 0,0) are not routed, but are kept, listed
  last, and marked `no location - not routed`. Two jobs at identical coordinates are both kept.
- Input columns are preserved exactly: duplicate header names, original order and header text
  survive, a leading BOM is stripped, and new columns are appended.

## Run locally

```
npm ci
npm run dev
```

Open the URL Vite prints (the site is served under `/programmertron/`).

## Test

```
npm test        # Vitest unit tests, synthetic data, no network
npm run e2e     # Playwright smoke test (builds, serves with vite preview, runs Chromium)
```

For `npm run e2e` Chromium must be installed once: `npx playwright install chromium`
(on Linux CI use `--with-deps`). The smoke test blocks every non-local request and mocks Overpass
with a fake town, then checks the outbound request list.

## Deployment

`.github/workflows/ci.yml` runs on every push and pull request: install, typecheck, unit tests,
build, Playwright smoke test (report uploaded on failure). On a push to `main` it also deploys
`dist/` to GitHub Pages using `actions/configure-pages`, `actions/upload-pages-artifact` and
`actions/deploy-pages`.

One-time setup:

1. The repository must be public (GitHub Pages on the GitHub Free plan is for public repositories;
   see `THIRD_PARTY.md` for what was and was not verified).
2. In the repository settings, Pages, set Source to "GitHub Actions".
3. Push to `main`. The site is then at `https://<owner>.github.io/programmertron/`.

The Vite `base` is `/programmertron/`; change it in `vite.config.ts` (and `playwright.config.ts`)
if the repository is renamed.

## Input format and column detection

- Files: `.csv` (UTF-8, BOM tolerated) or `.xlsx` (first sheet by default; a sheet chooser appears
  if there are several). Load by dragging a file onto the drop zone (or anywhere on the page) or by tapping it to browse.
- Theme: Auto (follows the system), Light or Dark, from the toggle in the panel header. The choice
  is kept in this browser; printed run sheets are always black on white.
- Rows are parsed as arrays, never keyed by header name, so duplicate headers survive.
- Latitude column header (trimmed, case-insensitive): `lat`, `latitude`. Longitude: `long`, `lon`,
  `lng`, `longitude`. The first match wins. If either is missing, a column-mapping dialog lists all
  headers so you can pick; nothing else is guessed.
- Job label: the first column by default; you can choose another.
- Worker column: headers `assigned to`, `worker`, `crew` or `tech` are offered as the initial
  worker assignment (off unless you accept; if the header appears twice you pick which).
- `MANUAL_SEQ`: if a column of that name holds numbers, those jobs keep that order within their day
  and the others are routed around them.

## Outputs

Every export keeps all input columns unchanged and in order, then appends:

| Column | Meaning |
|---|---|
| `WORKER` | worker name |
| `DAY` | day number within the worker (1..n), blank if not split |
| `SEQ` | stop number within the day (1..n) |
| `LEG_KM` | distance from the previous stop (the base for stop 1), 3 dp |
| `CUM_KM` | cumulative day distance up to this stop, 3 dp |
| `DIST_MODE` | `straight` or `road` |
| `LOCKED` | `Y` if the user fixed the worker/day by hand |
| `ROUTE_NOTE` | blank, or `no location - not routed` |

Row order is by worker, then day, then SEQ; not-routed rows go last. The return leg to base is in
the day totals, not a row. Formats: CSV; XLSX (one sheet of all jobs, one sheet per worker);
printable run sheet per worker per day (A4 portrait print CSS); and a `.json` plan file (job
rows, settings, assignments, locks) saved only to your disk.

## Modes

- Normal: balanced worker groups, days of N jobs (default 7), nearest-neighbour then 2-opt, each
  day from the worker's base and back to it.
- Simple (old program): one worker, no day split, start at the centroid, open end, no 2-opt.
  Reproduces the old Python program exactly (parity test).
- Hours per day: alternative to jobs per day, from hours per day, minutes per job and speed in
  km/h, all user-entered.
- Manual reassignment: click or box-select jobs and assign a worker or day; this locks them
  (kept on re-run until Unlock all). Undo/redo for at least 20 steps.

## Grouping and routing method

**Worker and day grouping: capacity-balanced k-means.** The start is seeded k-means++
(a fixed-seed mulberry32 PRNG, so the same file always gives the same groups), on a local
planar projection. Each Lloyd iteration assigns points greedily to their nearest centroid
subject to hard capacities, then a final pass of single moves and pairwise swaps tightens
the groups without breaking capacity. Groups are numbered by sweep angle of their centroid
around the base.

*Why:* k-means gives compact geographic groups that suit crews driving out from one base
(an angular sweep makes long thin wedges when jobs sit at different distances). Hard
capacities guarantee the ±1 balance, and the fixed seed makes it deterministic. Locked jobs
stay in their group and seed its centroid. When a capacity can't fit every job it is
extended, so a job is never dropped.

Days reuse the same clusterer, with capacities `[jobsPerDay, ..., remainder]`, so 40 jobs
at 7 per day give 7, 7, 7, 7, 7, 5. Hours mode finds the smallest number of days for which
every day's estimated time (route km / speed + jobs x minutes per job) fits the hours per day.

**Sequencing.** Nearest-neighbour runs from the start, with visited jobs tracked by row and
ties going to the lower row index. Then comes first-improvement 2-opt: each pass scans i
ascending, then j ascending, and applies the first reversal that saves more than 1e-9 km.
It stops after a pass with no improvement, or at the time limit (5 s by default) with a
visible note. The start is fixed, and the end is fixed when set. Jobs with `MANUAL_SEQ`
keep their relative order. Other jobs go in by cheapest insertion and are then improved by
or-opt moves of free jobs only.

## Limits

- Distances are straight-line (haversine, R = 6371 km) by default, not road distances. The
  "Distances: Straight line | Road network" switch at the top of the panel changes this.
- "Simple (old program) mode" is on the Setup tab. It always uses straight-line distances.
- The public OSRM demo server is for light use only (one request per second, which the app
  respects); a large plan with many days is slow on it. Use your own OSRM server for regular work.
- Routing is a heuristic (nearest-neighbour plus 2-opt, 5 s limit per route); it is not optimal.
- Road routing is optional, off by default, and sends job coordinates to the server you name.
  If that server fails the app falls back to straight-line with a visible warning.
- Data is stored in this browser only; clearing site data or switching browsers loses it. Save a
  plan file to keep it.
- Guidance: up to about 2,000 jobs (routing runs in a Web Worker; markers use a canvas renderer or
  clustering above 500).
- Designed for 1280 px wide down to a 768 px tablet; phones are not a target.
- Out of scope: accounts, backend, sharing, time windows, job priorities, vehicle capacities other
  than job or hour counts, turn-by-turn navigation or links that send stops to other services.

See `THIRD_PARTY.md` for library licences and the map/geocoding service terms.
