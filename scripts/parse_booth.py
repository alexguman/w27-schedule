"""Extracts Booth section records from a saved Booth bidding "Course Search" page.

Usage:
    python scripts/parse_booth.py "Booth courses.html" > data/booth_sections.json

Input is the page saved from registration.chicagobooth.edu (Course Search, all courses expanded is not
required). Output is a JSON list of section records:
    {"id", "dept": "BUSN", "code", "sec", "name", "fac", "meets": [{"d", "s", "e"}], "note", "cap",
     "prog": [str], "remote"}
where d is the day (0 = Monday) and s/e are minutes after midnight.
"""

import html
import json
import re
import sys
from datetime import date

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
FLAG_NAMES = [
    "eveningMBA",
    "weekendMBA",
    "fulltimeMBA",
    "phdStudentsOnly",
    "remoteOnly",
    "mandatoryAttendance",
    "newCourse",
]
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
        the note lists the dates ("Select dates: ...").
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
            s, e = (to_min(x) for x in p.split("-"))
            days = sorted({date(year, mo, d).weekday() for mo, d in dates})
            meets += [{"d": d, "s": s, "e": e} for d in days]
    return meets, note


def parse_page(page: str) -> list[dict]:
    """Returns one section record per course card in the saved Course Search page."""
    flags = {}
    for m in re.finditer(r"Alpine\.data\('courseCard(\d+)', \(\) => \(\{(.*?)\}\)\)", page, re.DOTALL):
        flags[m[1]] = {k: f"{k}: true" in m[2] for k in FLAG_NAMES}
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
        term = re.search(r'data-courseterm="([^"]*)"', chunk)[1]
        meets, note = parse_times(raw, int(term.split()[-1]))
        cap = re.search(r'class="maxCapacity">(\d+)', chunk)
        f = flags.get(sid, {})
        out.append(
            {
                "id": sid,
                "dept": "BUSN",
                "code": num.split("-")[0],
                "sec": num.split("-")[1],
                "name": name,
                "fac": fac,
                "meets": meets,
                "note": note,
                "cap": int(cap[1]) if cap else None,
                "prog": [label for key, label in PROGRAM_LABELS if f.get(key)],
                "remote": f.get("remoteOnly", False),
            }
        )
    return out


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        page = f.read()
    json.dump(parse_page(page), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
