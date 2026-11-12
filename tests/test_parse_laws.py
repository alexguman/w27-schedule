"""Tests for scripts/parse_laws.py."""

from parse_laws import parse_meets, parse_row


def test_parse_meets_expands_days_and_drops_duplicates():
    meets = parse_meets(["Thu : 07:30 PM-09:30 PM   &   Thu : 07:30 PM-09:30 PM"])
    assert meets == [{"d": 3, "s": 1170, "e": 1290}]


def test_parse_meets_keeps_distinct_patterns():
    meets = parse_meets(["Tue : 09:30 AM-11:45 AM   &   Mon Wed : 09:25 AM-10:50 AM"])
    assert [(m["d"], m["s"]) for m in meets] == [(0, 565), (1, 570), (2, 565)]


def test_parse_meets_no_time_listed():
    assert parse_meets([]) == []


def test_parse_row_normalizes_section_and_drops_enrollment_line():
    row = (
        "20275|53263|1|SEM|C|0/0|Total Enrollment: 0/35 ~ Hirschel ~ Wed : 04:00 PM-06:00 PM"
        "|Visual Arts and the Law"
    )
    rec = parse_row(row)
    assert rec["id"] == "L20275" and rec["dept"] == "LAWS" and rec["sec"] == "01"
    assert rec["fac"] == "Hirschel" and rec["cap"] is None and rec["prog"] == ["Seminar"]
    assert rec["meets"] == [{"d": 2, "s": 960, "e": 1080}]


def test_parse_row_sets_term_units_and_empty_tags():
    rec = parse_row(
        "20227|30211|01|CRS|O|34/85|Casey ~ Mon Wed Thu : 01:30 PM-02:35 PM|Civil Procedure (for LLMs)"
    )
    assert rec["term"] == "Winter 2027" and rec["units"] == 100 and rec["half"] is None
    assert rec["tags"] == {"areas": [], "rules": []}
