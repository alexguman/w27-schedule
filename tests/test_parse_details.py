"""Tests for scripts/parse_details.py."""

from parse_details import clean_law_bio, html_to_paras, last_name, parse_law_detail

SEGMENT = (
    "RETURN\nCorporate Restructuring\nLAWS 43235/01 [20232] - CRS In-Person Closed\nCourse\n"
    "Total Enrollment: 0/0\n(BID, CORE, EXAM, DOC) This course considers restructuring.\n"
    "Learning Outcomes Include:\n● Be familiar with legal reasoning.\n"
    "• This class is open to LLM students only.\n"
    "Instructor\n\t\nDays & Times\n\t\nTimeframe\n\t\nLocation\nVincent Buccola\n\t\n"
    "Mon Wed Thu : 01:30 PM-02:35 PM\n\t\n01/04/2027 - 03/13/2027\n\t\nLaird Bell Quadrangle II\n"
    "Units/Credits\n3 units\nCareer\nLaw School\nEvaluations"
)


def test_html_to_paras_strips_markup_and_styles():
    paras = html_to_paras("<style>p{}</style><p>One&nbsp;two</p><ul><li>Item</li></ul>")
    assert paras == ["One two", "• Item"]


def test_parse_law_detail_splits_fields():
    info = parse_law_detail(SEGMENT)
    assert info["tags"] == "BID, CORE, EXAM, DOC"
    assert info["desc"] == "This course considers restructuring."
    assert info["outcomes"] == ["Be familiar with legal reasoning."]
    assert info["notes"] == ["This class is open to LLM students only."]
    assert info["instructors"] == ["Vincent Buccola"]
    assert info["loc"] == "Laird Bell Quadrangle II"
    assert info["dates"] == "01/04/2027 - 03/13/2027"
    assert info["units"] == "3 units"


def test_clean_law_bio_drops_appointment_lists():
    bio = (
        "She teaches law. She writes too.\n\n"
        "Professor of Law (2024 \u2013 Present)Lecturer (2020 \u2013 2024)"
    )
    assert clean_law_bio(bio) == ["She teaches law. She writes too."]


def test_last_name():
    assert last_name("Judith P. Miller") == "miller"
    assert last_name("Myerscough-Mueller") == "myerscough-mueller"
