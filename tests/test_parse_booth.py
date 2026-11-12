"""Tests for scripts/parse_booth.py."""

import html
import json

import pytest
from parse_booth import card_term, parse_page, parse_times, to_min


def test_to_min_handles_noon_and_midnight():
    assert to_min("12:00 AM") == 0
    assert to_min("12:30 PM") == 12 * 60 + 30
    assert to_min("3:30 PM") == 15 * 60 + 30


def test_parse_times_weekly_meetings():
    raw = "Tuesday, 3:30 PM - 4:50 PM<br><span>Thursday, 3:30 PM - 4:50 PM</span>"
    meets, note = parse_times(raw, 2027)
    assert meets == [{"d": 1, "s": 930, "e": 1010}, {"d": 3, "s": 930, "e": 1010}]
    assert note == ""


def test_parse_times_date_list_becomes_weekdays_with_note():
    # 1/04/2027 is a Monday and 1/27/2027 a Wednesday.
    meets, note = parse_times("1/04, 1/11, 1/27<br>5:30 PM - 8:30 PM", 2027)
    assert meets == [{"d": 0, "s": 1050, "e": 1230}, {"d": 2, "s": 1050, "e": 1230}]
    assert note == "Select dates: 1/04, 1/11, 1/27"


CARD = """
<script>Alpine.data('courseCard1', () => ({ eveningMBA: true, fulltimeMBA: false,
remoteOnly: false }))</script>
<div x-data="courseCard1">
<span class="courseName">Pricing Strategies</span>
<span class="courseNumber">37103-81</span>
<h6><span class="facultyName"><a>Dub&eacute;, Jean-Pierre</a></span></h6>
<h6><span class="courseTime">Monday, 6:00 PM - 9:00 PM</span></h6>
<span class="maxCapacity">60</span>
<button data-courseterm="Winter 2027"></button>
</div>
"""


def test_parse_page_reads_one_card():
    [rec] = parse_page(CARD)
    assert rec["code"] == "37103" and rec["sec"] == "81" and rec["dept"] == "BUSN"
    assert rec["fac"] == "Dubé, Jean-Pierre"
    assert rec["meets"] == [{"d": 0, "s": 1080, "e": 1260}]
    assert rec["cap"] == 60 and rec["prog"] == ["Evening"] and rec["remote"] is False


def test_parse_times_tbd_and_missing_day():
    assert parse_times("TBD", 2027) == ([], "Time TBD")
    assert parse_times("6:00 PM - 9:00 PM", 2027) == ([], "Day not listed: 6:00 PM - 9:00 PM")


LOOKUP = {
    "DegreeRequirements": [{"AreaId": 2, "AreaName": "Foundations"}],
    "Concentrations": [{"AreaId": 7, "AreaName": "Accounting"}],
    "Rules": [{"AreaId": "2", "RuleGroupName": "Financial Accounting", "RuleGroupId": "71"}],
}
YEAR_PAGE = """
{lookup}
<h2 class="x">Autumn 2026</h2>
<script>Alpine.data('courseCard5', () => ({ fulltimeMBA: true, firstFiftyCourse: true,
cardAreas: "2 7", cardRules: "71", coursePlanned: true, courseTaken: true }))</script>
<div x-data="courseCard5">
<span class="courseName">Financial Accounting</span>
<span class="courseNumber">30000-01</span>
<h6><span class="facultyName"><a>Nikolaev, Valeri</a></span></h6>
<h6><span class="courseTime">Monday, 8:30 AM - 11:30 AM</span></h6>
</div>
<h2 class="x">Spring 2027</h2>
<div x-data="courseCard6">
<span class="courseName">Research Seminar</span>
<span class="courseNumber">35932-01</span>
<h6><span class="facultyName"><a>Staff</a></span></h6>
<h6><span class="courseTime">TBD</span></h6>
</div>
""".replace(
    "{lookup}",
    f'<input id="postJsonData" name="postJsonData" type="hidden" value="{html.escape(json.dumps(LOOKUP))}">',
)


def test_parse_page_full_year_terms_units_and_tags():
    first, second = parse_page(YEAR_PAGE)
    assert first["term"] == "Autumn 2026" and second["term"] == "Spring 2027"
    assert first["units"] == 50 and first["half"] == "first"
    assert first["tags"] == {"areas": ["Foundations", "Accounting"], "rules": ["Financial Accounting"]}
    assert second["meets"] == [] and second["note"] == "Time TBD" and second["units"] == 100


def test_parse_page_never_reads_personal_status():
    [rec, _] = parse_page(YEAR_PAGE)
    text = str(rec).lower()
    for field in ("planned", "taken", "enrolled", "bid", "waitlist"):
        assert field not in text


def test_card_term_requires_a_quarter():
    with pytest.raises(ValueError):
        card_term("<div></div>", 10, [])
