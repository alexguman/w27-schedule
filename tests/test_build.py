"""Tests for scripts/build.py, run against the repository's real data."""

import json
import re

from build import ROOT, build


def test_build_writes_site_and_single_file(tmp_path):
    site, page = build(ROOT, tmp_path / "site", tmp_path / "dist")
    assert sorted(p.name for p in site.iterdir()) == ["app.js", "data.js", "index.html", "styles.css"]
    html = page.read_text(encoding="utf-8")
    # Everything is inlined: no local file references remain.
    assert 'src="data.js"' not in html and 'src="app.js"' not in html and 'href="styles.css"' not in html
    # Only the closing tags of the three inlined blocks, the dialog script and the page itself.
    assert html.count("</script>") == 2


def test_data_script_holds_all_sections_and_details(tmp_path):
    site, _ = build(ROOT, tmp_path / "site", tmp_path / "dist")
    text = (site / "data.js").read_text(encoding="utf-8")
    sections = json.loads(re.search(r"window\.W27_SECTIONS = (.*);\n", text)[1].replace("<\\/", "</"))
    details = json.loads(re.search(r"window\.W27_DETAILS = (.*);\n", text)[1].replace("<\\/", "</"))
    assert len(sections) == 286
    assert {s["dept"] for s in sections} == {"BUSN", "LAWS"}
    assert all(s["id"] in details["sections"] for s in sections)
