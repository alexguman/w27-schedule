"""Tests for scripts/parse_booth.py."""

from parse_booth import parse_page, parse_times, to_min


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
