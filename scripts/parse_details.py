"""Builds details.json for the schedule builder's course and professor pop-ups.

Inputs (paths as arguments, in this order):
    booth_details.json  {desc: {sectionId: html}, fac: {facId: {name, title, bio}},
                         facBySection: {sectionId: [facId]}}
    law_details.json    {classNbr: text of the class-detail panel in UC Classes Self-Service}
    law_faculty.json    {lastNameSlug: {name, bio, path} | null | {error}}
    laws.json           Law section records from parse_laws.py (instructor last names per section)

Output on stdout:
    {"texts": [str],                       # de-duplicated description texts, referenced by index
     "sections": {id: {"d": textIndex, "tags", "notes", "outcomes", "loc", "dates", "units", "p": [profId]}},
     "profs": {profId: {"name", "title", "bio": [paragraph], "url", "school"}}}
All HTML is reduced to plain-text paragraphs, so the page never renders fetched markup.
"""

import html
import json
import re
import sys
from html.parser import HTMLParser

LAW_SITE = "https://www.law.uchicago.edu"
BLOCK_TAGS = frozenset({"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4"})


class _TextExtractor(HTMLParser):
    """Collects text, starting a new paragraph at block tags and prefixing list items with a bullet."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paras: list[str] = [""]
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("style", "script"):
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self.paras.append("• " if tag == "li" else "")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("style", "script"):
            self._skip = max(0, self._skip - 1)
        elif tag in BLOCK_TAGS:
            self.paras.append("")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.paras[-1] += data


def html_to_paras(markup: str) -> list[str]:
    """Converts an HTML fragment into a list of non-empty, whitespace-normalized paragraphs."""
    parser = _TextExtractor()
    parser.feed(markup or "")
    paras = [re.sub(r"\s+", " ", p.replace("\xa0", " ")).strip() for p in parser.paras]
    return [p for p in paras if p and p != "•"]


def parse_law_detail(seg: str) -> dict:
    """Splits one Law class-detail panel into description, notes, outcomes, instructors and room."""
    head_end = seg.find("Instructor\n\t\nDays")
    body = seg[:head_end] if head_end >= 0 else seg
    lines = [ln.strip() for ln in body.split("\n")]
    start = next((i + 1 for i, ln in enumerate(lines) if ln.startswith("Total Enrollment")), 0)
    desc, notes, outcomes = [], [], []
    for ln in lines[start:]:
        if not ln or ln.startswith("Learning Outcomes"):
            continue
        if ln.startswith("●"):
            outcomes.append(ln.lstrip("● ").strip())
        elif not desc:
            desc.append(ln)
        else:
            notes.append(ln.lstrip("•· ").strip())
    tags = ""
    if desc:
        m = re.match(r"^\(([A-Z0-9 ,/+\-]+)\)\s*", desc[0])
        if m:
            tags, desc[0] = m[1], desc[0][m.end() :]
    instructors, dates, loc = [], "", ""
    table_at = seg.find("Timeframe\n\t\nLocation\n")
    if table_at >= 0:
        table = seg[table_at + len("Timeframe\n\t\nLocation\n") :]
        table = table[: table.find("Units/Credits")] if "Units/Credits" in table else table
        cells = table.split("\n\t\n")
        rows = [cells[0]] + [c.split("\n", 1)[1] if "\n" in c else "" for c in cells[3::3]]
        for cell in rows:
            instructors += [n.strip() for n in re.split(r",\s*|\n", cell) if n.strip()]
        dates = cells[2].strip() if len(cells) > 2 else ""
        loc = cells[3].split("\n")[0].strip() if len(cells) > 3 else ""
    units = re.search(r"Units/Credits\n([^\n]+)", seg)
    return {
        "desc": " ".join(desc),
        "tags": tags,
        "notes": notes,
        "outcomes": outcomes,
        "instructors": list(dict.fromkeys(i for i in instructors if i.lower() != "staff")),
        "dates": dates,
        "loc": loc,
        "units": units[1].strip() if units else "",
    }


def clean_law_bio(bio: str) -> list[str]:
    """Splits a Law School bio into paragraphs, dropping run-together appointment lists.

    Faculty pages list past positions as "Professor of Law (2024 - Present)Visiting ..." (with an en
    dash) and no sentence breaks; such paragraphs carry a "(YYYY - ...)" span and no ". " between sentences.
    """
    keep = []
    for para in (p.strip() for p in bio.split("\n\n")):
        # The re module reads \u2013 (en dash) inside the raw pattern.
        dated = re.search(r"\(\d{4}\s*[\u2013-]\s*(Present|\d{4})\)", para)
        prose = re.search(r"[a-z)]\. [A-Z]", para)
        if para and not (dated and not prose):
            keep.append(para)
    return keep


def last_name(full: str) -> str:
    return re.sub(r"[^a-z\-]", "", full.split()[-1].lower()) if full.split() else ""


def main(booth_path: str, law_path: str, law_fac_path: str, laws_path: str) -> None:
    with open(booth_path, encoding="utf-8") as f:
        booth = json.load(f)
    with open(law_path, encoding="utf-8") as f:
        law = json.load(f)
    with open(law_fac_path, encoding="utf-8") as f:
        law_fac = json.load(f)
    with open(laws_path, encoding="utf-8") as f:
        law_sections = {rec["id"]: rec for rec in json.load(f)}

    texts: list[str] = []
    text_index: dict[str, int] = {}

    def intern(paragraphs: list[str]) -> int | None:
        joined = "\n".join(paragraphs).strip()
        if not joined or joined.startswith("There is no description"):
            return None
        if joined not in text_index:
            text_index[joined] = len(texts)
            texts.append(joined)
        return text_index[joined]

    profs: dict[str, dict] = {}
    for fid, fac in booth["fac"].items():
        profs[f"B{fid}"] = {
            "name": html.unescape(fac.get("name") or ""),
            "title": html.unescape(fac.get("title") or ""),
            "bio": html_to_paras(fac.get("bio") or ""),
            "url": "",
            "school": "Booth",
        }
    booth_by_last = {last_name(p["name"]): pid for pid, p in profs.items()}

    sections: dict[str, dict] = {}
    for sid, markup in booth["desc"].items():
        sections[sid] = {
            "d": intern(html_to_paras(markup)),
            "p": [f"B{x}" for x in booth["facBySection"].get(sid, [])],
        }

    for nbr, seg in law.items():
        sid = "L" + nbr
        info = parse_law_detail(seg)
        prof_ids = []
        listed = law_sections.get(sid, {}).get("fac", "")
        full_names = info["instructors"] or [n.strip() for n in listed.split(",") if n.strip()]
        for full in full_names:
            ln = last_name(full)
            page = law_fac.get(ln) if isinstance(law_fac.get(ln), dict) else None
            # A faculty page counts only if its first initial matches, so a shared surname
            # cannot attach the wrong bio.
            same_person = bool(
                page
                and page.get("name")
                and full.split()
                and page["name"].split()[0][0].lower() == full.split()[0][0].lower()
                and last_name(page["name"]) == ln
            )
            booth_match = booth_by_last.get(ln)
            if booth_match and profs[booth_match]["name"].split()[0][0].lower() == full.split()[0][0].lower():
                pid = booth_match
            else:
                pid = "L" + re.sub(r"[^a-z]", "", full.lower())
                if pid not in profs:
                    profs[pid] = {
                        "name": page["name"] if same_person else full,
                        "title": "",
                        "bio": clean_law_bio(page.get("bio") or "") if same_person else [],
                        "url": LAW_SITE + page["path"] if same_person and page.get("path") else "",
                        "school": "Law",
                    }
            prof_ids.append(pid)
        sections[sid] = {
            "d": intern([info["desc"]]),
            "tags": info["tags"],
            "notes": info["notes"],
            "outcomes": info["outcomes"],
            "loc": info["loc"],
            "dates": info["dates"],
            "units": info["units"],
            "p": prof_ids,
        }

    for sec in sections.values():
        for key in [k for k, v in sec.items() if v in ("", [], None)]:
            del sec[key]
    json.dump(
        {"texts": texts, "sections": sections, "profs": profs},
        sys.stdout,
        ensure_ascii=False,
        separators=(",", ":"),
    )


if __name__ == "__main__":
    main(*sys.argv[1:5])
