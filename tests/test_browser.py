"""Browser smoke test for dist/schedule-builder.html. Skipped when Playwright or a browser is missing.

Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled Chromium.
"""

import os

import pytest
from build import ROOT, build

playwright = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def page(tmp_path_factory):
    _, single = build(ROOT, tmp_path_factory.mktemp("site"), tmp_path_factory.mktemp("dist"))
    with playwright.sync_playwright() as p:
        try:
            browser = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        except Exception as exc:  # no browser installed
            pytest.skip(f"no browser available: {exc}")
        pg = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(single.as_uri())
        yield pg, errors
        browser.close()


def test_add_contemplate_and_open_every_popup(page):
    pg, errors = page
    pg.fill("#search", "corporate restructuring")
    pg.locator(".res").first.click()
    pg.fill("#search", "ethics for transactional")
    pg.locator("#results [data-info]").first.click()
    pg.locator("[data-dlg=add][data-to=contemplated]").click()
    pg.keyboard.press("Escape")
    assert pg.locator(".blk.maybe").count() == 3
    assert pg.locator(".blk.would-clash").count() == 3
    assert pg.locator(".band").count() == 0
    opened = pg.evaluate(
        "(() => { let k = 0; for (const c of COURSE_LIST) { openCourse(c.code); k++; }"
        " for (const id in DETAILS.profs) { openProf(id); k++; } DLG.close(); return k; })()"
    )
    assert opened > 400
    assert errors == []
