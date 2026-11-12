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


def test_requirements_panel_separates_sources(page):
    pg, errors = page
    pg.evaluate("localStorage.clear()")
    pg.reload()
    # Winter: Financial Accounting on the schedule, Marketing Strategy contemplated.
    pg.fill("#search", "30000")
    pg.locator('.res[data-code="Wi27-BUSN30000"]').click()
    pg.fill("#search", "37000")
    pg.locator('#results [data-info="Wi27-BUSN37000"]').click()
    pg.locator("[data-dlg=add][data-to=contemplated]").click()
    pg.keyboard.press("Escape")
    # Other quarters: 35100, completed in Autumn. Its title comes from the Winter data.
    pg.click("#tab-requirements")
    pg.fill("#oq-num", "35100")
    assert pg.input_value("#oq-title") != ""
    pg.fill("#oq-quarter", "Autumn 2026")
    pg.click("#oq-add")

    total = pg.locator("#req-total + .rprog")
    by_source = [total.get_attribute(f"data-{s}") for s in ("other", "scheduled", "contemplated")]
    assert by_source == ["100", "100", "100"]
    assert pg.locator('[data-row="fa"] .rc.src-scheduled').count() == 1
    assert pg.locator('[data-row="finance"] .rc.src-other').count() == 1
    assert pg.locator('[data-row="marketing"] .rc.src-contemplated').count() == 1
    # Saved under its own key; the schedule key keeps its old format.
    saved = pg.evaluate("JSON.parse(localStorage.getItem('w27-requirements')).other.map(o => o.num)")
    assert saved == ["35100"]
    assert pg.evaluate("JSON.parse(localStorage.getItem('booth-w27-schedule')).length") == 2
    assert errors == []


def _fresh(pg):
    """Clears this page's saved state (schedule, quarter, requirements, theme) and reloads it."""
    pg.evaluate("localStorage.clear()")
    pg.reload()


def _add(pg, code, status="planned"):
    """Adds course `code` (a key such as "Au26-BUSN30000") from the search list of the quarter on screen."""
    pg.fill("#search", code.split("-BUSN")[1])
    if status == "planned":
        pg.locator(f'.res[data-code="{code}"]').click()
    else:
        pg.locator(f'#results [data-info="{code}"]').click()
        pg.locator("[data-dlg=add][data-to=contemplated]").click()
        pg.keyboard.press("Escape")


def test_quarters_count_together_in_requirements(page):
    pg, errors = page
    _fresh(pg)
    assert pg.get_attribute('#terms [data-term="Winter 2027"]', "aria-pressed") == "true"
    assert [b.text_content() for b in pg.locator("#terms button").all()] == [
        "Autumn 2026",
        "Winter 2027",
        "Spring 2027",
    ]

    pg.click('#terms [data-term="Autumn 2026"]')
    _add(pg, "Au26-BUSN30000")
    assert pg.locator("#selected .pill").count() == 1
    pg.click('#terms [data-term="Spring 2027"]')
    # Autumn's pick is not shown in Spring; the search list holds only Spring courses.
    assert pg.locator("#selected .pill").count() == 0
    pg.fill("#search", "33918")
    assert "Time TBD" in pg.text_content('.res[data-code="Sp27-BUSN33918"]')
    _add(pg, "Sp27-BUSN37000")
    assert pg.locator(".blk").count() >= 1
    assert pg.get_attribute("#units-stat", "data-scheduled") == "100"
    # Law courses are Winter-only.
    pg.click("#school-laws")
    assert "Winter 2027 only" in pg.text_content("#results")
    pg.click("#school-all")

    pg.click("#tab-requirements")
    assert "Autumn 2026" in pg.text_content('[data-row="fa"] .rc.src-scheduled')
    assert "Spring 2027" in pg.text_content('[data-row="marketing"] .rc.src-scheduled')
    assert pg.get_attribute("#req-total + .rprog", "data-scheduled") == "200"

    # The same course in a second quarter counts once and is flagged in both places.
    pg.click("#tab-calendar")
    _add(pg, "Sp27-BUSN30000", "contemplated")
    assert "Also in Autumn 2026" in pg.text_content('#selected .pill[data-code="Sp27-BUSN30000"]')
    pg.click("#tab-requirements")
    assert pg.locator("#req-dups").count() == 1
    total = pg.locator("#req-total + .rprog")
    assert [total.get_attribute(f"data-{s}") for s in ("scheduled", "contemplated")] == ["200", "0"]

    # The quarter on screen is remembered.
    pg.reload()
    assert pg.get_attribute('#terms [data-term="Spring 2027"]', "aria-pressed") == "true"
    # A first-half and a second-half course never clash.
    assert pg.evaluate("halvesOverlap({half: 'first'}, {half: 'second'})") is False
    assert pg.evaluate("halvesOverlap({half: 'first'}, {half: null})") is True
    assert errors == []


