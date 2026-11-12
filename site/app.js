/**
 * Booth Course Schedule Builder: weekly calendars for picking Booth (BUSN) and Law School (LAWS) sections in each
 * quarter of 2026-27, with Booth degree-requirement tracking across quarters.
 *
 * Inputs: window.W27_SECTIONS, window.W27_DETAILS and window.W27_REQUIREMENTS, set by data.js (built by
 * scripts/build.py), and window.W27Req from requirements.js (the degree-requirement engine).
 * Side effects: renders into the elements of index.html; keeps the viewer's selection in localStorage
 * under "booth-w27-schedule" and "w27-show-contemplated", requirement tracking under "w27-requirements", and the
 * last viewed quarter under "w27-term". The theme ("w27-theme") is applied by the inline script in index.html.
 */
"use strict";

/** Pop-up details: texts (shared descriptions), sections {id: {d, tags, notes, outcomes, loc, dates, units, p}},
 *  profs {id: {name, title, bio, url, school}}. Booth data comes from the bidding site's description and
 *  faculty loaders; Law data from UC Classes Self-Service class details and Law School faculty pages. */
const DETAILS = window.W27_DETAILS;

/** Section records for 2026-27: Booth (dept BUSN, Autumn to Spring) from the Booth course-search export,
 *  Law School (dept LAWS, Winter 2027 only) from UC Classes Self-Service. Section ids are unique across the year.
 *  term: "Autumn 2026" etc. meets: d = day index (0 = Monday), s/e = start/end in minutes after midnight; empty
 *  meets = no time listed, and note says why ("Time TBD"). units: 50 or 100; half: for 50-unit courses, "first",
 *  "second" or "all" (full quarter), else null. tags: Booth's own requirement tags, reference only (not counted). */
const SECTIONS = window.W27_SECTIONS;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GRID_START = 8 * 60;   // 8:00 AM
const GRID_END = 22 * 60;    // 10:00 PM
const HUES = [212, 152, 28, 280, 350, 190, 48, 110, 250, 320];
const STORE_KEY = "booth-w27-schedule";

const SCHOOLS = { BUSN: "Booth", LAWS: "Law" };

/** Calendar position of a season within its year, for ordering quarters ("Autumn 2026" before "Winter 2027"). */
const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Autumn: 3 };

/** Sort number for a quarter name: smaller is earlier. */
function termOrder(term) {
  const [season, year] = term.split(" ");
  return Number(year) * 4 + (SEASON_ORDER[season] ?? 0);
}

/** Quarters in the data, in calendar order. */
const TERMS = [...new Set(SECTIONS.map(s => s.term))].sort((a, b) => termOrder(a) - termOrder(b));
const DEFAULT_TERM = TERMS.includes("Winter 2027") ? "Winter 2027" : TERMS[0];
/** Quarters that list Law School courses, for the Law filter's empty-quarter message. */
const LAW_TERMS = TERMS.filter(t => SECTIONS.some(s => s.term === t && s.dept === "LAWS"));

/** Short ASCII prefix for a quarter in course keys: "Autumn 2026" -> "Au26". */
function termKey(term) {
  return term.slice(0, 2) + term.slice(-2);
}

/** Courses keyed by an ASCII course key (course.code): quarter prefix plus dept and number, e.g. "Wi27-BUSN30000",
 *  because course numbers repeat across quarters. Sections are sorted by first meeting from Monday 8 AM. Sections
 *  that share a quarter and number but not a title (the Law School's Greenberg Seminars, LAWS 92000) are separate
 *  courses with keys like "Wi27-LAWS92000.2". num is the normalized course number shared across quarters. */
const COURSES = new Map();
{
  const titlesByNumber = new Map();
  for (const sec of SECTIONS) {
    const num = `${termKey(sec.term)}-${sec.dept}${sec.code}`;
    if (!titlesByNumber.has(num)) titlesByNumber.set(num, []);
    const titles = titlesByNumber.get(num);
    if (!titles.includes(sec.name)) titles.push(sec.name);
    const i = titles.indexOf(sec.name);
    sec.key = i ? `${num}.${i}` : num;
    sec.first = sec.meets.length ? Math.min(...sec.meets.map(m => m.d * 1440 + m.s)) : Infinity;
    if (!COURSES.has(sec.key)) {
      const label = `${sec.dept} ${sec.code}`;
      COURSES.set(sec.key, { code: sec.key, dept: sec.dept, term: sec.term, label, num: W27Req.normalizeNumber(label), name: sec.name, sections: [] });
    }
    COURSES.get(sec.key).sections.push(sec);
  }
}
for (const c of COURSES.values()) {
  c.sections.sort((a, b) => a.first - b.first || a.sec.localeCompare(b.sec));
  c.hay = [c.label, c.label.replace(" ", ""), SCHOOLS[c.dept], c.name,
           ...c.sections.map(s => `${c.label}-${s.sec} ${s.fac}`)].join(" ").toLowerCase();
}
const SECTION_BY_ID = new Map(SECTIONS.map(s => [s.id, s]));
const COURSE_LIST = [...COURSES.values()].sort((a, b) => termOrder(a.term) - termOrder(b.term) || a.dept.localeCompare(b.dept) || a.label.localeCompare(b.label) || a.code.localeCompare(b.code));

/** App state. selected: ordered list of {code, id, hue, status} across all quarters; status is "planned" (on the
 *  schedule) or "contemplated" (under consideration). term: the quarter shown; the calendar, search list, Selected
 *  list, conflicts and highlight mode show only its courses. focus: course code in highlight mode, or null.
 *  view: "calendar" or "requirements" (the main tab). fills: a REQ.filterOptions id that limits the search
 *  list to courses filling that requirement, or "" for no limit. */
const state = { selected: [], term: DEFAULT_TERM, focus: null, query: "", school: "ALL", showContemplated: true, view: "calendar", fills: "" };
const SHOW_KEY = "w27-show-contemplated";
const TERM_KEY = "w27-term";

function isContemplated(p) {
  return p.status === "contemplated";
}

/** Selected courses in the quarter being shown. */
function termPicks() {
  return state.selected.filter(p => COURSES.get(p.code).term === state.term);
}

/** Other quarters in which a course with the same number as `course` is selected, in calendar order. */
function alsoIn(course) {
  return TERMS.filter(t => t !== course.term &&
    state.selected.some(p => { const c = COURSES.get(p.code); return c.term === t && c.num === course.num; }));
}

/** False for a first-half and a second-half 50-unit course: they meet in different weeks, so they cannot clash. */
function halvesOverlap(a, b) {
  return !((a.half === "first" && b.half === "second") || (a.half === "second" && b.half === "first"));
}

/** "50 units, first half", "50 units, second half" or "50 units, full quarter"; "" for 100-unit courses. */
function unitsLabel(sec) {
  if (sec.units !== 50) return "";
  return `50 units, ${{ first: "first half", second: "second half" }[sec.half] || "full quarter"}`;
}

// ---------- scheduling logic ----------

/** True when two meetings share a day and their time ranges overlap (touching ends do not overlap). */
function meetsOverlap(a, b) {
  return a.d === b.d && a.s < b.e && b.s < a.e;
}

/** True when section `sec` overlaps a selected section of its quarter other than course `skipCode`'s.
 *  With plannedOnly, contemplated courses are ignored. First- and second-half courses never overlap. */
function clashesWithPlaced(sec, skipCode, plannedOnly = false) {
  return state.selected.some(p => {
    const other = SECTION_BY_ID.get(p.id);
    return p.code !== skipCode && other.term === sec.term && !(plannedOnly && isContemplated(p)) && halvesOverlap(sec, other) &&
      other.meets.some(pm => sec.meets.some(m => meetsOverlap(m, pm)));
  });
}

/** Returns the earliest section (from Monday 8 AM) that clashes with nothing selected; else the earliest that
 *  clashes with no planned course; else the earliest section. */
function pickDefaultSection(course) {
  return course.sections.find(s => !clashesWithPlaced(s, course.code))
    || course.sections.find(s => !clashesWithPlaced(s, course.code, true))
    || course.sections[0];
}

/** A color not yet used in `term` (colors only need to differ within one quarter's calendar). */
function nextHue(term = state.term) {
  const picks = state.selected.filter(p => COURSES.get(p.code).term === term);
  const used = new Set(picks.map(p => p.hue));
  return HUES.find(h => !used.has(h)) ?? HUES[picks.length % HUES.length];
}

/** Adds a course with its default section. status: "planned" (default) or "contemplated". */
function addCourse(code, status = "planned") {
  if (state.selected.some(p => p.code === code)) return;
  const course = COURSES.get(code);
  state.selected.push({ code, id: pickDefaultSection(course).id, hue: nextHue(course.term), status });
  commit();
}

/** Moves a selected course between the schedule ("planned") and "contemplated". */
function setStatus(code, status) {
  const p = state.selected.find(p => p.code === code);
  if (p) p.status = status;
  commit();
}

function removeCourse(code) {
  state.selected = state.selected.filter(p => p.code !== code);
  if (state.focus === code) state.focus = null;
  commit();
}

function switchSection(code, id) {
  const p = state.selected.find(p => p.code === code);
  if (p) p.id = id;
  commit();
}

function setFocus(code) {
  state.focus = state.focus === code ? null : code;
  render();
}

// ---------- persistence (per-browser convenience only) ----------

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.selected));
    localStorage.setItem(SHOW_KEY, state.showContemplated ? "1" : "0");
  } catch (e) { /* storage unavailable */ }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    // Earlier saves keyed courses by bare number ("30000") or dept plus number ("BUSN30000"); re-key every save by
    // its section id, which also puts it in the right quarter. Saves from before contemplated courses existed have
    // no status: they were on the schedule.
    state.selected = raw.filter(p => SECTION_BY_ID.has(p.id))
      .map(p => ({ ...p, code: SECTION_BY_ID.get(p.id).key, status: p.status === "contemplated" ? "contemplated" : "planned" }));
    state.showContemplated = localStorage.getItem(SHOW_KEY) !== "0";
  } catch (e) { state.selected = []; }
  try {
    const term = localStorage.getItem(TERM_KEY);
    if (TERMS.includes(term)) state.term = term;
  } catch (e) { /* storage unavailable: keep the default quarter */ }
}

