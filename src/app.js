/**
 * Winter 2027 Schedule Builder: weekly calendar for picking Booth (BUSN) and Law School (LAWS) sections.
 *
 * Inputs: window.W27_SECTIONS and window.W27_DETAILS, set by data.js (built by scripts/build.py).
 * Side effects: renders into the elements of index.html; keeps the viewer's selection in localStorage
 * under "booth-w27-schedule" and "w27-show-contemplated".
 */
"use strict";

/** Pop-up details: texts (shared descriptions), sections {id: {d, tags, notes, outcomes, loc, dates, units, p}},
 *  profs {id: {name, title, bio, url, school}}. Booth data comes from the bidding site's description and
 *  faculty loaders; Law data from UC Classes Self-Service class details and Law School faculty pages. */
const DETAILS = window.W27_DETAILS;

/** Winter 2027 section records: Booth (dept BUSN) from the Booth course-search export,
 *  Law School (dept LAWS) from UC Classes Self-Service.
 *  meets: d = day index (0 = Monday), s/e = start/end in minutes after midnight. Empty meets = no time listed. */
const SECTIONS = window.W27_SECTIONS;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GRID_START = 8 * 60;   // 8:00 AM
const GRID_END = 22 * 60;    // 10:00 PM
const HUES = [212, 152, 28, 280, 350, 190, 48, 110, 250, 320];
const STORE_KEY = "booth-w27-schedule";

const SCHOOLS = { BUSN: "Booth", LAWS: "Law" };

/** Courses keyed by an ASCII course key (course.code, e.g. "BUSN30000"); sections sorted by first
 *  meeting from Monday 8 AM. Sections that share a number but not a title (the Law School's
 *  Greenberg Seminars, LAWS 92000) are separate courses with keys like "LAWS92000.2". */
