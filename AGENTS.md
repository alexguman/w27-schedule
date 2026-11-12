# AGENTS.md

Booth Course Schedule Builder: static per-quarter schedule builder for 2026-27 with Booth degree-requirement tracking (vanilla HTML/CSS/JS, no runtime dependencies). Python is used only for the build and the data parsers; Node (built-in test runner, no npm) only for the JS unit tests. See README.md for features and data sources.

## Setup and checks
- `pip install -r requirements-dev.txt` (and `python -m playwright install chromium` for the browser test)
- Build: `python scripts/build.py` writes `site/` and `dist/schedule-builder.html`. Data refresh steps: README.md, "Refresh the data".
- Test: `python -m pytest` (runs `tests/requirements.test.js` through Node; skips it without Node). Lint: `ruff check . && ruff format --check .`

## Directory map
- `src/index.html`, `src/styles.css`, `src/app.js`: the app. `src/requirements.js`: pure requirement engine (no DOM). Edit these, never `site/` or `dist/`.
- `data/*.json`: build inputs. `data/booth_requirements.json`: the single source of truth for degree rules; never hard-code requirement data in JS. `data/raw/`: captures the parsers read.
- `scripts/`: `parse_booth.py`, `parse_laws.py`, `parse_details.py`, `build.py`.
- `tests/`: one test file per script, `requirements.test.js` (+ `test_requirements.py` runner), and `test_browser.py`.

## Integrating into the owner's website
Ask the owner which option they want if it is unclear. Default to option 1.
1. **Own page:** copy `site/` to a route such as `/schedule/`. The page uses relative paths (`styles.css`, `data.js`, `requirements.js`, `app.js`), so serve the folder as a unit. Add a link from the site's navigation.
2. **Iframe:** host `dist/schedule-builder.html` and embed it with `<iframe src="..." style="width:100%;height:1000px;border:0" title="Schedule builder">`.
3. **Framework component (React, Astro, etc.):** load `data.js`, `requirements.js` and `app.js`, in that order, as plain scripts after the markup in `src/index.html` (from `<div class="app">` to the closing `</dialog>`). `app.js` queries elements by id at load, so it must run after they exist. Do not bundle it as an ES module.

For option 3, the CSS is global: `*`, `html`, `body`, `button`, `:root` tokens and generic class names (`.panel`, `.chip`, `.btn`). Prefix every selector with a wrapper class and move the `:root` tokens onto that wrapper before mixing it with site styles. `app.js` appends a drag preview to `document.body`, which needs the same styles. For a site build step, copy `site/` into its static or public folder rather than importing the files.

## Conventions that differ from defaults
- `app.js` reads `window.W27_SECTIONS`, `window.W27_DETAILS` and `window.W27_REQUIREMENTS` (set by `data.js`) and `window.W27Req` (set by `requirements.js`). Regenerate `data.js` with the build, never by hand.
- `requirements.js` loads as a plain script in the browser and with `require()` in Node. Terms (course number, source, target, override) are defined at its top.
- Section ids are unique across the year. Booth uses the bidding site's section id (`"48431"`). Law uses `"L"` plus the class number (`"L20232"`). Course numbers repeat across quarters, so course keys are quarter prefix plus dept and number (`"Wi27-BUSN30000"`). Greenberg Seminars, which share LAWS 92000, get `".1"`, `".2"` suffixes. Saves store section ids, so key formats can change without migration.
- Requirement counting uses only `data/booth_requirements.json`; the sections' `tags` field is reference data.
- Times are minutes after midnight. Day 0 is Monday.
- localStorage keys `booth-w27-schedule`, `w27-show-contemplated`, `w27-requirements`, `w27-term` (last quarter viewed) and `w27-theme` hold each viewer's state. Keep them and their formats stable, or saved work is lost. The Backup format (`"format": "w27-schedule-backup"`, version 1) is also a public contract.
- All fetched text is plain text and is escaped with `esc()` before rendering. Do not insert data as HTML.
- The page has `<meta name="robots" content="noindex, nofollow">` because some data comes from login-only systems. Keep it unless the owner says otherwise.
- Theme: light by default, ignoring `prefers-color-scheme`. An inline script in `src/index.html` sets `data-theme` on `<html>` from `w27-theme` before first paint; `app.js` runs the toggle.
