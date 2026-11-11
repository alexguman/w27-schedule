# AGENTS.md

Static schedule builder (vanilla HTML/CSS/JS, no runtime dependencies). Python is used only for the build and the data parsers. See README.md for features and data sources.

## Setup and checks
- `pip install -r requirements-dev.txt` (and `python -m playwright install chromium` for the browser test)
- Build: `python scripts/build.py` writes `site/` and `dist/schedule-builder.html`
- Test: `python -m pytest`. Lint: `ruff check . && ruff format --check .`

## Directory map
- `src/index.html`, `src/styles.css`, `src/app.js`: the app. Edit these, never `site/` or `dist/`.
- `data/*.json`: build inputs. `data/raw/`: captures the parsers read.
- `scripts/`: `parse_booth.py`, `parse_laws.py`, `parse_details.py`, `build.py`.
- `tests/`: one test file per script, plus `test_browser.py`.

## Integrating into the owner's website
Ask the owner which option they want if it is unclear. Default to option 1.
1. **Own page:** copy `site/` to a route such as `/schedule/`. The page uses relative paths (`styles.css`, `data.js`, `app.js`), so serve the folder as a unit. Add a link from the site's navigation.
2. **Iframe:** host `dist/schedule-builder.html` and embed it with `<iframe src="..." style="width:100%;height:1000px;border:0" title="Schedule builder">`.
3. **Framework component (React, Astro, etc.):** load `data.js` and `app.js` as plain scripts after the markup in `src/index.html` (from `<div class="app">` to the closing `</dialog>`). `app.js` queries elements by id at load, so it must run after they exist. Do not bundle it as an ES module.

For option 3, the CSS is global: `*`, `html`, `body`, `button`, `:root` tokens and generic class names (`.panel`, `.chip`, `.btn`). Prefix every selector with a wrapper class and move the `:root` tokens onto that wrapper before mixing it with site styles. `app.js` appends a drag preview to `document.body`, which needs the same styles. For a site build step, copy `site/` into its static or public folder rather than importing the files.

## Conventions that differ from defaults
- `app.js` reads its data from `window.W27_SECTIONS` and `window.W27_DETAILS`, which `data.js` sets. Regenerate `data.js` with the build, never by hand.
- Section ids: Booth uses the bidding site's section id (`"48431"`). Law uses `"L"` plus the class number (`"L20232"`). Course keys are dept plus number (`"BUSN30000"`). Greenberg Seminars, which share LAWS 92000, get `".1"`, `".2"` suffixes.
- Times are minutes after midnight. Day 0 is Monday.
- localStorage keys `booth-w27-schedule` and `w27-show-contemplated` hold each viewer's selection. Keep them stable, or existing selections are lost.
- All fetched text is plain text and is escaped with `esc()` before rendering. Do not insert data as HTML.
- The page has `<meta name="robots" content="noindex, nofollow">` because some data comes from login-only systems. Keep it unless the owner says otherwise.
- Theme: light and dark come from `prefers-color-scheme` or a `data-theme` attribute on `<html>`.
