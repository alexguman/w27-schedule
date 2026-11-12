# Booth Course Schedule Builder

Weekly calendars for planning the 2026-27 year (Autumn 2026, Winter 2027, Spring 2027) from UChicago Booth (BUSN) courses, plus Law School (LAWS) courses for Winter 2027, with Booth degree-requirement tracking across quarters. It is a static page with no server and no dependencies.

## Features

- Switch quarters in the header (Winter 2027 on a first visit; the last quarter viewed is remembered). Each quarter has its own calendar, search list, selected list and conflicts.
- Monday–Sunday grid from 8 AM to 10 PM. Search a quarter's courses by name, number or instructor, and filter by school. 678 sections in all: 580 Booth (182 Autumn, 188 Winter, 210 Spring) and 98 Law (Winter only).
- A course picked in more than one quarter shows "Also in Autumn 2026" (or the other quarter) in the search list and the selected list.
- The header shows the quarter's units: scheduled, and scheduled plus contemplated. 50-unit courses show "50 units, first half", "second half" or "full quarter"; a first-half and a second-half course at the same time do not conflict.
- Sections with no meeting time show their note ("Time TBD", "Day not listed: …") and are left off the calendar.
- A new course goes into the earliest section that does not clash with your picks. The other sections show as dotted outlines.
- Click a class to highlight its other sections, then click or drag one to switch.
- Overlapping scheduled classes split the slot and show a red band.
- Mark courses as **contemplated**: they show as hollow, dashed blocks, and a clash with your schedule gets an amber warning instead of a red conflict.
- Course pop-ups show the description, notes, learning outcomes, sections, rooms and dates. Professor pop-ups show the bio and their 2026-27 courses by quarter.
- Each visitor's selection is saved in their own browser (localStorage).
- Light theme by default whatever the OS setting; the sun/moon button in the upper-right corner switches it, and the choice is remembered.

### Degree requirements (Requirements tab)

Rules come from `data/booth_requirements.json` (Booth's MBA Program Outline 2026-27 and the October 2026 concentration requirements). Nothing personal is built into the site; each visitor enters their own courses.

- Pick MBA (2,000 units) or JD/MBA (1,600 units). Tick LEAD and Qualified Work Experience.
- Foundations (3 lines) and FLMBE (any 7 of 8 lines), each filled by one distinct course. Electives and total units against the program target.
- Track any number of concentrations. Each shows progress per component and the courses counted. Notes from Booth appear next to the requirement they belong to.
- Courses from every quarter count: scheduled and contemplated picks in Autumn, Winter and Spring, plus **Other quarters** entries. Units are split into three sources: completed and other quarters (filled), picks on a quarter's schedule (lightly filled), and contemplated picks as a what-if (hollow and dashed, as on the calendar). Each counted course names its quarter.
- A course number listed more than once (two quarters, or a pick and an Other quarters entry) counts once, keeping the strongest source and then the earliest quarter; the extra copies are flagged "counted once".
- **Other quarters:** for courses outside this data (for example Summer 2026), add them by number (`35100`, `ECON 30100`, `LAWS 48230`) with quarter, status and units (default 100; use 50 for half courses).
- **Overrides:** "also counts toward" or "does not count toward" a line or component, for petitions. An override badge marks every place one applies.
- The course list shows what each course counts toward and can be filtered with **Fills**. Course pop-ups have a **Counts toward** section with an override form.
- **Backup:** copy all your state as text and restore it in another browser.

How courses are assigned (`src/requirements.js`): Foundations and FLMBE use bipartite matching, so the most lines are filled and no course fills two. Concentrations assign each course once per concentration, with component minimums and maximums, Analytic Finance's Finance prerequisite, International Business's 33501/33502 rule, General Management's eight FLMBE lines, and the two overlap caps (100 units). A course may also count toward Foundations/FLMBE and several concentrations. Completed courses are preferred over scheduled ones, and scheduled over contemplated.

## Use it

- **One file:** open `dist/schedule-builder.html` in a browser, or upload it anywhere.
- **Static folder:** serve `site/` as-is (`index.html`, `styles.css`, `requirements.js`, `app.js`, `data.js`).

## Add it to your website

See `AGENTS.md` for step-by-step instructions you can give Claude Code. In short:

1. **Own page (recommended):** copy `site/` to a path on your site, such as `/schedule/`.
2. **Embedded:** put `dist/schedule-builder.html` on your site and show it in an `<iframe>` (about 1000 px tall).
3. **Inside your framework:** port `src/` into a component. The CSS uses global selectors, so it must be scoped first.

## Before publishing

The Booth course data, descriptions and faculty bios came from the Booth bidding site, which requires a login. The Law data came from UC Classes Self-Service and the public Law School site. Publishing the Booth material on a public site may conflict with Booth or University policies. The page includes `noindex, nofollow`. Keep it unlisted or behind a password unless you have confirmed you may publish it.

## Develop

Requires Python 3.10+.

```bash
pip install -r requirements-dev.txt   # pytest, ruff, playwright (optional)
python -m playwright install chromium  # optional, for the browser test

python scripts/build.py            # src/ + data/ -> site/ and dist/
python -m pytest                   # full test suite
ruff check . && ruff format --check .
```

The browser test skips itself when Playwright or a browser is missing. Set `CHROME_PATH` to use an installed Chrome.

### Refresh the data

| Data | Source | Command |
|---|---|---|
| `data/booth_sections.json` | Booth Course Search page for one quarter or the full year, saved as HTML (not included: it holds the account holder's session and student details) | `python scripts/parse_booth.py "booth_intranet.html" > data/booth_sections.json` |
| `data/law_sections.json` | One row per section in `data/raw/law_classes_w27.txt` | `python scripts/parse_laws.py data/raw/law_classes_w27.txt > data/law_sections.json` |
| `data/booth_requirements.json` | Booth intranet: MBA Program Outline 2026-27 and Concentration Requirements (URLs inside the file) | Edit by hand; keep `schema_version` 1 |
| `data/details.json` | `data/raw/*.json` (descriptions, bios, Law class details) | `python scripts/parse_details.py data/raw/booth_details.json data/raw/law_details.json data/raw/law_faculty.json data/law_sections.json > data/details.json` |

Run `python scripts/build.py` after any refresh.

## Directory map

```
src/            app source: index.html, styles.css, app.js, requirements.js (requirement engine)
data/           section records and pop-up details (inputs to the build)
data/raw/       source captures the parsers read
scripts/        parsers and the build script
tests/          pytest suite, one file per script, JS engine tests (run by Node through pytest), browser smoke test
site/           build output: static multi-file site
dist/           build output: single self-contained HTML file
```

## Known gaps

- 47 of 104 Law instructors have no bio. Most are lecturers without a Law School faculty page. Six pages (Boutros, Didwania, Fitzgerald, Ford, Neal, Peterson) were blocked when fetched.
- Some Law seminars meet on select dates but show as weekly. Insurance Law shows both of its listed meeting patterns.
- Five Law sections and 12 Spring Booth sections have no meeting time. They appear in the list with their note but not on the calendar.
- No Summer 2027 courses were listed. Law School data covers Winter 2027 only.
- Each section's `tags` (Booth's own requirement tags) are reference data; requirement counting uses only `data/booth_requirements.json`.
- Requirements: Booth picks count their section's units (50 or 100). Law courses earn Booth units (100) only when cross-listed, listed in a requirement, or added by override.
- Requirements: a 50-unit course fills half a Foundations or FLMBE line; pairing two 50-unit courses in one line is not modeled. Grade and GPA rules, Business Analytics' per-area cap and "counts with enrollment in" notes are shown, not enforced.