/** Shows quarter `term` and remembers it for the next visit. */
function setTerm(term) {
  if (!TERMS.includes(term) || term === state.term) return;
  state.term = term;
  state.focus = null;
  try { localStorage.setItem(TERM_KEY, term); } catch (e) { /* storage unavailable */ }
  render();
}

function commit() { save(); render(); }

// ---------- degree requirements: state and engine input ----------

/** Requirement engine built from data/booth_requirements.json (see requirements.js for terms). */
const REQ = W27Req.createEngine(window.W27_REQUIREMENTS);
const REQ_KEY = "w27-requirements";
const SOURCE_LABEL = { other: "other quarters", scheduled: "scheduled", contemplated: "contemplated" };
const STATUS_LABEL = { completed: "Completed", enrolled: "Enrolled", planned: "Planned" };

/** The visitor's requirement state: {program, lead, qwe, other, overrides, tracked}. Shape and rules:
 *  REQ.validateState. other: [{id, num, title, quarter, status, units}]; overrides: [{num, kind, target}]. */
let req = REQ.defaultState();
/** Result of the last REQ.evaluate(); render() refreshes it. The course pop-up reads its usage map. */
let lastEval = null;

/** First course in the data for each normalized number, used to fill in titles typed into Other quarters. */
const COURSE_BY_NUM = new Map();
for (const c of COURSE_LIST) if (c.num && !COURSE_BY_NUM.has(c.num)) COURSE_BY_NUM.set(c.num, c);

/** Booth units a section earns: its own units (50 or 100) for Booth; for Law, the default (100) only when the
 *  requirements cross-list or list the course, or an override adds it, else 0 (Law hours are not Booth units). */
function sectionUnits(sec) {
  if (sec.dept === "BUSN") return sec.units ?? REQ.defaultUnits;
  return REQ.isBoothCredit(W27Req.normalizeNumber(`${sec.dept} ${sec.code}`), req.overrides) ? REQ.defaultUnits : 0;
}

/** Courses the engine assigns: Other quarters entries (uid "o:<id>") and selected courses from every quarter
 *  (uid "p:<course code>", with term and order so the engine keeps the earliest quarter's copy of a duplicate). */
function reqCourses() {
  const other = req.other.map(o => ({ uid: `o:${o.id}`, num: o.num, units: o.units, source: "other", title: o.title, quarter: o.quarter, status: o.status }));
  const picks = state.selected.map(p => {
    const c = COURSES.get(p.code);
    return { uid: `p:${p.code}`, num: c.num, units: sectionUnits(SECTION_BY_ID.get(p.id)), source: isContemplated(p) ? "contemplated" : "scheduled",
             title: c.name, term: c.term, order: termOrder(c.term), pickCode: p.code };
  });
  return [...other, ...picks];
}

function saveReq() {
  try { localStorage.setItem(REQ_KEY, JSON.stringify(req)); } catch (e) { /* storage unavailable */ }
}

/** Loads requirement state; a missing, unreadable or invalid save starts empty rather than breaking the page. */
function loadReq() {
  try {
    const raw = localStorage.getItem(REQ_KEY);
    const v = raw ? REQ.validateState(JSON.parse(raw)) : null;
    req = v && v.ok ? v.value : REQ.defaultState();
  } catch (e) { req = REQ.defaultState(); }
}

function commitReq() { saveReq(); render(); }

/** Adds an override for a course number. An identical override is not repeated; the opposite kind for the same
 *  number and requirement is replaced, so the newest choice wins. */
function addOverride(num, kind, target) {
  req.overrides = req.overrides.filter(o => !(o.num === num && o.target === target));
  req.overrides.push({ num, kind, target });
  commitReq();
}

function removeOverride(index) {
  req.overrides.splice(index, 1);
  commitReq();
}

// ---------- backup (export and import) ----------

const BACKUP_FORMAT = "w27-schedule-backup";

/** Returns the visitor's full state as a backup object: schedule, contemplated courses and requirements. */
function exportState() {
  return {
    format: BACKUP_FORMAT, version: 1, exported: new Date().toISOString(),
    schedule: state.selected.map(({ code, id, hue, status }) => ({ code, id, hue, status })),
    showContemplated: state.showContemplated,
    requirements: req,
  };
}

/**
 * Parses and validates backup text from exportState().
 * Returns {ok: true, selected, showContemplated, requirements, skipped} or {ok: false, error}. Sections that no
 * longer exist in the course data are skipped and counted, not treated as errors.
 */
function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: `This is not valid JSON (${e.message}).` }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: `This text is not a schedule-builder backup: it needs "format": "${BACKUP_FORMAT}".` };
  }
  if (obj.version !== 1) return { ok: false, error: `Backup version ${String(obj.version)} is not supported.` };
  if (!Array.isArray(obj.schedule)) return { ok: false, error: "schedule must be a list." };
  if (obj.showContemplated !== undefined && typeof obj.showContemplated !== "boolean") return { ok: false, error: "showContemplated must be true or false." };
  const selected = [];
  let skipped = 0;
  for (const [i, p] of obj.schedule.entries()) {
    if (!p || typeof p !== "object" || typeof p.id !== "string") return { ok: false, error: `schedule[${i}] needs a section "id".` };
    if (p.status !== undefined && p.status !== "planned" && p.status !== "contemplated") return { ok: false, error: `schedule[${i}].status must be "planned" or "contemplated".` };
    const sec = SECTION_BY_ID.get(p.id);
    if (!sec || selected.some(s => s.code === sec.key)) { skipped++; continue; }
    selected.push({ code: sec.key, id: p.id, hue: HUES.includes(p.hue) ? p.hue : null, status: p.status === "contemplated" ? "contemplated" : "planned" });
  }
  const r = REQ.validateState(obj.requirements ?? {});
  if (!r.ok) return { ok: false, error: `requirements: ${r.error}` };
  return { ok: true, selected, showContemplated: obj.showContemplated ?? true, requirements: r.value, skipped };
}

// ---------- formatting ----------