const COURSES = new Map();
{
  const titlesByNumber = new Map();
  for (const sec of SECTIONS) {
    const num = sec.dept + sec.code;
    if (!titlesByNumber.has(num)) titlesByNumber.set(num, []);
    const titles = titlesByNumber.get(num);
    if (!titles.includes(sec.name)) titles.push(sec.name);
    const i = titles.indexOf(sec.name);
    sec.key = i ? `${num}.${i}` : num;
    sec.first = sec.meets.length ? Math.min(...sec.meets.map(m => m.d * 1440 + m.s)) : Infinity;
    if (!COURSES.has(sec.key)) {
      COURSES.set(sec.key, { code: sec.key, dept: sec.dept, label: `${sec.dept} ${sec.code}`, name: sec.name, sections: [] });
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
const COURSE_LIST = [...COURSES.values()].sort((a, b) => a.dept.localeCompare(b.dept) || a.label.localeCompare(b.label) || a.code.localeCompare(b.code));

/** App state. selected: ordered list of {code, id, hue, status}; status is "planned" (on the schedule) or
 *  "contemplated" (under consideration). focus: course code in highlight mode, or null. */
const state = { selected: [], focus: null, query: "", school: "ALL", showContemplated: true };
const SHOW_KEY = "w27-show-contemplated";

function isContemplated(p) {
  return p.status === "contemplated";
}

// ---------- scheduling logic ----------

/** True when two meetings share a day and their time ranges overlap (touching ends do not overlap). */
function meetsOverlap(a, b) {
  return a.d === b.d && a.s < b.e && b.s < a.e;
}

/** True when section `sec` overlaps a selected section other than course `skipCode`'s.
 *  With plannedOnly, contemplated courses are ignored. */
function clashesWithPlaced(sec, skipCode, plannedOnly = false) {
  return state.selected.some(p => p.code !== skipCode && !(plannedOnly && isContemplated(p)) &&
    SECTION_BY_ID.get(p.id).meets.some(pm => sec.meets.some(m => meetsOverlap(m, pm))));
}

/** Returns the earliest section (from Monday 8 AM) that clashes with nothing selected; else the earliest that
 *  clashes with no planned course; else the earliest section. */
function pickDefaultSection(course) {
  return course.sections.find(s => !clashesWithPlaced(s, course.code))
    || course.sections.find(s => !clashesWithPlaced(s, course.code, true))
    || course.sections[0];
}

function nextHue() {
  const used = new Set(state.selected.map(p => p.hue));
  return HUES.find(h => !used.has(h)) ?? HUES[state.selected.length % HUES.length];
}

/** Adds a course with its default section. status: "planned" (default) or "contemplated". */
function addCourse(code, status = "planned") {
  if (state.selected.some(p => p.code === code)) return;
  const course = COURSES.get(code);
  state.selected.push({ code, id: pickDefaultSection(course).id, hue: nextHue(), status });
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
    // Saves from the Booth-only version keyed courses by bare number; re-key them by section id.
    // Saves from before contemplated courses existed have no status: they were on the schedule.
    state.selected = raw.filter(p => SECTION_BY_ID.has(p.id))
      .map(p => ({ ...p, code: SECTION_BY_ID.get(p.id).key, status: p.status === "contemplated" ? "contemplated" : "planned" }));
    state.showContemplated = localStorage.getItem(SHOW_KEY) !== "0";
  } catch (e) { state.selected = []; }
}

function commit() { save(); render(); }

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

/** Groups meetings that share a time range: "Tue/Thu 9:30–10:50 AM". */
function fmtMeets(sec) {
  if (!sec.meets.length) return "No meeting time listed";
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
  for (const p of state.selected) {
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
        if (!meetsOverlap(a, b)) continue;
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
  const hits = COURSE_LIST.filter(c => (state.school === "ALL" || c.dept === state.school) && tokens.every(t => c.hay.includes(t)));
  const chosen = new Map(state.selected.map(p => [p.code, p.status]));
  document.getElementById("rescount").textContent = `${hits.length} of ${COURSE_LIST.length}`;
  document.querySelectorAll("#schools button").forEach(b => b.setAttribute("aria-pressed", b.dataset.school === state.school));
  document.getElementById("results").innerHTML = hits.length ? hits.map(c => {
    const on = chosen.has(c.code), maybe = chosen.get(c.code) === "contemplated";
    const n = c.sections.length;
    const progs = [SCHOOLS[c.dept], ...new Set(c.sections.flatMap(s => s.prog))].join(", ");
    return `<li><button class="res" type="button" aria-pressed="${on}" data-code="${c.code}">
      <span class="box${maybe ? " maybe" : ""}" title="${maybe ? "Contemplated" : on ? "On schedule" : ""}">${maybe ? "?" : on ? "✓" : ""}</span>
      <span><span class="code">${c.label}</span><span class="t">${esc(c.name)}</span>
      <span class="sub">${n} section${n > 1 ? "s" : ""}${progs ? " · " + esc(progs) : ""}</span></span>
    </button><button class="info" type="button" data-info="${c.code}" aria-label="Details for ${c.label} ${esc(c.name)}">Details</button></li>`;
  }).join("") : `<li class="empty" style="padding:8px 4px">No course matches “${esc(state.query)}”. Try a course number or part of the title.</li>`;
}

function renderSelected(result) {
  const conflictCodes = new Set(result.conflicts.map(it => it.p.code));
  const warnCodes = new Set(result.warns.map(it => it.p.code));
  const list = document.getElementById("selected");
  document.getElementById("selcount").textContent = state.selected.length || "";
  if (!state.selected.length) { list.innerHTML = `<li class="empty">No courses yet. Pick one from the list above.</li>`; return; }

  const pill = p => {
    const c = COURSES.get(p.code), sec = SECTION_BY_ID.get(p.id);
    const alts = c.sections.length - 1;
    const maybe = isContemplated(p);
    return `<li class="pill${maybe ? " maybe" : ""}${state.focus === p.code ? " focused" : ""}" style="--h:${p.hue}" data-code="${p.code}" tabindex="0">
      <span class="stripe"></span>
      <span>
        <span class="code">${c.label}-${sec.sec}</span> <span class="t">${esc(c.name)}</span>
        <div class="sub">${profLinks(sec)} · ${fmtMeets(sec)}</div>
        ${sec.note ? `<div class="sub">${esc(sec.note)}</div>` : ""}
        <div class="sub">${alts ? `${alts} other section${alts > 1 ? "s" : ""}` : "Only section"}${sec.meets.length ? "" : " · not shown on the calendar"}</div>
        ${conflictCodes.has(p.code) ? `<div class="warn">Time conflict</div>` : ""}
        ${warnCodes.has(p.code) ? `<div class="soft">Clashes with your schedule</div>` : ""}
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
  const top = state.selected.filter(p => p.code === state.focus);
  const rest = state.selected.filter(p => p.code !== state.focus);
  const planned = rest.filter(p => !isContemplated(p)), maybe = rest.filter(isContemplated);
  const nPlanned = state.selected.filter(p => !isContemplated(p)).length;
  const nMaybe = state.selected.length - nPlanned;
  list.innerHTML = top.map(pill).join("")
    + `<li class="grp"><span>On schedule</span><span>${nPlanned}</span></li>`
    + (planned.length ? planned.map(pill).join("") : (top.length && !isContemplated(top[0]) ? "" : `<li class="empty">Nothing on the schedule yet.</li>`))
    + `<li class="grp"><span>Contemplated</span><span>${nMaybe}</span></li>`
    + (maybe.length ? maybe.map(pill).join("") : (top.length && isContemplated(top[0]) ? "" : `<li class="empty">Use Contemplate on a course to set it aside here.</li>`));
}

function renderStats(result) {
  const inConflict = new Set(result.conflicts.map(it => it.p.code)).size;
  const nPlanned = state.selected.filter(p => !isContemplated(p)).length;
  const nMaybe = state.selected.length - nPlanned;
  document.getElementById("stats").innerHTML =
    `<span class="chip">${nPlanned} on schedule</span>` +
    (nMaybe ? `<span class="chip">${nMaybe} contemplated</span>` : "") +
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
  const result = renderCalendar();
  renderResults();
  renderSelected(result);
  renderStats(result);
  renderFocusBar();
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
      <td>${fmtMeets(s)}${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}</td>
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
    `${esc(c.label)} · ${SCHOOLS[c.dept]}${first.units ? " · " + esc(first.units) : ""}`,
    c.name,
    tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""
  ) + `<div class="dlg-body">
    <section><h3>Description</h3>${descHtml}</section>
    ${notes.length ? `<section><h3>Notes</h3><ul>${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></section>` : ""}
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

/** Opens the professor pop-up: title, bio, faculty-page link and this quarter's courses. */
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
      <section><h3>Teaching in Winter 2027</h3><ul class="teach">${teaching.map(c =>
        `<li><button type="button" data-course="${c.code}"><span class="code">${esc(c.label)}</span><span class="t">${esc(c.name)}</span></button></li>`).join("")}</ul></section>
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

load();
render();
