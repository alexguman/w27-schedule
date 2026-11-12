"""Convert Law School class-search rows (Winter 2027) into section records.

Input rows come from the UC Classes Self-Service search, one per section:
    class_nbr|course|section|type|status|enrollment|instructors ~ meetings|title
Meeting patterns look like "Mon Wed Thu : 01:30 PM-02:35 PM", joined by "&" when a
section lists several. Output matches the Booth record shape produced by parse.py.
"""

import json
import re
import sys

# The input rows come from the Winter 2027 Law School class search.
TERM = "Winter 2027"
DAYS = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}
TYPES = {"CRS": "Course", "SEM": "Seminar", "CLN": "Clinic"}


def to_min(t: str) -> int:
    """Converts '01:30 PM' to minutes after midnight."""
    h, m, ap = re.match(r"(\d+):(\d+)\s*(AM|PM)", t.strip()).groups()
    return (int(h) % 12 + (12 if ap == "PM" else 0)) * 60 + int(m)


def parse_meets(parts: list[str]) -> list[dict]:
    """Expands meeting patterns into one record per day, dropping exact duplicates."""
    seen, meets = set(), []
    for pattern in " & ".join(parts).split("&"):
        m = re.match(r"\s*([A-Za-z ]+?)\s*:\s*(\d+:\d+ [AP]M)-(\d+:\d+ [AP]M)", pattern)
        if not m:
            continue
        s, e = to_min(m[2]), to_min(m[3])
        for day in m[1].split():
            key = (DAYS[day], s, e)
            if key not in seen:
                seen.add(key)
                meets.append({"d": key[0], "s": s, "e": e})
    return sorted(meets, key=lambda x: (x["d"], x["s"]))


def parse_row(row: str) -> dict:
    """Converts one class-search row into a section record (same shape as parse_booth.py's).

    Law sections are 100 units, carry no Booth requirement tags, and are all in TERM.
    """
    nbr, code, sec, kind, _status, enrollment, middle, name = row.split("|", 7)
    parts = [p.strip() for p in middle.split("~")]
    parts = [p for p in parts if not p.startswith("Total Enrollment")]
    fac = parts[0]
    cap = int(enrollment.split("/")[1])
    return {
        "id": "L" + nbr,
        "dept": "LAWS",
        "term": TERM,
        "code": code,
        "sec": sec.zfill(2),
        "name": re.sub(r"\s+", " ", name).strip(),
        "fac": fac,
        "meets": parse_meets(parts[1:]),
        "note": "",
        "cap": cap or None,
        "units": 100,
        "half": None,
        "prog": [TYPES.get(kind, kind)],
        "remote": False,
        "tags": {"areas": [], "rules": []},
    }


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        rows = [line.strip() for line in f if line.strip()]
    json.dump([parse_row(r) for r in rows], sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1])
