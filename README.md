# Roomly — KFUPM empty room finder

A no-login front-end prototype for students looking for classrooms that are free for an entire study window.

## Run locally

Because the app loads JSON with `fetch`, serve this folder over a small local web server:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Product flow

1. Choose a day: `U`, `M`, `T`, `W`, or `R`.
2. Choose an entry time and an exit time.
3. Choose a building.
4. Roomly returns rooms where no TERM 261 offering overlaps the full requested interval.

The location parser expects KFUPM locations in the form `BUILDING-ROOM`, for example `24-204`.

## TERM 261 data hookup

`data/course-offerings-261.json` is a small preview payload so the interface can be tested immediately. It is intentionally labeled as preview data. The website reads the file at runtime, so it can be replaced by the complete synchronized export without changing the UI.

The repository also includes `scripts/sync-term-261.mjs`, which is the production data path. It reads the official form, uses the university’s TERM 261 code (`202610`), submits the form for every department, normalizes every course row, and writes a deduplicated JSON export containing `course`, `section`, `department`, `days`, `start`, `end`, and `location`.

To run the full sync:

```bash
npm install
npm run sync:261
```

Then serve the folder again:

```bash
npm run serve
```

## Automatic updates

The page checks for a newer JSON file every 15 minutes while it is open. The refresh button also checks immediately. The scheduled workflow at `.github/workflows/sync-term-261.yml` runs every 6 hours, downloads all TERM 261 departments, and commits the JSON only when the course data changes. After the project is placed in a GitHub repository and its Actions workflow is enabled, this keeps the published static site current without manual syncing.

For a local one-time update on Windows, use:

```powershell
npm.cmd run sync:261
```

The status beside the results shows the last successful data sync time.

## Interface improvements

- A light/dark mode toggle remembers the student’s preference in the browser.
- Building numbers can be filtered quickly when the list is long.
- The interface includes visible keyboard focus states, reduced-motion support, and a safe fallback to the last loaded data when a refresh fails.

The importer preserves any curated room inventory in a synced file and also derives rooms observed in TERM 261 offering rows. If a room never appears in an offering, add it to the `rooms` array with the authoritative campus inventory so it can be correctly shown as empty.

Official source:

<https://registrar.kfupm.edu.sa/course-offerings>

Keep the payload shape and `term: "261"`. Do not scrape the page from the browser on every student visit; the scheduled importer avoids CORS problems and unnecessary load on the Registrar site.
