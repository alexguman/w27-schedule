# Winter 2027 Schedule Builder

A weekly calendar for planning a Winter 2027 schedule from UChicago Booth (BUSN) and Law School (LAWS) courses. It is a static page with no server and no dependencies.

## Features

- Monday–Sunday grid from 8 AM to 10 PM. Search all 194 courses (286 sections) by name, number or instructor, and filter by school.
- A new course goes into the earliest section that does not clash with your picks. The other sections show as dotted outlines.
- Click a class to highlight its other sections, then click or drag one to switch.
- Overlapping scheduled classes split the slot and show a red band.
- Mark courses as **contemplated**: they show as hollow, dashed blocks, and a clash with your schedule gets an amber warning instead of a red conflict.
- Course pop-ups show the description, notes, learning outcomes, sections, rooms and dates. Professor pop-ups show the bio and this quarter's courses.
- Each visitor's selection is saved in their own browser (localStorage).

## Use it

- **One file:** open `dist/schedule-builder.html` in a browser, or upload it anywhere.
- **Static folder:** serve `site/` as-is (`index.html`, `styles.css`, `app.js`, `data.js`).

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
| `data/booth_sections.json` | Booth bidding Course Search page, saved as HTML (not included) | `python scripts/parse_booth.py "Booth courses.html" > data/booth_sections.json` |
| `data/law_sections.json` | One row per section in `data/raw/law_classes_w27.txt` | `python scripts/parse_laws.py data/raw/law_classes_w27.txt > data/law_sections.json` |
| `data/details.json` | `data/raw/*.json` (descriptions, bios, Law class details) | `python scripts/parse_details.py data/raw/booth_details.json data/raw/law_details.json data/raw/law_faculty.json data/law_sections.json > data/details.json` |

Run `python scripts/build.py` after any refresh.

## Directory map

```
src/            app source: index.html, styles.css, app.js
data/           section records and pop-up details (inputs to the build)
data/raw/       source captures the parsers read
scripts/        parsers and the build script
tests/          pytest suite, one file per script plus a browser smoke test
site/           build output: static multi-file site
dist/           build output: single self-contained HTML file
```

## Known gaps

- 47 of 104 Law instructors have no bio. Most are lecturers without a Law School faculty page. Six pages (Boutros, Didwania, Fitzgerald, Ford, Neal, Peterson) were blocked when fetched.
- Some Law seminars meet on select dates but show as weekly. Insurance Law shows both of its listed meeting patterns.
- Five Law sections have no meeting time. They appear in the list but not on the calendar.