def test_schedule_saved_before_quarters_still_loads(page):
    pg, errors = page
    _fresh(pg)
    # Saves from earlier versions: a bare number key, a dept-plus-number key, no status on the first.
    pg.evaluate(
        """(() => {
          const id = code => SECTIONS.find(s => s.term === "Winter 2027" && s.code === code).id;
          localStorage.setItem("booth-w27-schedule", JSON.stringify([
            {code: "30000", id: id("30000"), hue: 212},
            {code: "BUSN35100", id: id("35100"), hue: 152, status: "contemplated"},
          ]));
          localStorage.setItem("w27-term", "Spring 2027");
        })()"""
    )
    pg.reload()
    assert pg.locator("#selected .pill").count() == 0
    pg.click('#terms [data-term="Winter 2027"]')
    codes = [li.get_attribute("data-code") for li in pg.locator("#selected .pill").all()]
    assert sorted(codes) == ["Wi27-BUSN30000", "Wi27-BUSN35100"]
    assert pg.locator("#selected .pill.maybe").count() == 1
    assert errors == []


def test_theme_defaults_to_light_and_toggle_persists(page):
    pg, errors = page
    # A new page in a browser that prefers dark: the site still starts light.
    dark_os = pg.context.browser.new_page(color_scheme="dark")
    dark_os.goto(pg.url)
    dark_os.evaluate("localStorage.removeItem('w27-theme')")
    dark_os.reload()
    assert dark_os.evaluate("document.documentElement.dataset.theme") == "light"
    assert dark_os.get_attribute("#theme-toggle", "aria-label") == "Switch to dark theme"
    dark_os.click("#theme-toggle")
    dark_os.reload()
    assert dark_os.evaluate("document.documentElement.dataset.theme") == "dark"
    assert dark_os.get_attribute("#theme-toggle", "aria-label") == "Switch to light theme"
    background = dark_os.evaluate("getComputedStyle(document.body).backgroundColor")
    assert background == "rgb(22, 19, 20)"  # --bg in the dark theme
    dark_os.evaluate("localStorage.removeItem('w27-theme')")
    dark_os.close()
    assert errors == []


DISCLAIMER = (
    "This is my personal tool, please don't rely on it when making important and/or life-altering decisions."
)


def test_finance_components_explain_rules_and_gaps(page):
    pg, errors = page
    _fresh(pg)
    assert pg.locator("#disclaimer").is_visible()
    assert pg.text_content("#disclaimer").strip() == DISCLAIMER
    pg.click("#tab-requirements")
    pg.check('[data-track="finance"]')
    expected = {
        "asset_pricing": ("35000 Investments", "asset-pricing list"),
        "corporate": ("35200 Corporation Finance", "corporate-finance list"),
    }
    for comp, (core, list_name) in expected.items():
        text = pg.locator(f'[data-conc="finance"] [data-comp="{comp}"]').inner_text()
        assert f"100 units from the {list_name} (includes {core})" in text
        assert f"Needs 100 more units from the {list_name}" in text
    # "What counts" lists every qualifying course with its title and stays open across re-renders.
    what = pg.locator('[data-conc="finance"] [data-comp="asset_pricing"] details.what')
    what.locator("summary").click()
    assert what.locator(".what-list li").count() == 12
    assert "35000 Investments" in what.inner_text()
    pg.select_option("#req-program", "jdmba")
    assert pg.locator('[data-conc="finance"] [data-comp="asset_pricing"] details.what[open]').count() == 1
    pg.click("#tab-calendar")
    assert pg.locator("#disclaimer").is_visible()
    assert errors == []
