"""Extracts Booth section records from a saved Booth bidding "Course Search" page.

Usage:
    python scripts/parse_booth.py "Booth courses.html" > data/booth_sections.json

Input is the page saved from registration.chicagobooth.edu (Course Search). It may hold one quarter or
the whole year (the "2026/2027" view); each card's quarter comes from the quarter heading above it.
Output is a JSON list of section records:
    {"id", "dept": "BUSN", "term", "code", "sec", "name", "fac", "meets": [{"d", "s", "e"}], "note",
     "cap", "units", "half", "prog": [str], "remote", "tags": {"areas": [str], "rules": [str]}}
where d is the day (0 = Monday) and s/e are minutes after midnight. "half" is "first", "second" or
"all" for 50-unit courses and null otherwise. "tags" are Booth's own requirement tags for the section:
degree areas and concentrations ("Foundations", "Finance") and requirement rows ("Statistics").

Personal fields on the page (planned, bid on, enrolled, waitlisted, taken) are deliberately not read.
"""

import html
import json
import re
import sys
from datetime import date

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
FLAG_NAMES = [
    "firstFiftyCourse",
    "secondFiftyCourse",
    "allFiftyCourse",
    "eveningMBA",
    "weekendMBA",
    "fulltimeMBA",
    "phdStudentsOnly",
    "remoteOnly",
    "mandatoryAttendance",
    "newCourse",
]
HALF_FLAGS = [("first", "firstFiftyCourse"), ("second", "secondFiftyCourse"), ("all", "allFiftyCourse")]
PROGRAM_LABELS = [
    ("fulltimeMBA", "FT"),
    ("eveningMBA", "Evening"),
    ("weekendMBA", "Weekend"),
    ("phdStudentsOnly", "PhD only"),
]


def to_min(t: str) -> int:
    """Converts a clock time such as '3:30 PM' to minutes after midnight."""
    h, m, ap = re.match(r"(\d+):(\d+)\s*(AM|PM)", t.strip()).groups()
    return (int(h) % 12 + (12 if ap == "PM" else 0)) * 60 + int(m)


def parse_times(raw: str, year: int) -> tuple[list[dict], str]:
    """Parses a card's meeting markup into weekly meetings plus a note.

    Args:
        raw: Inner HTML of the card's courseTime spans, joined with "<br>". Weekly sections read
            "Tuesday, 3:30 PM - 4:50 PM"; date-based sections list dates ("1/04, 1/11") then hours.
        year: Calendar year of the term, used to find the weekday of listed dates.

    Returns:
        (meetings, note). Date-based sections become one weekly meeting per weekday they touch, and
        the note lists the dates ("Select dates: ..."). Hours without a day or dates give no meetings
        and the note "Day not listed: ..."; "TBD" gives no meetings and the note "Time TBD".
    """
    parts = [html.unescape(p).strip() for p in re.split(r"<br>|<span>|</span>", raw)]
    meets, note, dates = [], "", []
    for p in (p for p in parts if p):
        m = re.match(r"(\w+day),\s*(.+?)\s*-\s*(.+)$", p)
        if m:
            meets.append({"d": DAYS.index(m[1]), "s": to_min(m[2]), "e": to_min(m[3])})
        elif re.match(r"^\d+/\d+", p):
            dates = [tuple(map(int, x.split("/"))) for x in p.split(",")]
            note = "Select dates: " + p
        elif re.match(r"^\d+:\d+", p):
            if not dates:
                # Booth sometimes lists hours with no day; keep them visible instead of dropping them.
                note = f"Day not listed: {p}"
                continue
            s, e = (to_min(x) for x in p.split("-"))
            days = sorted({date(year, mo, d).weekday() for mo, d in dates})
            meets += [{"d": d, "s": s, "e": e} for d in days]
        elif p.upper() == "TBD":
            note = "Time TBD"
    return meets, note