function fmtClock(min, withSuffix = true) {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}${withSuffix ? (h < 12 ? " AM" : " PM") : ""}`;
}

function fmtRange(m) {
  const sameHalf = (m.s < 720) === (m.e < 720);
  return `${fmtClock(m.s, !sameHalf)}–${fmtClock(m.e)}`;
}

/** Groups meetings that share a time range: "Tue/Thu 9:30–10:50 AM". For a section with no meetings, its note
 *  ("Time TBD", "Day not listed: ...") or "No meeting time listed". Plain text: escape it before inserting as HTML. */
function fmtMeets(sec) {
  if (!sec.meets.length) return sec.note || "No meeting time listed";
  const groups = new Map();
  for (const m of sec.meets) {
    const k = fmtRange(m);
    groups.set(k, [...(groups.get(k) || []), DAY_NAMES[m.d]]);
  }
  return [...groups].map(([range, days]) => `${days.join("/")} ${range}`).join("; ");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// ---------- calendar layout ----------

/** Assigns side-by-side lanes to overlapping items. Mutates items with .lane and .lanes. */
function assignLanes(items) {
  items.sort((a, b) => a.m.s - b.m.s || b.m.e - a.m.e);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex(end => end <= it.m.s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.m.e;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = laneEnds.length;
  };
  for (const it of items) {
    if (cluster.length && it.m.s >= clusterEnd) { flush(); cluster = []; clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.m.e);
  }
  if (cluster.length) flush();
}

function pos(m, lane, lanes) {
  const hour = 52;
  const top = Math.max(m.s, GRID_START) - GRID_START;
  const bottom = Math.min(m.e, GRID_END) - GRID_START;
  const w = 100 / lanes;
  return `top:${top / 60 * hour}px;height:${Math.max((bottom - top) / 60 * hour - 2, 14)}px;` +
         `left:calc(${lane * w}% + 2px);width:calc(${w}% - 4px);`;
}

function renderCalendar() {
  const placed = Array.from({ length: 7 }, () => []);
  const ghosts = Array.from({ length: 7 }, () => []);
  for (const p of termPicks()) {
    // Hidden contemplated courses still show while highlighted, so their sections stay reachable.
    if (isContemplated(p) && !state.showContemplated && state.focus !== p.code) continue;
    const course = COURSES.get(p.code);
    for (const sec of course.sections) {
      const isPlaced = sec.id === p.id;
      for (const m of sec.meets) {
        (isPlaced ? placed : ghosts)[m.d].push({ p, sec, m, course });
      }
    }
  }

  let html = `<div class="dayhead"></div>` + DAY_NAMES.map(d => `<div class="dayhead">${d}</div>`).join("");
  html += `<div class="timecol">`;
  for (let t = GRID_START; t <= GRID_END; t += 60) {
    const top = (t - GRID_START) / 60 * 52;
    html += `<span class="tlabel" style="top:${Math.max(top, 7)}px">${fmtClock(t).replace(":00", "")}</span>`;
  }
  html += `</div>`;

  for (let d = 0; d < 7; d++) {
    html += `<div class="daycol" data-day="${d}">`;
    const dayPlaced = placed[d], dayGhosts = ghosts[d];

    // Conflict bands: one per overlapping pair of planned meetings. A contemplated class that overlaps a
    // planned one gets a warning outline instead; two contemplated classes do not flag each other.
    for (let i = 0; i < dayPlaced.length; i++) {
      for (let j = i + 1; j < dayPlaced.length; j++) {
        const a = dayPlaced[i].m, b = dayPlaced[j].m;
        if (!meetsOverlap(a, b) || !halvesOverlap(dayPlaced[i].sec, dayPlaced[j].sec)) continue;
        const ma = isContemplated(dayPlaced[i].p), mb = isContemplated(dayPlaced[j].p);
        if (ma !== mb) { (ma ? dayPlaced[i] : dayPlaced[j]).warn = true; continue; }
        if (!ma) {
          dayPlaced[i].conflict = dayPlaced[j].conflict = true;
          const band = { s: Math.max(a.s, b.s), e: Math.min(a.e, b.e) };
          const top = (Math.max(band.s, GRID_START) - GRID_START) / 60 * 52;
          const h = (Math.min(band.e, GRID_END) - Math.max(band.s, GRID_START)) / 60 * 52;
          html += `<div class="band" style="top:${top}px;height:${h}px" title="Conflict ${fmtRange(band)}"></div>`;
        }
      }
    }

    // In highlight mode only the focused course's alternatives are drawn, so they get full width.
    const shownGhosts = state.focus ? dayGhosts.filter(g => g.p.code === state.focus) : dayGhosts;
    assignLanes(shownGhosts);
    for (const g of shownGhosts) {
      const alt = state.focus === g.p.code;
      const clash = alt && clashesWithPlaced(g.sec, g.p.code, true);
      html += `<div class="ghost${alt ? " alt" : ""}${clash ? " clash" : ""}" style="--h:${g.p.hue};${pos(g.m, g.lane, g.lanes)}"
        data-code="${g.p.code}" data-id="${g.sec.id}" role="button" tabindex="${alt ? 0 : -1}"
        title="${esc(`${g.course.label}-${g.sec.sec} ${g.course.name}\n${g.sec.fac}\n${fmtMeets(g.sec)}${g.sec.note ? "\n" + g.sec.note : ""}${clash ? "\nConflicts with another selected class" : ""}\nClick to ${alt ? "switch to this section" : "show alternatives"}`)}">
        <div class="c">${g.course.label}-${g.sec.sec}</div>
        <div class="swap">${esc(g.sec.fac.split(",")[0])}${clash ? " · conflict" : ""}</div>
      </div>`;
    }

    assignLanes(dayPlaced);
    for (const it of dayPlaced) {
      const focused = state.focus === it.p.code;
      const alts = it.course.sections.length - 1;
      // Title lines that fit beside the code and time lines: 65-minute Law classes get one.
      const titleLines = Math.max(1, Math.min(3, Math.floor(((it.m.e - it.m.s) / 60 * 52 - 36) / 14)));
      const maybe = isContemplated(it.p);
      html += `<div class="blk${maybe ? " maybe" : ""}${it.warn ? " would-clash" : ""}${it.conflict ? " conflict" : ""}${focused ? " focused" : ""}" style="--h:${it.p.hue};--lines:${titleLines};${pos(it.m, it.lane, it.lanes)}"
        data-code="${it.p.code}" role="button" tabindex="0"
        title="${esc(`${maybe ? "Contemplated: " : ""}${it.course.label}-${it.sec.sec} ${it.course.name}${it.warn ? "\nClashes with a class on your schedule" : ""}\n${it.sec.fac}\n${fmtMeets(it.sec)}${it.sec.note ? "\n" + it.sec.note : ""}\n${alts ? alts + " other section(s). Click to show them." : "Only one section."}`)}">
        <div class="c">${it.course.label}-${it.sec.sec}${it.sec.note ? " ⁂" : ""}</div>
        <div class="n">${esc(it.course.name)}</div>
        <div class="tm">${fmtRange(it.m)}</div>
      </div>`;
    }
    html += `</div>`;
  }
  document.getElementById("cal").innerHTML = html;
  const all = placed.flat();
  return { conflicts: all.filter(it => it.conflict), warns: all.filter(it => it.warn) };
}

// ---------- side panels ----------

function renderResults() {
  const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const inTerm = COURSE_LIST.filter(c => c.term === state.term);
  const hits = inTerm.filter(c => (state.school === "ALL" || c.dept === state.school) && tokens.every(t => c.hay.includes(t))
    && (!state.fills || REQ.fills(c.num, req.overrides, state.fills)));
  const chosen = new Map(state.selected.map(p => [p.code, p.status]));
  document.getElementById("rescount").textContent = `${hits.length} of ${inTerm.length}`;
  if (state.school === "LAWS" && !LAW_TERMS.includes(state.term)) {
    document.querySelectorAll("#schools button").forEach(b => b.setAttribute("aria-pressed", b.dataset.school === state.school));
    document.getElementById("results").innerHTML = `<li class="empty" style="padding:8px 4px">Law School courses are listed for ${esc(LAW_TERMS.join(", "))} only.</li>`;
    return;
  }
  document.querySelectorAll("#schools button").forEach(b => b.setAttribute("aria-pressed", b.dataset.school === state.school));
  document.getElementById("results").innerHTML = hits.length ? hits.map(c => {
    const on = chosen.has(c.code), maybe = chosen.get(c.code) === "contemplated";
    const n = c.sections.length;
    const progs = [SCHOOLS[c.dept], ...new Set(c.sections.flatMap(s => s.prog))].join(", ");
    return `<li><button class="res" type="button" aria-pressed="${on}" data-code="${c.code}">
      <span class="box${maybe ? " maybe" : ""}" title="${maybe ? "Contemplated" : on ? "On schedule" : ""}">${maybe ? "?" : on ? "✓" : ""}</span>
      <span><span class="code">${c.label}</span><span class="t">${esc(c.name)}</span>
      <span class="sub">${n} section${n > 1 ? "s" : ""}${progs ? " · " + esc(progs) : ""}${courseUnitsText(c)}${noMeetingText(c)}</span>${alsoInNote(c)}${reqChips(c)}</span>
    </button><button class="info" type="button" data-info="${c.code}" aria-label="Details for ${c.label} ${esc(c.name)}">Details</button></li>`;
  }).join("") : `<li class="empty" style="padding:8px 4px">No course matches${state.query ? ` “${esc(state.query)}”` : ""}${state.fills ? " with this Fills filter" : ""}. Try a course number or part of the title.</li>`;
}

/** Up to this many requirement chips show under a search result; the rest are summarized as "+N". */
const MAX_RESULT_CHIPS = 3;

/** " · 50 units, first half" for a 50-unit course (each distinct label once); "" otherwise. */
function courseUnitsText(c) {
  const labels = [...new Set(c.sections.map(unitsLabel).filter(Boolean))];
  return labels.length ? " · " + esc(labels.join("; ")) : "";
}

/** " · Time TBD" (or another no-meeting note) for sections with no meetings, each distinct note once; "" if none. */
function noMeetingText(c) {
  const notes = [...new Set(c.sections.filter(s => !s.meets.length).map(fmtMeets))];
  return notes.length ? " · " + esc(notes.join("; ")) : "";
}

/** Small warning when the same course number is selected in another quarter. */
function alsoInNote(c) {
  const terms = alsoIn(c);
  return terms.length ? `<span class="soft also">Also in ${esc(terms.join(", "))}</span>` : "";
}

/** Small chips naming the requirements a course can count toward (overrides included). */
function reqChips(c) {
  const list = REQ.eligibleTargets(c.num, req.overrides);
  if (!list.length) return "";
  const shown = list.slice(0, MAX_RESULT_CHIPS).map(t =>
    `<span class="rq${t.override ? " ovr" : ""}" title="${esc(t.label + (t.override ? " (override)" : "") + (t.via ? ` (as ${t.via})` : ""))}">${esc(t.label)}</span>`);
  const more = list.length - shown.length;
  return `<span class="reqchips">${shown.join("")}${more > 0 ? `<span class="rq" title="${esc(list.slice(MAX_RESULT_CHIPS).map(t => t.label).join("\n"))}">+${more}</span>` : ""}</span>`;
}

function renderSelected(result) {
  const conflictCodes = new Set(result.conflicts.map(it => it.p.code));
  const warnCodes = new Set(result.warns.map(it => it.p.code));
  const list = document.getElementById("selected");
  const picks = termPicks();
  document.getElementById("selcount").textContent = picks.length || "";
  if (!picks.length) { list.innerHTML = `<li class="empty">No courses in ${esc(state.term)} yet. Pick one from the list above.</li>`; return; }

  const pill = p => {
    const c = COURSES.get(p.code), sec = SECTION_BY_ID.get(p.id);
    const alts = c.sections.length - 1;
    const maybe = isContemplated(p);
    return `<li class="pill${maybe ? " maybe" : ""}${state.focus === p.code ? " focused" : ""}" style="--h:${p.hue}" data-code="${p.code}" tabindex="0">
      <span class="stripe"></span>
      <span>
        <span class="code">${c.label}-${sec.sec}</span> <span class="t">${esc(c.name)}</span>
        <div class="sub">${profLinks(sec)} · ${esc(fmtMeets(sec))}${unitsLabel(sec) ? " · " + esc(unitsLabel(sec)) : ""}</div>
        ${sec.note && sec.meets.length ? `<div class="sub">${esc(sec.note)}</div>` : ""}
        <div class="sub">${alts ? `${alts} other section${alts > 1 ? "s" : ""}` : "Only section"}${sec.meets.length ? "" : " · not shown on the calendar"}</div>
        ${conflictCodes.has(p.code) ? `<div class="warn">Time conflict</div>` : ""}
        ${warnCodes.has(p.code) ? `<div class="soft">Clashes with your schedule</div>` : ""}
        ${alsoInNote(c)}${lastEval?.duplicates.has(`p:${p.code}`) ? `<span class="badge">counted once</span>` : ""}
      </span>
      <span class="acts">
        <button class="x" type="button" data-remove="${p.code}" aria-label="Remove ${c.label} ${esc(c.name)}" title="Remove">×</button>
        <button class="info" type="button" data-info="${p.code}" aria-label="Details for ${c.label} ${esc(c.name)}">Details</button>
        <button class="mv" type="button" data-code="${p.code}" data-to="${maybe ? "planned" : "contemplated"}"
          title="${maybe ? "Put this course on your schedule" : "Mark this course as contemplated"}">${maybe ? "Schedule" : "Contemplate"}</button>
      </span>
    </li>`;
  };

  // In highlight mode the highlighted course is listed first, above both groups, so its × is easy to reach.
  // Display order only: state.selected (and the saved order) is unchanged.
  const top = picks.filter(p => p.code === state.focus);
  const rest = picks.filter(p => p.code !== state.focus);
  const planned = rest.filter(p => !isContemplated(p)), maybe = rest.filter(isContemplated);
  const nPlanned = picks.filter(p => !isContemplated(p)).length;
  const nMaybe = picks.length - nPlanned;
  list.innerHTML = top.map(pill).join("")
    + `<li class="grp"><span>On schedule</span><span>${nPlanned}</span></li>`
    + (planned.length ? planned.map(pill).join("") : (top.length && !isContemplated(top[0]) ? "" : `<li class="empty">Nothing on the schedule yet.</li>`))
    + `<li class="grp"><span>Contemplated</span><span>${nMaybe}</span></li>`
    + (maybe.length ? maybe.map(pill).join("") : (top.length && isContemplated(top[0]) ? "" : `<li class="empty">Use Contemplate on a course to set it aside here.</li>`));
}

function renderStats(result) {
  const inConflict = new Set(result.conflicts.map(it => it.p.code)).size;
  const picks = termPicks();
  const planned = picks.filter(p => !isContemplated(p));
  const nPlanned = planned.length, nMaybe = picks.length - nPlanned;
  const units = list => list.reduce((s, p) => s + sectionUnits(SECTION_BY_ID.get(p.id)), 0);
  document.getElementById("stats").innerHTML =
    `<span class="chip">${nPlanned} on schedule</span>` +
    (nMaybe ? `<span class="chip">${nMaybe} contemplated</span>` : "") +
    `<span class="chip" id="units-stat" data-scheduled="${units(planned)}" data-with-contemplated="${units(picks)}">${fmtU(units(planned))} units scheduled${nMaybe ? ` · ${fmtU(units(picks))} with contemplated` : ""}</span>` +
    (inConflict ? `<span class="chip bad">${inConflict} courses in conflict</span>` : nPlanned ? `<span class="chip">No conflicts</span>` : "");
  document.getElementById("showmaybe").checked = state.showContemplated;
}

function renderFocusBar() {
  const wrap = document.getElementById("calwrap");
  const bar = document.getElementById("focusbar");
  wrap.classList.toggle("focus-mode", !!state.focus);
  if (!state.focus) {
    // Always present (with a hint) so entering highlight mode never shifts the calendar under the pointer.
    bar.innerHTML = `<span class="muted">Click a class to see its other sections. Drag it onto a dashed slot to switch. Double-click it for the course description.</span>`;
    return;
  }
  const c = COURSES.get(state.focus);
  const n = c.sections.length - 1;
  const focusedMaybe = isContemplated(state.selected.find(p => p.code === state.focus) || {});
  if (drag) {
    bar.innerHTML = `<span><b>${c.label} ${esc(c.name)}</b>: ${n ? "drop on a dashed slot to switch sections." : "this course has only one section."} Esc cancels.</span>`;
    return;
  }
  bar.innerHTML = `<span><b>${c.label} ${esc(c.name)}</b>: ${n ? `${n} other section${n > 1 ? "s" : ""} shown with dashed outlines. Click one to switch.` : "this course has only one section."}</span>
    <button type="button" data-info="${c.code}">Details</button>
    <button type="button" data-code="${c.code}" data-to="${focusedMaybe ? "planned" : "contemplated"}">${focusedMaybe ? "Put on schedule" : "Mark contemplated"}</button>
    <button type="button" id="exitfocus">Done</button>`;
}

function render() {
  lastEval = REQ.evaluate({ program: req.program, courses: reqCourses(), overrides: req.overrides, tracked: req.tracked });
  const result = renderCalendar();
  renderResults();
  renderSelected(result);
  renderStats(result);
  renderFocusBar();
  renderTerms();
  renderTabs();
  if (state.view === "requirements") renderRequirements(lastEval);
}

function renderTerms() {
  document.querySelectorAll("#terms button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.term === state.term)));
}

function renderTabs() {
  const onReq = state.view === "requirements";
  document.getElementById("tab-calendar").setAttribute("aria-selected", String(!onReq));
  document.getElementById("tab-requirements").setAttribute("aria-selected", String(onReq));
  document.getElementById("calwrap").hidden = onReq;
  document.getElementById("reqview").hidden = !onReq;
}

// ---------- requirements view ----------

function fmtU(n) {
  return n === Infinity ? "any" : n.toLocaleString("en-US");
}

/**
 * Progress bar with one segment per source, plus a line of numbers. The data-* attributes carry the unit totals
 * per source for tests and assistive tooling.
 * Args: by: {other, scheduled, contemplated} units; target: units required; label: what the bar measures.
 */
function progressBar(by, target, label) {
  const total = by.other + by.scheduled + by.contemplated;
  const scale = Math.max(target, total, 1);
  const parts = W27Req.SOURCES.filter(s => by[s]).map(s => `${fmtU(by[s])} ${SOURCE_LABEL[s]}`);
  const segs = W27Req.SOURCES.filter(s => by[s]).map(s => `<span class="src-${s}" style="width:${(by[s] / scale * 100).toFixed(2)}%"></span>`).join("");
  return `<div class="rprog" data-other="${by.other}" data-scheduled="${by.scheduled}" data-contemplated="${by.contemplated}">
    <div class="rbar" role="img" aria-label="${esc(`${label}: ${fmtU(total)} of ${fmtU(target)} units${parts.length ? "; " + parts.join(", ") : ""}`)}">${segs}</div>
    <div class="rnums"><b>${fmtU(total)}</b> / ${fmtU(target)} units${parts.length ? " · " + esc(parts.join(" · ")) : ""}</div>
  </div>`;
}

/** A course as a chip styled by source, naming its quarter. Picks from the course data are buttons that open the
 *  course pop-up. */
function courseChip(c, { override = false, via = null } = {}) {
  const where = c.source === "other" ? [c.quarter, STATUS_LABEL[c.status]].filter(Boolean).join(", ") : `${c.term}, ${SOURCE_LABEL[c.source]}`;
  const quarter = c.source === "other" ? c.quarter : c.term;
  const units = c.units !== REQ.defaultUnits ? ` · ${fmtU(c.units)} u` : "";
  const inner = `<b>${esc(c.num)}</b>${c.title ? ` ${esc(c.title)}` : ""}${units}${quarter ? `<span class="q">${esc(quarter)}</span>` : ""}`;
  const title = esc(`${c.num}${c.title ? " " + c.title : ""} (${where})`);
  const chip = c.pickCode
    ? `<button type="button" class="rc src-${c.source}" data-course="${esc(c.pickCode)}" title="${title}">${inner}</button>`
    : `<span class="rc src-${c.source}" title="${title}">${inner}</span>`;
  return chip + (via ? `<span class="muted">as ${esc(via)} </span>` : "") + (override ? `<span class="badge">override</span>` : "");
}

function unitsOfRows(rows) {
  const by = { other: 0, scheduled: 0, contemplated: 0 };
  for (const r of rows) if (r.course && !r.surplus) by[r.course.source] += r.units;
  return by;
}

function rowsTable(rows) {
  let group = null;
  return `<table class="secs rrows"><tbody>${rows.map(r => {
    const head = r.group && r.group !== group ? `<tr class="grprow"><td colspan="2">${esc(group = r.group)}</td></tr>` : "";
    const cell = r.course
      ? courseChip(r.course, r) + (r.filled ? "" : `<div class="soft">${fmtU(r.units)} of ${fmtU(REQ.defaultUnits)} units: pair it with another course from this line</div>`)
        + (r.surplus ? `<div class="req-note">Extra line: only ${REQ.degree[r.section].choose} are needed, so this course's units count as electives.</div>` : "")
      : `<span class="muted">No course yet</span>`;
    return `${head}<tr data-row="${esc(r.id)}"><td>${esc(r.label)}</td><td>${cell}${r.note ? `<div class="req-note">${esc(r.note)}</div>` : ""}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function statusChip(done, total, need) {
  return `<span class="chip${done ? " ok" : ""}">${done ? "Complete" : `${total} of ${need}`}</span>`;
}

/** Renders the degree panel, the tracked concentrations and the two lists from an evaluation result. */
function renderRequirements(ev) {
  const d = REQ.degree;
  const found = ev.rows.filter(r => r.section === "foundations"), flmbe = ev.rows.filter(r => r.section === "flmbe");
  const coreUnits = d.foundations.units + d.flmbe.units;
  const boothUnits = boothUnitsSoFar(ev);
  document.getElementById("req-degree").innerHTML = `
    <h2>Degree requirements <span>${esc(ev.program.label)}</span></h2>
    <h3 class="req-sub">Foundations ${statusChip(ev.foundations.filled >= ev.foundations.choose, ev.foundations.filled, `${ev.foundations.choose} lines`)}</h3>
    ${progressBar(unitsOfRows(found), d.foundations.units, "Foundations")}
    ${rowsTable(found)}
    <h3 class="req-sub">${esc(d.flmbe.label)} (FLMBE) ${statusChip(ev.flmbe.filled >= ev.flmbe.choose, ev.flmbe.filled, `${ev.flmbe.choose} lines (any ${ev.flmbe.choose} of ${ev.flmbe.total})`)}</h3>
    ${progressBar(unitsOfRows(flmbe), d.flmbe.units, "FLMBE")}
    ${rowsTable(flmbe)}
    <p class="req-note">${esc(d.distinct_credit_rule)}</p>
    <ul class="req-note">${d.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
    <h3 class="req-sub">Electives</h3>
    ${progressBar(ev.electives.bySource, Math.max(0, ev.total.target - coreUnits), "Electives")}
    <p class="req-note">${esc(d.electives)}</p>
    <h3 class="req-sub" id="req-total">Total units ${statusChip(ev.total.units >= ev.total.target, fmtU(ev.total.units), fmtU(ev.total.target))}</h3>
    ${progressBar(ev.total.bySource, ev.total.target, "Total units")}
    ${ev.program.minBooth ? `<p class="req-note">At least ${fmtU(ev.program.minBooth)} units must be Booth courses. Booth units so far: ${fmtU(boothUnits)}.</p>` : ""}
    ${ev.program.note ? `<p class="req-note">${esc(ev.program.note)}</p>` : ""}
    ${duplicatesNote(ev)}`;

  document.getElementById("req-picker").innerHTML = REQ.concentrations.map(c =>
    `<label><input type="checkbox" data-track="${esc(c.id)}"${req.tracked.includes(c.id) ? " checked" : ""}>${esc(c.label)}</label>`).join("");
  const rules = window.W27_REQUIREMENTS.concentration_rules;
  document.getElementById("req-concs").innerHTML = (ev.concentrations.length ? ev.concentrations.map(concCard).join("")
    : `<p class="empty">Pick concentrations above to track them.</p>`)
    + `<ul class="req-note"><li>${esc(rules.grades)}</li><li>${esc(rules.double_counting)}</li></ul>`;

  document.getElementById("oq-count").textContent = req.other.length || "";
  document.getElementById("oq-list").innerHTML = req.other.length ? req.other.map(o => {
    const course = { num: o.num, title: o.title, units: o.units, source: "other", quarter: o.quarter, status: o.status };
    const kept = ev.duplicates.get(`o:${o.id}`);
    const dup = kept ? `<span class="badge" title="${esc(duplicateText(kept))}">counted once</span>` : "";
    return `<li data-oq="${esc(o.id)}"><span class="grow">${courseChip(course)}${dup}</span>
      <label><span class="sr">Status</span><select data-oq-status>${W27Req.STATUSES.map(s => `<option value="${s}"${s === o.status ? " selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></label>
      <label><span class="sr">Units</span><input type="number" min="0" max="1000" step="50" value="${o.units}" data-oq-units></label>
      <button type="button" class="x" data-oq-remove aria-label="Remove ${esc(o.num)}" title="Remove">×</button></li>`;
  }).join("") : `<li class="empty">No courses from other quarters yet.</li>`;

  document.getElementById("ov-count").textContent = req.overrides.length || "";
  document.getElementById("ov-list").innerHTML = req.overrides.length ? req.overrides.map((o, i) => overrideItem(o, i)).join("")
    : `<li class="empty">No overrides.</li>`;

  document.getElementById("req-program").value = req.program;
  document.querySelectorAll("[data-noncredit]").forEach(b => { b.checked = !!req[b.dataset.noncredit]; });
}

/** Units from Booth-numbered or cross-listed courses, all sources, duplicates counted once (for the program's
 *  minimum Booth units). */
function boothUnitsSoFar(ev) {
  const xl = new Set(REQ.crosslists.map(x => x.course));
  return reqCourses().filter(c => !ev.duplicates.has(c.uid) && (/^\d{5}$/.test(c.num) || xl.has(c.num))).reduce((s, c) => s + c.units, 0);
}

/** "Counted as 35100 in Autumn 2026, scheduled": names the copy that counts instead of a duplicate. */
function duplicateText(kept) {
  const where = kept.source === "other" ? [kept.quarter || "Other quarters", STATUS_LABEL[kept.status]].filter(Boolean).join(", ") : `${kept.term}, ${SOURCE_LABEL[kept.source]}`;
  return `Counted as ${kept.num} in ${where}`;
}

/** Lists courses that appear more than once (each counts once). Empty when there are none. */
function duplicatesNote(ev) {
  if (!ev.duplicates.size) return "";
  const byUid = new Map(reqCourses().map(c => [c.uid, c]));
  const items = [...ev.duplicates].map(([uid, kept]) => {
    const c = byUid.get(uid);
    const where = c.source === "other" ? c.quarter || "Other quarters" : `${c.term}, ${SOURCE_LABEL[c.source]}`;
    return `<li><span class="grow"><span class="badge">counted once</span><b>${esc(c.num)}</b> (${esc(where)}) is listed more than once. ${esc(duplicateText(kept))}.</span></li>`;
  });
  return `<h3 class="req-sub" id="req-dups">Listed more than once</h3><ul class="req-list">${items.join("")}</ul>`;
}

function overrideItem(o, i) {
  const t = REQ.targets.get(o.target);
  return `<li><span class="grow"><span class="badge">override</span><b>${esc(o.num)}</b> ${o.kind === "add" ? "also counts toward" : "does not count toward"} ${esc(t ? t.label : o.target)}</span>
    <button type="button" class="x" data-ov-remove="${i}" aria-label="Remove this override" title="Remove">×</button></li>`;
}

/** Describes a component's unit rule: "100 units", "at least 200, at most 300 units", "up to 100 units". */
function needText(k) {
  if (k.rowsTotal) return `all ${k.rowsTotal} lines`;
  if (k.min !== null && k.max !== null) return `at least ${fmtU(k.min)} and at most ${fmtU(k.max)} units`;
  if (k.min !== null) return `at least ${fmtU(k.min)} units`;
  if (k.max !== null && !k.need) return `up to ${fmtU(k.max)} units (optional)`;
  return `${fmtU(k.need)} units`;
}

// ---------- concentration components in plain words ----------

/** Quarters of 2026-27 in which each course number is offered, in calendar order. */
const TERMS_BY_NUM = new Map();
for (const c of COURSE_LIST) {
  const list = TERMS_BY_NUM.get(c.num) || [];
  if (!list.includes(c.term)) list.push(c.term);
  TERMS_BY_NUM.set(c.num, list);
}

/** Courses that count as a listed number through a cross-list: "38120" -> ["LAWS 48230"]. */
const CROSSLISTED_AS = new Map();
for (const x of REQ.crosslists) CROSSLISTED_AS.set(x.counts_as, [...(CROSSLISTED_AS.get(x.counts_as) || []), x.course]);

/** Basic courses of the Foundations and FLMBE lines (the courses each line is built around). */
const BASIC_COURSES = new Set([...REQ.degree.foundations.rows, ...REQ.degree.flmbe.rows].flatMap(r => r.basic));
/** A component names its core course only when its list is this short and holds exactly one basic course, so the
 *  named course really anchors the list (35000 for asset pricing, 35200 for corporate finance). */
const MAX_CORE_LIST = 12;
const LIST_PREVIEW = 3;

/** "35000 Investments", or the number alone when no section in 2026-27 has that number. */
function courseName(num) {
  const c = COURSE_BY_NUM.get(num);
  return c ? `${num} ${c.name}` : num;
}

/** The component's definition in booth_requirements.json. */
function componentDef(concId, compId) {
  return REQ.concentrations.find(c => c.id === concId).components.find(k => k.id === compId);
}

/** What the component's list is called in sentences: "asset-pricing list", "Applied AI list", or for lists built
 *  from other concentrations, "Strategic Management and Behavioral Science lists". */
function listName(def) {
  if (def.courses_from_concentrations) {
    return `${def.courses_from_concentrations.map(id => REQ.concentrations.find(c => c.id === id).label).join(" and ")} lists`;
  }
  const base = def.label.replace(/\s*\(.*\)$/, "").replace(/:.*$/, "").replace(/\s+courses$/i, "").trim();
  const words = base.split(/\s+/);
  // Two-word names read best hyphenated and lowercase ("asset-pricing"); acronyms keep their case ("Applied-AI").
  const lower = w => (w === w.toUpperCase() ? w : w.toLowerCase());
  // Sentence-case names read lowercase mid-sentence; names with capitals after the first word are proper names.
  const sentenceCase = words.slice(1).every(w => w === w.toLowerCase());
  const name = words.length <= 2 ? words.map(lower).join("-") : sentenceCase ? words.map(lower).join(" ") : base;
  return `${name} list`;
}

/** "(includes 35000 Investments)" for a short list anchored by one basic course; otherwise the first numbers and a
 *  count: "(30000, 30005, 30001 and 13 more)". */
function listSummary(list) {
  const core = list.filter(n => BASIC_COURSES.has(n));
  if (list.length <= MAX_CORE_LIST && core.length === 1) return `includes ${courseName(core[0])}`;
  const shown = list.slice(0, LIST_PREVIEW);
  return list.length > shown.length ? `${shown.join(", ")} and ${list.length - shown.length} more` : shown.join(", ");
}

/** The component's rule in plain words, e.g. "Asset pricing: 100 units from the asset-pricing list (includes
 *  35000 Investments)". */
function componentRule(concId, k) {
  const def = componentDef(concId, k.id);
  if (def.type === "all_flmbe_rows") return `${k.label}: one course in each of the ${k.rowsTotal} FLMBE lines (${fmtU(k.need)} units)`;
  const list = [...REQ.targets.get(`conc:${concId}:${k.id}`).list];
  return `${k.label}: ${needText(k)} from the ${listName(def)} (${listSummary(list)})`;
}

/** What the component still lacks, e.g. "Needs 100 more units from the asset-pricing list"; "" when complete or
 *  optional. */
function componentGap(concId, k) {
  if (k.done) return "";
  const def = componentDef(concId, k.id);
  if (def.type === "all_flmbe_rows") {
    const full = new Set(k.entries.filter(x => x.course.units >= REQ.defaultUnits).map(x => x.target));
    const missing = REQ.degree.flmbe.rows.filter(r => !full.has(`flmbe:${r.id}`)).map(r => r.label);
    return `Needs ${missing.length} more FLMBE line${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`;
  }
  const short = k.need - k.units;
  return short > 0 ? `Needs ${fmtU(short)} more units from the ${listName(def)}` : "";
}

/** "What counts" lists the user has opened, by "<concentration>:<component>", so re-renders keep them open. */
const openWhat = new Set();

/** One qualifying course: number and title, the quarters it is offered in 2026-27, and whether it is yours. */
function whatItem(num, mine, extra = "") {
  const terms = TERMS_BY_NUM.get(num) || [];
  const aliases = (CROSSLISTED_AS.get(num) || []).map(a => `also ${a}${TERMS_BY_NUM.has(a) ? ` (${TERMS_BY_NUM.get(a).join(", ")})` : ""}`);
  const yours = mine.has(num) || (CROSSLISTED_AS.get(num) || []).some(a => mine.has(a));
  return `<li class="${yours ? "yours" : ""}"><span class="grow"><b>${esc(num)}</b> ${esc(COURSE_BY_NUM.get(num)?.name || "")}${extra}</span>
    ${aliases.length ? `<span class="muted">${esc(aliases.join("; "))}</span>` : ""}
    ${terms.map(t => `<span class="rq">${esc(t)}</span>`).join("")}${yours ? `<span class="badge yours-badge">yours</span>` : ""}</li>`;
}

/** The "What counts" toggle: every qualifying course (overrides included), grouped by FLMBE line for General
 *  Management's eight-line component. */
function whatCounts(concId, k) {
  const def = componentDef(concId, k.id);
  const mine = new Set(reqCourses().map(c => c.num));
  const key = `${concId}:${k.id}`;
  const itemsFor = target => {
    const list = [...REQ.targets.get(target).list];
    const added = req.overrides.filter(o => o.kind === "add" && o.target === target && !list.includes(o.num)).map(o => o.num);
    const removed = new Set(req.overrides.filter(o => o.kind === "remove" && o.target === target).map(o => o.num));
    return { count: list.length - [...removed].filter(n => list.includes(n)).length + added.length,
             html: list.map(n => whatItem(n, mine, removed.has(n) ? ` <span class="badge">excluded by override</span>` : "")).join("")
               + added.map(n => whatItem(n, mine, ` <span class="badge">override</span>`)).join("") };
  };
  let count, body;
  if (def.type === "all_flmbe_rows") {
    const groups = REQ.degree.flmbe.rows.map(r => ({ r, ...itemsFor(`flmbe:${r.id}`) }));
    count = groups.reduce((s, g) => s + g.count, 0);
    body = groups.map(g => `<li class="what-grp">${esc(g.r.label)}</li>${g.html}`).join("");
  } else {
    ({ count, html: body } = itemsFor(`conc:${concId}:${k.id}`));
  }
  return `<details class="what" data-what="${esc(key)}"${openWhat.has(key) ? " open" : ""}>
    <summary>What counts (${count} course${count === 1 ? "" : "s"})</summary>
    <ul class="req-list what-list">${body}</ul></details>`;
}

function concCard(e) {
  const status = e.done ? `<span class="chip ok">Complete</span>`
    : e.blockedBy.length ? `<span class="chip wait">Needs ${esc(e.blockedBy.map(id => REQ.concentrations.find(c => c.id === id).label).join(", "))}</span>`
    : `<span class="chip">${fmtU(e.total)} of ${fmtU(e.units)} units</span>`;
  const comps = e.components.map(k => {
    const gap = componentGap(e.id, k);
    return `<div class="comp" data-comp="${esc(k.id)}">
      <div class="lbl">${esc(k.label)}<span class="muted rule">${esc(componentRule(e.id, k))}</span>
        <span class="muted">${k.rowsTotal ? `${k.rowsFilled} of ${k.rowsTotal} lines` : ""}${k.done && (k.need || k.rowsTotal) ? `${k.rowsTotal ? " · " : ""}done` : ""}</span></div>
      <div>${progressBar(k.bySource, k.need || k.max || 0, k.label)}
        ${gap ? `<p class="soft gap">${esc(gap)}</p>` : ""}
        <div>${k.entries.length ? k.entries.map(x => courseChip(x.course, x)).join("") : `<span class="muted">No course counted yet</span>`}</div>
        ${whatCounts(e.id, k)}</div>
    </div>`;
  }).join("");
  // Components can all be met while the concentration's total is not (Healthcare: 100 + 200 of 400 units).
  const totalGap = !e.done && e.components.every(k => k.done) && e.total < e.units
    ? `<p class="soft gap">Needs ${fmtU(e.units - e.total)} more units from any of its lists</p>` : "";
  const caps = e.caps.map(cap => `<p class="req-note">Overlap cap with ${esc(REQ.concentrations.find(c => c.id === cap.with).label)}: at most ${fmtU(cap.max)} shared units; sharing ${fmtU(cap.sharedUnits)}${cap.shared.length ? ` (${esc(cap.shared.map(c => c.num).join(", "))})` : ""}.</p>`).join("");
  return `<article class="conc" data-conc="${esc(e.id)}">
    <header><h3>${esc(e.label)}</h3>${status}</header>
    ${progressBar(e.bySource, e.units, e.label)}
    ${e.blockedBy.length ? `<p class="soft">Counts only once ${esc(e.blockedBy.map(id => REQ.concentrations.find(c => c.id === id).label).join(", "))} is complete.</p>` : ""}
    ${e.ruleMessages.map(m => `<p class="soft">${esc(m)}</p>`).join("")}
    ${totalGap}${comps}${caps}
    ${e.notes.length ? `<ul class="req-note">${e.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
  </article>`;
}

// ---------- course and professor pop-ups ----------

const DLG = document.getElementById("dlg");
/** Pop-up navigation history, so a professor opened from a course can go back to it. */
let dlgStack = [];

/** Professor ids for a section: from DETAILS, else none (the section's listed names show as plain text). */
function profIds(sec) {
  return DETAILS.sections[sec.id]?.p || [];
}

/** Instructor names for a section as buttons that open the professor pop-up. */
function profLinks(sec) {
  const ids = profIds(sec);
  if (!ids.length) return esc(sec.fac);
  return ids.map(id => `<button type="button" class="prof" data-prof="${esc(id)}">${esc(DETAILS.profs[id]?.name || id)}</button>`).join(", ");
}

function paras(text) {
  return text.split("\n").map(t => `<p>${esc(t)}</p>`).join("");
}

function showDialog(html) {
  DLG.innerHTML = html;
  if (!DLG.open) DLG.showModal();
  DLG.scrollTop = 0;
  DLG.querySelector(".dlg-close-btn")?.focus();
}

function dlgHeader(kicker, title, sub) {
  const back = dlgStack.length > 1 ? `<button type="button" class="btn" data-dlg="back">Back</button>` : "";
  return `<div class="dlg-head">
    <div class="dlg-kicker">${kicker}</div>
    <h2 id="dlg-title">${esc(title)}</h2>
    ${sub ? `<div class="dlg-sub">${sub}</div>` : ""}
    <div class="dlg-close dlg-actions">${back}<button type="button" class="btn dlg-close-btn" data-dlg="close" aria-label="Close">Close</button></div>
  </div>`;
}

/** Opens the course pop-up: sections with instructors and rooms, description, notes and learning outcomes. */
function openCourse(code, push = true) {
  const c = COURSES.get(code);
  if (!c) return;
  if (push) dlgStack.push({ kind: "course", code });
  const mine = state.selected.find(p => p.code === code)?.id;
  const info = c.sections.map(s => DETAILS.sections[s.id] || {});
  const first = info.find(i => i.units || i.tags) || {};
  const tags = (first.tags || "").split(/,\s*/).filter(Boolean);

  const rows = c.sections.map((s, i) => {
    const d = info[i];
    const where = [d.loc && d.loc !== "TBA" ? esc(d.loc) : "", d.dates ? esc(d.dates) : ""].filter(Boolean).join("<br>");
    return `<tr class="${s.id === mine ? "mine" : ""}">
      <td><b>${esc(s.sec)}</b>${s.id === mine ? `<div class="you">In schedule</div>` : ""}</td>
      <td>${profLinks(s)}</td>
      <td>${esc(fmtMeets(s))}${s.note && s.meets.length ? `<div class="muted">${esc(s.note)}</div>` : ""}${unitsLabel(s) ? `<div class="muted">${esc(unitsLabel(s))}</div>` : ""}</td>
      <td>${where || `<span class="muted">${s.prog.map(esc).join(", ")}</span>`}</td>
    </tr>`;
  }).join("");

  // Sections can carry different descriptions (different instructors); show each distinct one once.
  const groups = new Map();
  c.sections.forEach((s, i) => {
    const k = info[i].d ?? -1;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s.sec);
  });
  const described = [...groups].filter(([k]) => k !== -1);
  const descHtml = described.length ? described.map(([k, secs]) =>
    `<div class="descgroup">${described.length > 1 ? `<h3>Section${secs.length > 1 ? "s" : ""} ${secs.join(", ")}</h3>` : ""}<div class="prose">${paras(DETAILS.texts[k])}</div></div>`).join("")
    : `<p class="muted">No description was listed for this course.</p>`;

  const notes = [...new Set(info.flatMap(i => i.notes || []))];
  const outcomes = [...new Set(info.flatMap(i => i.outcomes || []))];
  const selected = state.selected.some(p => p.code === code);
  const maybeNow = isContemplated(state.selected.find(p => p.code === code) || {});

  showDialog(dlgHeader(
    `${esc(c.label)} · ${esc(c.term)} · ${SCHOOLS[c.dept]}${first.units ? " · " + esc(first.units) : ""}${courseUnitsText(c)}`,
    c.name,
    (tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : "") + alsoInNote(c)
  ) + `<div class="dlg-body">
    <section><h3>Description</h3>${descHtml}</section>
    ${notes.length ? `<section><h3>Notes</h3><ul>${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></section>` : ""}
    ${countsTowardHtml(c)}
    <section><h3>Sections</h3><div style="overflow-x:auto"><table class="secs">
      <thead><tr><th>Sec</th><th>Instructor</th><th>Meets</th><th>${c.dept === "LAWS" ? "Room · dates" : "Program"}</th></tr></thead>
      <tbody>${rows}</tbody></table></div></section>
    ${outcomes.length ? `<details><summary>Learning outcomes</summary><ul>${outcomes.map(o => `<li>${esc(o)}</li>`).join("")}</ul></details>` : ""}
    <div class="dlg-actions">${selected
      ? `<button type="button" class="btn" data-dlg="status" data-code="${c.code}" data-to="${maybeNow ? "planned" : "contemplated"}">${maybeNow ? "Put on schedule" : "Mark contemplated"}</button>
         <button type="button" class="btn" data-dlg="remove" data-code="${c.code}">Remove</button>`
      : `<button type="button" class="btn primary" data-dlg="add" data-code="${c.code}" data-to="planned">Add to schedule</button>
         <button type="button" class="btn" data-dlg="add" data-code="${c.code}" data-to="contemplated">Add as contemplated</button>`}</div>
  </div>`);
}

/** Options for an override's requirement select: Foundations, FLMBE, then one group per concentration. */
function targetOptions(selected = "") {
  const groups = new Map();
  for (const t of REQ.targets.values()) {
    const g = t.concId ? REQ.concentrations.find(c => c.id === t.concId).label : t.id.startsWith("foundations:") ? "Foundations" : "FLMBE";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(`<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.concId ? t.short : t.label)}</option>`);
  }
  return [...groups].map(([g, opts]) => `<optgroup label="${esc(g)}">${opts.join("")}</optgroup>`).join("");
}

/** The pop-up's "Counts toward" section: where the course counts now, where it could count, its overrides, and a
 *  form to add an override for its number. */
function countsTowardHtml(c) {
  const num = c.num;
  const selected = state.selected.some(p => p.code === c.code);
  const used = selected && lastEval ? lastEval.usage.get(`p:${c.code}`) || [] : [];
  const keptInstead = selected && lastEval ? lastEval.duplicates.get(`p:${c.code}`) : null;
  const eligible = REQ.eligibleTargets(num, req.overrides);
  const mine = req.overrides.map((o, i) => [o, i]).filter(([o]) => o.num === num);
  const chip = t => `<span class="rq${t.override ? " ovr" : ""}">${t.override ? "override · " : ""}${esc(t.label)}${t.via ? ` (as ${esc(t.via)})` : ""}</span>`;
  const credit = sectionUnits(c.sections[0]) > 0;
  return `<section class="counts"><h3>Counts toward</h3>
    ${credit ? "" : `<p class="muted">Law School course: it earns no Booth units unless the requirements cross-list it or an override adds it.</p>`}
    ${keptInstead ? `<p><span class="badge">counted once</span>This course is listed more than once. ${esc(duplicateText(keptInstead))}.</p>` : ""}
    ${selected && !keptInstead ? `<p>${used.length ? "With your courses, it counts now toward:" : "With your courses, it counts toward no listed requirement now; its units go to electives."}</p>
      ${used.length ? `<div class="reqchips">${used.map(chip).join("")}</div>` : ""}` : ""}
    <p>${eligible.length ? "It can count toward:" : "It is not on any requirement list."}</p>
    ${eligible.length ? `<div class="reqchips">${eligible.map(chip).join("")}</div>` : ""}
    ${mine.length ? `<ul class="req-list">${mine.map(([o, i]) => overrideItem(o, i)).join("")}</ul>` : ""}
    <div class="req-form">
      <label>Override for ${esc(num)}<select id="dlg-ov-kind"><option value="add">also counts toward</option><option value="remove">does not count toward</option></select></label>
      <label class="grow"><span class="sr">Requirement</span><select id="dlg-ov-target">${targetOptions()}</select></label>
      <button type="button" class="btn" data-dlg="ovr-add" data-code="${c.code}">Add override</button>
    </div>
  </section>`;
}

/** Opens the professor pop-up: title, bio, faculty-page link and their 2026-27 courses by quarter. */
function openProf(id, push = true) {
  const p = DETAILS.profs[id];
  if (!p) return;
  if (push) dlgStack.push({ kind: "prof", id });
  const teaching = COURSE_LIST.filter(c => c.sections.some(s => profIds(s).includes(id)));
  const bio = p.bio.length ? `<div class="prose">${p.bio.map(t => `<p>${esc(t)}</p>`).join("")}</div>`
    : `<p class="muted">No biography was available${p.school === "Law" ? " on the Law School site" : ""}.</p>`;
  showDialog(dlgHeader(esc(p.school === "Booth" ? "Booth faculty" : "Law School"), p.name, p.title ? esc(p.title) : "") +
    `<div class="dlg-body">
      <section>${bio}</section>
      ${p.url ? `<div class="dlg-actions"><a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Law School faculty page ↗</a></div>` : ""}
      ${TERMS.filter(term => teaching.some(c => c.term === term)).map(term => `<section><h3>Teaching in ${esc(term)}</h3><ul class="teach">${teaching.filter(c => c.term === term).map(c =>
        `<li><button type="button" data-course="${c.code}"><span class="code">${esc(c.label)}</span><span class="t">${esc(c.name)}</span></button></li>`).join("")}</ul></section>`).join("")}
    </div>`);
}

DLG.addEventListener("click", e => {
  if (e.target === DLG) { DLG.close(); return; }  // click on the backdrop
  const prof = e.target.closest("[data-prof]");
  if (prof) { openProf(prof.dataset.prof); return; }
  const course = e.target.closest("[data-course]");
  if (course) { openCourse(course.dataset.course); return; }
  const act = e.target.closest("[data-dlg]");
  if (!act) return;
  if (act.dataset.dlg === "close") DLG.close();
  if (act.dataset.dlg === "back") {
    dlgStack.pop();
    const prev = dlgStack[dlgStack.length - 1];
    prev.kind === "course" ? openCourse(prev.code, false) : openProf(prev.id, false);
  }
  const code = act.dataset.code;
  if (act.dataset.dlg === "add") { addCourse(code, act.dataset.to); openCourse(code, false); }
  if (act.dataset.dlg === "status") { setStatus(code, act.dataset.to); openCourse(code, false); }
  if (act.dataset.dlg === "remove") { removeCourse(code); openCourse(code, false); }
  if (act.dataset.dlg === "ovr-add") {
    addOverride(COURSES.get(code).num, DLG.querySelector("#dlg-ov-kind").value, DLG.querySelector("#dlg-ov-target").value);
    openCourse(code, false);
  }
});
DLG.addEventListener("click", e => {
  // Override × buttons in the pop-up; the course to reopen is the one on top of the pop-up history.
  const x = e.target.closest("[data-ov-remove]");
  if (!x) return;
  removeOverride(Number(x.dataset.ovRemove));
  const top = dlgStack[dlgStack.length - 1];
  if (top?.kind === "course") openCourse(top.code, false);
});
DLG.addEventListener("close", () => { dlgStack = []; });

// ---------- drag and drop ----------

/** Active drag: {code, prevFocus, proxy, dx, dy, targetId}, or null. */
let drag = null;
/** Pointer pressed on a class but not yet moved past DRAG_THRESHOLD_PX; a release here is a plain click. */
let pending = null;
let dragEndedAt = 0;
const DRAG_THRESHOLD_PX = 5;

/** Enters highlight mode for the dragged course and attaches a floating copy of the block to the pointer. */
function startDrag(p) {
  drag = { code: p.code, prevFocus: state.focus, dx: p.dx, dy: p.dy, targetId: null, proxy: null };
  state.focus = p.code;
  render();
  document.getElementById("calwrap").classList.add("dragging");
  const tmp = document.createElement("div");
  tmp.innerHTML = p.html;
  const proxy = tmp.firstElementChild;
  proxy.classList.add("drag-proxy");
  proxy.removeAttribute("tabindex");
  proxy.removeAttribute("title");
  const hue = state.selected.find(s => s.code === p.code).hue;
  proxy.style.cssText = `--h:${hue};width:${p.w}px;height:${p.h}px;`;
  document.body.appendChild(proxy);
  drag.proxy = proxy;
}

/** Moves the floating copy and marks every meeting of the section under the pointer as the drop target. */
function moveDrag(x, y) {
  drag.proxy.style.left = `${x - drag.dx}px`;
  drag.proxy.style.top = `${y - drag.dy}px`;
  const hit = document.elementFromPoint(x, y)?.closest(".ghost.alt");
  const targetId = hit && hit.dataset.code === drag.code ? hit.dataset.id : null;
  if (targetId === drag.targetId) return;
  drag.targetId = targetId;
  document.querySelectorAll(".ghost.alt").forEach(g => g.classList.toggle("drop-target", g.dataset.id === targetId));
}

/** Ends the drag. Switches to the target section when `drop` is true and the pointer is on one. */
function endDrag(drop) {
  const { code, prevFocus, targetId, proxy } = drag;
  proxy.remove();
  document.getElementById("calwrap").classList.remove("dragging");
  drag = null;
  dragEndedAt = performance.now();
  state.focus = prevFocus;
  if (drop && targetId) switchSection(code, targetId);
  else render();
}

document.getElementById("cal").addEventListener("pointerdown", e => {
  const blk = e.target.closest(".blk");
  if (!blk || e.button !== 0 || drag) return;
  const r = blk.getBoundingClientRect();
  pending = { code: blk.dataset.code, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top,
              w: r.width, h: r.height, html: blk.outerHTML };
});

document.addEventListener("pointermove", e => {
  if (pending && !drag) {
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < DRAG_THRESHOLD_PX) return;
    startDrag(pending);
    pending = null;
  }
  if (!drag) return;
  e.preventDefault();
  moveDrag(e.clientX, e.clientY);
});

document.addEventListener("pointerup", () => { pending = null; if (drag) endDrag(true); });
document.addEventListener("pointercancel", () => { pending = null; if (drag) endDrag(false); });

// ---------- events ----------

/** Last click on a class block, used to recognize a double-click. */
let lastBlkClick = { code: null, t: 0, prevFocus: null };

document.getElementById("showmaybe").addEventListener("change", e => {
  state.showContemplated = e.target.checked;
  commit();
});

document.getElementById("schools").addEventListener("click", e => {
  const b = e.target.closest("button[data-school]");
  if (b) { state.school = b.dataset.school; renderResults(); }
});

document.getElementById("search").addEventListener("input", e => { state.query = e.target.value; renderResults(); });

document.getElementById("fills").addEventListener("change", e => { state.fills = e.target.value; renderResults(); });

document.querySelector(".tabs").addEventListener("click", e => {
  const tab = e.target.closest("[role=tab]");
  if (!tab) return;
  state.view = tab.id === "tab-requirements" ? "requirements" : "calendar";
  if (state.view === "requirements") state.focus = null;
  render();
});

// ---------- requirements view events ----------

/** Fills the selects that do not change with the visitor's state. Runs once at start-up. */
function setupRequirementControls() {
  document.getElementById("fills").innerHTML = `<option value="">Any requirement</option>` +
    ["Foundations", "FLMBE", "Concentrations"].map(g => `<optgroup label="${g}">${REQ.filterOptions.filter(o => o.group === g)
      .map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</optgroup>`).join("");
  document.getElementById("req-program").innerHTML = REQ.programs.map(p => `<option value="${esc(p.id)}">${esc(p.label)} · ${fmtU(p.total_units)} units</option>`).join("");
  document.getElementById("req-noncredit").innerHTML = REQ.degree.non_credit.map(n =>
    `<label title="${esc(n.note || "")}"><input type="checkbox" data-noncredit="${esc(n.id)}"> ${esc(n.label)}</label>`).join("");
  document.getElementById("ov-target").innerHTML = targetOptions();
}

function showMsg(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle("err", isError);
}

/** Fills the Other quarters title from the course data while the typed number matches a course. */
document.getElementById("oq-num").addEventListener("input", e => {
  const title = document.getElementById("oq-title");
  const match = COURSE_BY_NUM.get(W27Req.normalizeNumber(e.target.value));
  if (match && (!title.value || title.dataset.auto === "1")) { title.value = match.name; title.dataset.auto = "1"; }
  else if (!match && title.dataset.auto === "1") { title.value = ""; title.dataset.auto = ""; }
});
document.getElementById("oq-title").addEventListener("input", e => { e.target.dataset.auto = ""; });

document.getElementById("oq-add").addEventListener("click", () => {
  const numEl = document.getElementById("oq-num"), titleEl = document.getElementById("oq-title");
  const num = W27Req.normalizeNumber(numEl.value);
  const units = Number(document.getElementById("oq-units").value);
  if (!num) { showMsg("oq-msg", "Enter a course number such as 35100, ECON 30100 or LAWS 48230.", true); numEl.focus(); return; }
  if (!Number.isInteger(units) || units < 0 || units > 1000) { showMsg("oq-msg", "Units must be a whole number from 0 to 1000.", true); return; }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  req.other.push({ id, num, title: titleEl.value.trim().slice(0, 200), quarter: document.getElementById("oq-quarter").value.trim().slice(0, 40),
                   status: document.getElementById("oq-status").value, units });
  numEl.value = ""; titleEl.value = ""; titleEl.dataset.auto = "";
  document.getElementById("oq-units").value = REQ.defaultUnits;
  showMsg("oq-msg", `Added ${num}.`);
  commitReq();
  numEl.focus();
});

document.getElementById("ov-add").addEventListener("click", () => {
  const num = W27Req.normalizeNumber(document.getElementById("ov-num").value);
  if (!num) { showMsg("ov-msg", "Enter a course number such as 38120 or ECON 30100.", true); return; }
  addOverride(num, document.getElementById("ov-kind").value, document.getElementById("ov-target").value);
  document.getElementById("ov-num").value = "";
  showMsg("ov-msg", `Override added for ${num}.`);
});

// Remember which "What counts" lists are open. This runs on the summary's click (Enter and Space click too), not on
// "toggle", which fires later and is lost if a re-render replaces the element first. d.open is still the old state.
document.getElementById("req-concs").addEventListener("click", e => {
  const d = e.target.closest("details[data-what] > summary")?.parentElement;
  if (!d) return;
  if (d.open) openWhat.delete(d.dataset.what); else openWhat.add(d.dataset.what);
});

document.getElementById("reqview").addEventListener("change", e => {
  const el = e.target;
  if (el.id === "req-program") { req.program = el.value; commitReq(); return; }
  if (el.dataset.noncredit) { req[el.dataset.noncredit] = el.checked; commitReq(); return; }
  if (el.dataset.track !== undefined) {
    req.tracked = el.checked ? [...req.tracked, el.dataset.track] : req.tracked.filter(id => id !== el.dataset.track);
    commitReq();
    return;
  }
  const row = el.closest("[data-oq]");
  const o = row && req.other.find(x => x.id === row.dataset.oq);
  if (!o) return;
  if (el.matches("[data-oq-status]")) o.status = el.value;
  if (el.matches("[data-oq-units]")) {
    const units = Number(el.value);
    if (!Number.isInteger(units) || units < 0 || units > 1000) { el.value = o.units; showMsg("oq-msg", "Units must be a whole number from 0 to 1000.", true); return; }
    o.units = units;
  }
  commitReq();
});

document.getElementById("reqview").addEventListener("click", e => {
  const course = e.target.closest("[data-course]");
  if (course) { openCourse(course.dataset.course); return; }
  const oq = e.target.closest("[data-oq-remove]");
  if (oq) { req.other = req.other.filter(x => x.id !== oq.closest("[data-oq]").dataset.oq); commitReq(); return; }
  const ov = e.target.closest("[data-ov-remove]");
  if (ov) { removeOverride(Number(ov.dataset.ovRemove)); return; }
  if (e.target.closest("#exp-copy")) {
    const text = JSON.stringify(exportState(), null, 2);
    const box = document.getElementById("imp-text");
    box.value = text;
    const done = () => showMsg("imp-msg", "Backup copied. The same text is in the box below.");
    const manual = () => { box.select(); showMsg("imp-msg", "Your browser blocked copying. The backup is selected in the box below: copy it from there."); };
    try { navigator.clipboard.writeText(text).then(done, manual); } catch (err) { manual(); }
    return;
  }
  if (e.target.closest("#imp-go")) {
    const text = document.getElementById("imp-text").value.trim();
    if (!text) { showMsg("imp-msg", "Paste a backup into the box first.", true); return; }
    const r = parseBackup(text);
    if (!r.ok) { showMsg("imp-msg", `Nothing was restored. ${r.error}`, true); return; }
    state.selected = [];
    for (const p of r.selected) state.selected.push({ ...p, hue: p.hue ?? nextHue(COURSES.get(p.code).term) });
    state.showContemplated = r.showContemplated;
    state.focus = null;
    req = r.requirements;
    save();
    commitReq();
    showMsg("imp-msg", `Restored ${r.selected.length} selected course${r.selected.length === 1 ? "" : "s"}, ${req.other.length} other-quarter course${req.other.length === 1 ? "" : "s"} and ${req.overrides.length} override${req.overrides.length === 1 ? "" : "s"}.${r.skipped ? ` Skipped ${r.skipped} section${r.skipped === 1 ? "" : "s"} not in the course data.` : ""}`);
  }
});

document.getElementById("results").addEventListener("click", e => {
  const info = e.target.closest("[data-info]");
  if (info) { openCourse(info.dataset.info); return; }
  const b = e.target.closest(".res");
  if (!b) return;
  const code = b.dataset.code;
  state.selected.some(p => p.code === code) ? removeCourse(code) : addCourse(code);
});

document.getElementById("selected").addEventListener("click", e => {
  const x = e.target.closest("[data-remove]");
  if (x) { removeCourse(x.dataset.remove); return; }
  const info = e.target.closest("[data-info]");
  if (info) { openCourse(info.dataset.info); return; }
  const mv = e.target.closest("[data-to]");
  if (mv) { setStatus(mv.dataset.code, mv.dataset.to); return; }
  const prof = e.target.closest("[data-prof]");
  if (prof) { openProf(prof.dataset.prof); return; }
  const pill = e.target.closest(".pill");
  if (pill) setFocus(pill.dataset.code);
});

document.getElementById("calwrap").addEventListener("click", e => {
  if (performance.now() - dragEndedAt < 300) return;  // the click that ends a drag is not a selection
  if (e.target.closest("#exitfocus")) { state.focus = null; render(); return; }
  const info = e.target.closest("#focusbar [data-info]");
  if (info) { openCourse(info.dataset.info); return; }
  const mv = e.target.closest("#focusbar [data-to]");
  if (mv) { setStatus(mv.dataset.code, mv.dataset.to); return; }
  const ghost = e.target.closest(".ghost");
  if (ghost) {
    if (state.focus === ghost.dataset.code) switchSection(ghost.dataset.code, ghost.dataset.id);
    else setFocus(ghost.dataset.code);
    return;
  }
  const blk = e.target.closest(".blk");
  if (blk) {
    // The first click redraws the calendar, so the browser's dblclick never fires; detect two quick clicks here.
    const now = performance.now();
    if (lastBlkClick.code === blk.dataset.code && now - lastBlkClick.t < 400) {
      state.focus = lastBlkClick.prevFocus;
      lastBlkClick = { code: null, t: 0, prevFocus: null };
      render();
      openCourse(blk.dataset.code);
      return;
    }
    lastBlkClick = { code: blk.dataset.code, t: now, prevFocus: state.focus };
    setFocus(blk.dataset.code);
    return;
  }
  if (state.focus && e.target.closest(".daycol")) { state.focus = null; render(); }
});

document.addEventListener("keydown", e => {
  if (DLG.open) return;  // the dialog handles its own Esc
  if (e.key === "Escape" && drag) { endDrag(false); return; }
  if (e.key === "Escape" && state.focus) { state.focus = null; render(); return; }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".blk, .ghost.alt, .pill")) {
    e.preventDefault();
    e.target.click();
  }
});

// ---------- quarter switcher and theme ----------

document.getElementById("terms").innerHTML = TERMS.map(t =>
  `<button type="button" data-term="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("");
document.getElementById("terms").addEventListener("click", e => {
  const b = e.target.closest("button[data-term]");
  if (b) setTerm(b.dataset.term);
});

const THEME_KEY = "w27-theme";

/** Updates the toggle's icon and label for the theme on <html> (index.html sets it before first paint). */
function renderThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  const btn = document.getElementById("theme-toggle");
  btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  btn.title = btn.getAttribute("aria-label");
  btn.dataset.icon = dark ? "sun" : "moon";
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage unavailable: the choice lasts this visit */ }
  renderThemeToggle();
});

load();
loadReq();
setupRequirementControls();
renderThemeToggle();
render();
