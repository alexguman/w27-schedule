"""Tests for scripts/build.py, run against the repository's real data."""

import json
import re

from build import ROOT, build


def test_build_writes_site_and_single_file(tmp_path):
    site, page = build(ROOT, tmp_path / "site", tmp_path / "dist")
    assert sorted(p.name for p in site.iterdir()) == [
        "app.js",
        "data.js",
        "index.html",
        "requirements.js",
        "styles.css",
    ]
    html = page.read_text(encoding="utf-8")
    # Everything is inlined: no local file references remain.
    for ref in ('src="data.js"', 'src="requirements.js"', 'src="app.js"', 'href="styles.css"'):
        assert ref not in html
    # One closing tag per script: the inline theme script in <head>, then data.js, requirements.js, app.js.
    assert html.count("</script>") == 4


def test_data_script_holds_all_sections_and_details(tmp_path):
    site, _ = build(ROOT, tmp_path / "site", tmp_path / "dist")
    text = (site / "data.js").read_text(encoding="utf-8")
    sections = json.loads(re.search(r"window\.W27_SECTIONS = (.*);\n", text)[1].replace("<\\/", "</"))
    details = json.loads(re.search(r"window\.W27_DETAILS = (.*);\n", text)[1].replace("<\\/", "</"))
    assert len(sections) == 678  # 580 Booth sections across 2026-27 plus 98 Winter 2027 Law sections
    assert {s["dept"] for s in sections} == {"BUSN", "LAWS"}
    assert {s["term"] for s in sections} == {"Autumn 2026", "Winter 2027", "Spring 2027"}
    assert all(s["id"] in details["sections"] for s in sections)


def test_data_script_holds_requirements(tmp_path):
    site, _ = build(ROOT, tmp_path / "site", tmp_path / "dist")
    text = (site / "data.js").read_text(encoding="utf-8")
    raw = re.search(r"window\.W27_REQUIREMENTS = (.*);\n", text)[1].replace("<\\/", "</")
    requirements = json.loads(raw)
    source = json.loads((ROOT / "data" / "booth_requirements.json").read_text(encoding="utf-8"))
    assert requirements == source