def requirement_names(page: str) -> tuple[dict[str, str], dict[str, str]]:
    """Returns (area id -> name, rule id -> name) from the page's postJsonData lookup table."""
    m = re.search(r'id="postJsonData" name="postJsonData" type="hidden" value="([^"]*)"', page)
    if not m:
        return {}, {}
    data = json.loads(html.unescape(m[1]))
    areas = {str(a["AreaId"]): a["AreaName"] for a in data["DegreeRequirements"] + data["Concentrations"]}
    rules = {str(r["RuleGroupId"]): r["RuleGroupName"] for r in data["Rules"]}
    return areas, rules


def parse_page(page: str) -> list[dict]:
    """Returns one section record per course card in the saved Course Search page."""
    flags, tag_ids = {}, {}
    pattern = r"Alpine\.data\('courseCard(\d+)', \(\) => \(\{(.*?)\}\)\)"
    for m in re.finditer(pattern, page, re.DOTALL):
        flags[m[1]] = {k: re.search(rf"{k}\s*:\s*true", m[2]) is not None for k in FLAG_NAMES}
        areas = re.search(r'cardAreas:\s*"([^"]*)"', m[2])
        rules = re.search(r'cardRules:\s*"([^"]*)"', m[2])
        tag_ids[m[1]] = (areas[1].split() if areas else [], rules[1].split() if rules else [])
    area_names, rule_names = requirement_names(page)
    # Quarter headings ("<h2 ...>Spring 2027</h2>") open each quarter's block of cards.
    headings = [
        (h.start(), h[1])
        for h in re.finditer(r"<h2[^>]*>\s*((?:Autumn|Winter|Spring|Summer) \d{4})\s*</h2>", page)
    ]
    starts = list(re.finditer(r'x-data="courseCard(\d+)"', page))
    out = []
    for i, m in enumerate(starts):
        chunk = page[m.start() : starts[i + 1].start() if i + 1 < len(starts) else len(page)]
        sid = m[1]
        name = html.unescape(re.search(r'class="courseName"[^>]*>([^<]*)', chunk)[1]).strip()
        num = re.search(r'class="courseNumber"[^>]*>([^<]*)', chunk)[1].strip()
        fac = re.search(r'class="facultyName"[^>]*>(.*?)</span></h6>', chunk, re.DOTALL)[1]
        fac = html.unescape(re.sub(r"<[^>]+>", "", fac)).strip()
        raw = re.findall(r'<span class="courseTime">(.*?)</span></h6>', chunk, re.DOTALL)
        # Date-based sections split dates and hours across two courseTime spans.
        raw = "<br>".join(r for r in raw if r.strip())
        term = card_term(chunk, m.start(), headings)
        meets, note = parse_times(raw, int(term.split()[-1]))
        cap = re.search(r'class="maxCapacity">(\d+)', chunk)
        f = flags.get(sid, {})
        half = next((h for h, k in HALF_FLAGS if f.get(k)), None)
        area_ids, rule_ids = tag_ids.get(sid, ([], []))
        out.append(
            {
                "id": sid,
                "dept": "BUSN",
                "term": term,
                "code": num.split("-")[0],
                "sec": num.split("-")[1],
                "name": name,
                "fac": fac,
                "meets": meets,
                "note": note,
                "cap": int(cap[1]) if cap else None,
                "units": 50 if half else 100,
                "half": half,
                "prog": [label for key, label in PROGRAM_LABELS if f.get(key)],
                "remote": f.get("remoteOnly", False),
                "tags": {
                    "areas": [area_names.get(a, a) for a in area_ids],
                    "rules": [rule_names.get(r, r) for r in rule_ids],
                },
            }
        )
    return out


def card_term(chunk: str, pos: int, headings: list[tuple[int, str]]) -> str:
    """Returns a card's quarter: its own data-courseterm, else the last quarter heading above it.

    Raises:
        ValueError: if neither is present, so a page layout change cannot silently mislabel courses.
    """
    own = re.search(r'data-courseterm="([^"]*)"', chunk)
    if own:
        return own[1]
    above = [term for start, term in headings if start < pos]
    if not above:
        raise ValueError("course card has no quarter: no data-courseterm and no quarter heading above it")
    return above[-1]


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        page = f.read()
    json.dump(parse_page(page), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
