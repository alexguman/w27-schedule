/**
 * Booth degree-requirement engine: assigns a visitor's courses to Foundations, FLMBE and concentration
 * requirements. Pure functions only: no DOM, no storage, no globals other than the export below.
 *
 * Input data: the parsed data/booth_requirements.json (window.W27_REQUIREMENTS in the browser).
 * Export: window.W27Req in the browser, module.exports in Node (used by tests/requirements.test.js).
 *
 * Terms used throughout:
 *   course number  Normalized string: Booth courses are bare five-digit numbers ("35100"); other departments
 *                  keep their prefix ("ECON 30100", "LAWS 48230"). See normalizeNumber().
 *   course         {uid, num, units, source, ...}: one course the visitor took or may take. uid is unique.
 *   source         "other" (other quarters), "scheduled" (Winter, on the schedule) or "contemplated"
 *                  (Winter, contemplated). Stronger sources are listed first in SOURCES.
 *   target         A requirement a course can be assigned to: "foundations:<row>", "flmbe:<row>" or
 *                  "conc:<concentration>:<component>".
 *   override       {num, kind: "add" | "remove", target}: the visitor's petition or exception for one course
 *                  number. "add" makes the course eligible for the target; "remove" makes it ineligible.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.W27Req = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Course sources, strongest first. Assignment prefers stronger sources when several courses could fill a slot. */
  const SOURCES = ["other", "scheduled", "contemplated"];
  const SOURCE_RANK = { other: 0, scheduled: 1, contemplated: 2 };
  const STATUSES = ["completed", "enrolled", "planned"];
  /** Largest number of courses shared by an overlap-capped pair that the exhaustive search considers. */
  const MAX_SHARED_SEARCH = 8;

  /**
   * Normalizes a course number typed by a visitor or taken from the Winter data.
   *
   * Args:
   *   text: e.g. "35100", "BUSN 35100", "busn35100-01", "ECON 30100", "laws48230".
   * Returns:
   *   "35100" for Booth (BUSN or no prefix), "ECON 30100" for other departments, or null when the text is
   *   not a department code (2–5 letters, optional) followed by five digits. A trailing section suffix
   *   ("-01") is ignored.
   */
  function normalizeNumber(text) {
    const m = /^\s*([A-Za-z]{2,5})?\s*(\d{5})(?:\s*-\s*\w+)?\s*$/.exec(String(text ?? ""));
    if (!m) return null;
    const dept = (m[1] || "BUSN").toUpperCase();
    return dept === "BUSN" ? m[2] : `${dept} ${m[2]}`;
  }

  /** Returns {other, scheduled, contemplated} unit totals for a list of courses. */
  function unitsBySource(courses) {
    const out = { other: 0, scheduled: 0, contemplated: 0 };
    for (const c of courses) out[c.source] += c.units;
    return out;
  }

  /** Orders courses strongest source first; ties keep input order. Does not mutate the input. */
  function bySourceStrength(courses) {
    return courses.map((c, i) => [c, i])
      .sort((a, b) => SOURCE_RANK[a[0].source] - SOURCE_RANK[b[0].source] || a[1] - b[1])
      .map(([c]) => c);
  }

  /**
   * Builds an engine for one requirements file.
   *
   * Args:
   *   data: parsed booth_requirements.json (schema_version 1).
   * Returns:
   *   {targets, concentrations, programs, filterOptions, eligibleTargets, fills, isBoothCredit, evaluate,
   *    defaultState, validateState}. See each function below.
   * Raises:
   *   Error when the file's schema_version is not 1.
   */
  function createEngine(data) {
    if (data.schema_version !== 1) throw new Error(`Unsupported requirements schema_version ${data.schema_version}`);
    const defaultUnits = data.default_course_units;
    const crosslist = new Map(data.crosslists.map(x => [x.course, x]));
    const concById = new Map(data.concentrations.map(c => [c.id, c]));
    const degreeRows = [
      ...data.degree.foundations.rows.map(r => ({ ...r, section: "foundations", target: `foundations:${r.id}` })),
      ...data.degree.flmbe.rows.map(r => ({ ...r, section: "flmbe", target: `flmbe:${r.id}` })),
    ];

    /** Every assignable target: {id, label, short, list: Set of course numbers, note?, concId?}. */
    const targets = new Map();
    for (const r of degreeRows) {
      const head = r.section === "foundations" ? "Foundations" : "FLMBE";
      targets.set(r.target, { id: r.target, label: `${head}: ${r.label}`, short: r.label, list: new Set([...r.basic, ...r.substitutes]), note: r.note });
    }
    for (const c of data.concentrations) {
      for (const comp of c.components) {
        if (comp.type === "all_flmbe_rows") continue;  // its slots are the FLMBE row targets
        const list = comp.courses ||
          comp.courses_from_concentrations.flatMap(id => concById.get(id).components.flatMap(k => k.courses || []));
        const label = c.components.length > 1 ? `${c.label}: ${comp.label}` : c.label;
        targets.set(`conc:${c.id}:${comp.id}`, { id: `conc:${c.id}:${comp.id}`, label, short: comp.label, list: new Set(list), concId: c.id });
      }
    }

    /** Course numbers that appear in any list, for isBoothCredit(). */
    const listed = new Set([...targets.values()].flatMap(t => [...t.list]));

    /**
     * Tells whether a course is eligible for a target.
     * Returns {ok, override, via}: override is true when a visitor override decided it; via is the
     * cross-listed number ("38120") when the course matched through a cross-list, else null.
     */
    function eligibility(num, target, overrides) {
      const own = overrides.filter(o => o.num === num && o.target === target);
      if (own.some(o => o.kind === "remove")) return { ok: false, override: true, via: null };
      if (own.some(o => o.kind === "add")) return { ok: true, override: true, via: null };
      const t = targets.get(target);
      if (t.list.has(num)) return { ok: true, override: false, via: null };
      const alias = crosslist.get(num)?.counts_as;
      if (alias && t.list.has(alias)) return { ok: true, override: false, via: alias };
      return { ok: false, override: false, via: null };
    }

    /**
     * Lists the targets a course number can count toward (for chips and the "Counts toward" pop-up).
     * Returns [{id, label, override, via}] in requirements-file order.
     */
    function eligibleTargets(num, overrides) {
      const out = [];
      for (const t of targets.values()) {
        const e = eligibility(num, t.id, overrides);
        if (e.ok) out.push({ id: t.id, label: t.label, override: e.override, via: e.via });
      }
      return out;
    }

    /** Options for the search filter: [{id, label, group}]. "conc:<id>" means any part of that concentration. */
    const filterOptions = [
      ...degreeRows.map(r => ({ id: r.target, label: r.label, group: r.section === "foundations" ? "Foundations" : "FLMBE" })),
      ...data.concentrations.flatMap(c => {
        const parts = c.components.filter(k => k.type !== "all_flmbe_rows");
        const any = { id: `conc:${c.id}`, label: parts.length > 1 || parts.length < c.components.length ? `${c.label} (any part)` : c.label, group: "Concentrations" };
        return parts.length > 1 ? [any, ...parts.map(k => ({ id: `conc:${c.id}:${k.id}`, label: `${c.label}: ${k.label}`, group: "Concentrations" }))] : [any];
      }),
    ];

    /** Tells whether course number `num` can fill filter option `filterId` (see filterOptions). */
    function fills(num, overrides, filterId) {
      if (targets.has(filterId)) return eligibility(num, filterId, overrides).ok;
      const conc = concById.get(filterId.replace(/^conc:/, ""));
      if (!conc) return false;
      return conc.components.some(k => k.type === "all_flmbe_rows"
        ? data.degree.flmbe.rows.some(r => eligibility(num, `flmbe:${r.id}`, overrides).ok)
        : eligibility(num, `conc:${conc.id}:${k.id}`, overrides).ok);
    }

    /** True when a non-Booth course earns Booth units here: cross-listed, listed in a requirement, or added by override. */
    function isBoothCredit(num, overrides) {
      return /^\d{5}$/.test(num) || crosslist.has(num) || listed.has(num) || overrides.some(o => o.num === num && o.kind === "add");
    }

    // ---------- Foundations + FLMBE ----------

    /**
     * Assigns courses to the 11 Foundations and FLMBE rows by bipartite matching (one course per row, one row
     * per course, which also enforces the distinct-credit rule). Courses are tried strongest source first and
     * each is placed by an augmenting path, so the result fills the most rows and, among those, prefers
     * stronger sources (greedy on a transversal matroid).
     *
     * Returns {rows: [{id, target, section, group, label, note, course, override, via, units, filled}],
     *          used: Set of uids placed in a row}.
     */
    function assignDegreeRows(courses, overrides) {
      const holder = new Array(degreeRows.length).fill(null);
      const ok = (c, i) => c.units > 0 && eligibility(c.num, degreeRows[i].target, overrides).ok;
      const place = (c, seen) => {
        for (let i = 0; i < degreeRows.length; i++) {
          if (seen.has(i) || !ok(c, i)) continue;
          seen.add(i);
          if (holder[i] === null || place(holder[i], seen)) { holder[i] = c; return true; }
        }
        return false;
      };
      for (const c of bySourceStrength(courses)) place(c, new Set());
      const rows = degreeRows.map((r, i) => {
        const c = holder[i];
        const e = c ? eligibility(c.num, r.target, overrides) : { override: false, via: null };
        const units = c ? Math.min(c.units, defaultUnits) : 0;
        return { id: r.id, target: r.target, section: r.section, group: r.group || null, label: r.label, note: r.note || null,
                 course: c, override: e.override, via: e.via, units, filled: units >= defaultUnits };
      });
      return { rows, used: new Set(holder.filter(Boolean).map(c => c.uid)) };
    }

    // ---------- concentrations ----------

    /** Expands a concentration into slots: {compId, target, need, cap}. General Management's
     *  all_flmbe_rows component becomes eight 100-unit slots, one per FLMBE row. */
    function slotsFor(conc) {
      return conc.components.flatMap(comp => {
        if (comp.type === "all_flmbe_rows") {
          return data.degree.flmbe.rows.map(r => ({ compId: comp.id, target: `flmbe:${r.id}`, need: defaultUnits, cap: defaultUnits }));
        }
        const need = comp.units ?? comp.min_units ?? 0;
        return [{ compId: comp.id, target: `conc:${conc.id}:${comp.id}`, need, cap: comp.max_units ?? comp.units ?? Infinity }];
      });
    }

    /**
     * Assigns courses to one concentration's slots, each course at most once.
     *
     * Phase 1 fills each slot up to its required units; phase 2 adds courses up to each slot's maximum. Both
     * place courses strongest source first with augmenting paths that may move an earlier course to another
     * slot. Exact for 100-unit courses; with 50-unit courses it is a good assignment but not always optimal.
     *
     * Args:
     *   conc: concentration from the requirements file.
     *   courses: candidate courses; those in `exclude` (a Set of uids) are skipped.
     * Returns: Map slotIndex -> array of courses.
     */
    function assignSlots(conc, courses, overrides, exclude) {
      const slots = slotsFor(conc);
      const held = slots.map(() => []);
      const load = i => held[i].reduce((s, c) => s + c.units, 0);
      const ok = (c, i) => c.units > 0 && eligibility(c.num, slots[i].target, overrides).ok;
      const run = capOf => {
        const place = (c, seen) => {
          for (let i = 0; i < slots.length; i++) {
            if (seen.has(i) || !ok(c, i)) continue;
            seen.add(i);
            if (load(i) + c.units <= capOf(i)) { held[i].push(c); return true; }
            for (const d of [...held[i]]) {
              if (load(i) - d.units + c.units > capOf(i)) continue;
              held[i].splice(held[i].indexOf(d), 1);
              if (place(d, seen)) { held[i].push(c); return true; }
              held[i].push(d);
            }
          }
          return false;
        };
        const placed = new Set(held.flat().map(c => c.uid));
        for (const c of bySourceStrength(courses)) {
          if (!exclude.has(c.uid) && !placed.has(c.uid) && place(c, new Set())) placed.add(c.uid);
        }
      };
      run(i => slots[i].need);
      run(i => slots[i].cap);
      return { slots, held };
    }

    /** Units that count toward progress, capped at each component's requirement, for one set of sources. */
    function cappedProgress(components, sources) {
      return components.reduce((s, k) => s + Math.min(k.need, k.courses.filter(c => sources.includes(c.source)).reduce((t, c) => t + c.units, 0)), 0);
    }

    /**
     * Evaluates one concentration without the overlap caps.
     * Returns {id, label, units, components: [...], courses, total, rulesOk, ruleMessages, notes, score}.
     */
    function evaluateConcentration(conc, courses, overrides, exclude) {
      const { slots, held } = assignSlots(conc, courses, overrides, exclude);
      const components = conc.components.map(comp => {
        const idx = slots.map((s, i) => [s, i]).filter(([s]) => s.compId === comp.id).map(([, i]) => i);
        const entries = idx.flatMap(i => held[i].map(c => {
          const e = eligibility(c.num, slots[i].target, overrides);
          return { course: c, target: slots[i].target, override: e.override, via: e.via };
        }));
        const units = entries.reduce((s, x) => s + x.course.units, 0);
        const need = idx.reduce((s, i) => s + slots[i].need, 0);
        const rowsFilled = comp.type === "all_flmbe_rows" ? idx.filter(i => held[i].reduce((s, c) => s + c.units, 0) >= defaultUnits).length : null;
        const done = comp.type === "all_flmbe_rows" ? rowsFilled === idx.length : units >= need;
        return { id: comp.id, label: comp.label, need, min: comp.min_units ?? null, max: comp.max_units ?? null,
                 entries, courses: entries.map(x => x.course), units, bySource: unitsBySource(entries.map(x => x.course)),
                 rowsFilled, rowsTotal: comp.type === "all_flmbe_rows" ? idx.length : null, done };
      });
      const counted = components.flatMap(k => k.courses);
      const nums = new Set(counted.flatMap(c => [c.num, crosslist.get(c.num)?.counts_as].filter(Boolean)));
      const ruleMessages = (conc.rules || []).filter(r => r.type === "at_least_one_of" && !r.courses.some(n => nums.has(n)))
        .map(r => `Needs at least one of ${r.courses.join(", ")}.`);
      const total = counted.reduce((s, c) => s + c.units, 0);
      return {
        id: conc.id, label: conc.label, units: conc.units, components, courses: counted, total,
        bySource: unitsBySource(counted), rulesOk: ruleMessages.length === 0, ruleMessages, notes: conc.notes || [],
        score: [cappedProgress(components, SOURCES), cappedProgress(components, ["other", "scheduled"]), cappedProgress(components, ["other"]), -total],
      };
    }

    const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
    const addScores = (a, b) => a.map((x, i) => x + b[i]);

    /**
     * Enforces one overlap cap between concentrations A and B (both already evaluated).
     *
     * When they share more units than allowed, tries every way to keep each shared course in both, only A,
     * or only B (up to MAX_SHARED_SEARCH shared courses), re-runs both assignments, and keeps the valid result
     * with the best combined progress. Removing every A course from B is always valid and is the fallback.
     *
     * Returns {a, b, shared} where shared lists the courses that still count toward both.
     */
    function enforceCap(concA, concB, max, courses, overrides, evalA, evalB) {
      const sharedOf = (x, y) => { const ids = new Set(y.courses.map(c => c.uid)); return x.courses.filter(c => ids.has(c.uid)); };
      const unitsOf = list => list.reduce((s, c) => s + c.units, 0);
      let shared = sharedOf(evalA, evalB);
      if (unitsOf(shared) <= max) return { a: evalA, b: evalB, shared };
      const pool = shared.slice(0, MAX_SHARED_SEARCH);
      const fallbackB = evaluateConcentration(concB, courses, overrides, new Set(evalA.courses.map(c => c.uid)));
      let best = { a: evalA, b: fallbackB, shared: sharedOf(evalA, fallbackB) };
      const combos = 3 ** pool.length;
      for (let n = 0; n < combos; n++) {
        const notA = new Set(), notB = new Set();
        let k = n;
        for (const c of pool) { const choice = k % 3; k = Math.floor(k / 3); if (choice === 1) notB.add(c.uid); if (choice === 2) notA.add(c.uid); }
        for (const c of shared.slice(MAX_SHARED_SEARCH)) notB.add(c.uid);
        const a = evaluateConcentration(concA, courses, overrides, notA);
        const b = evaluateConcentration(concB, courses, overrides, notB);
        const both = sharedOf(a, b);
        if (unitsOf(both) > max) continue;
        if (better(addScores(a.score, b.score), addScores(best.a.score, best.b.score))) best = { a, b, shared: both };
      }
      return best;
    }

    // ---------- whole evaluation ----------

    /**
     * Evaluates a visitor's progress.
     *
     * Args:
     *   input.program: a program id ("mba" or "jdmba").
     *   input.courses: [{uid, num, units, source, ...}]; extra fields are passed through untouched.
     *   input.overrides: [{num, kind, target}].
     *   input.tracked: concentration ids to evaluate (any number).
     * Returns:
     *   {program, rows, foundations: {filled, choose, total}, flmbe: {filled, choose, total},
     *    electives: {units, bySource}, total: {units, target, bySource}, concentrations: [...],
     *    usage: Map uid -> [{target, label, override, via}]}.
     *   Concentrations are in requirements-file order and carry blockedBy (unmet `requires`), caps (overlap
     *   caps applied), notes, ruleMessages and done.
     */
    function evaluate(input) {
      const courses = input.courses;
      const overrides = input.overrides || [];
      const program = data.programs.find(p => p.id === input.program) || data.programs[0];
      const { rows, used } = assignDegreeRows(courses, overrides);
      const rowStats = section => {
        const list = rows.filter(r => r.section === section);
        return { filled: list.filter(r => r.filled).length, choose: data.degree[section].choose, total: list.length };
      };
      const electiveCourses = courses.filter(c => !used.has(c.uid));
      const rowCourses = rows.filter(r => r.course).map(r => r.course);

      // Concentrations named in `requires` are evaluated even when not tracked, to decide blockedBy.
      const tracked = data.concentrations.filter(c => (input.tracked || []).includes(c.id));
      const needed = new Set(tracked.flatMap(c => [c.id, ...(c.requires || [])]));
      const evals = new Map();
      for (const c of data.concentrations) if (needed.has(c.id)) evals.set(c.id, evaluateConcentration(c, courses, overrides, new Set()));
      const capsApplied = new Map();
      for (const cap of data.concentration_rules.overlap_caps) {
        const [idA, idB] = cap.concentrations;
        if (!evals.has(idA) || !evals.has(idB)) continue;
        const r = enforceCap(concById.get(idA), concById.get(idB), cap.max_shared_units, courses, overrides, evals.get(idA), evals.get(idB));
        evals.set(idA, r.a); evals.set(idB, r.b);
        const info = { with: null, max: cap.max_shared_units, shared: r.shared, sharedUnits: r.shared.reduce((s, c) => s + c.units, 0) };
        capsApplied.set(idA, [...(capsApplied.get(idA) || []), { ...info, with: idB }]);
        capsApplied.set(idB, [...(capsApplied.get(idB) || []), { ...info, with: idA }]);
      }
      const concentrations = tracked.map(c => {
        const e = evals.get(c.id);
        const blockedBy = (c.requires || []).filter(id => !isDone(evals.get(id)));
        return { ...e, blockedBy, caps: capsApplied.get(c.id) || [], done: isDone(e) && blockedBy.length === 0 };
      });

      const usage = new Map(courses.map(c => [c.uid, []]));
      for (const r of rows) if (r.course) usage.get(r.course.uid).push({ target: r.target, label: targets.get(r.target).label, override: r.override, via: r.via });
      for (const e of concentrations) {
        for (const k of e.components) for (const x of k.entries) {
          const label = targets.has(x.target) && x.target.startsWith("conc:") ? targets.get(x.target).label : `${e.label}: ${k.label}`;
          usage.get(x.course.uid).push({ target: x.target, label, override: x.override, via: x.via });
        }
      }
      return {
        program: { id: program.id, label: program.label, target: program.total_units, note: program.note || null, minBooth: program.min_booth_units || null },
        rows, foundations: rowStats("foundations"), flmbe: rowStats("flmbe"),
        rowUnits: unitsBySource(rowCourses),
        electives: { units: electiveCourses.reduce((s, c) => s + c.units, 0), bySource: unitsBySource(electiveCourses) },
        total: { units: courses.reduce((s, c) => s + c.units, 0), target: program.total_units, bySource: unitsBySource(courses) },
        concentrations, usage,
      };
    }

    function isDone(e) {
      return !!e && e.total >= e.units && e.components.every(k => k.done) && e.rulesOk;
    }

    // ---------- visitor state ----------

    /** The empty visitor state stored under "w27-requirements". */
    function defaultState() {
      return { program: data.programs[0].id, lead: false, qwe: false, other: [], overrides: [], tracked: [] };
    }

    /**
     * Validates visitor state (from storage or an import) without trusting its shape.
     *
     * Returns {ok: true, value} with a cleaned copy (course numbers normalized, unknown fields dropped), or
     * {ok: false, error} with a message that names the first bad field, e.g. "other[2].units must be ...".
     */
    function validateState(obj) {
      const fail = error => ({ ok: false, error });
      const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
      if (!isObj(obj)) return fail("requirements must be an object.");
      const value = defaultState();
      if (obj.program !== undefined) {
        if (!data.programs.some(p => p.id === obj.program)) return fail(`program must be one of ${data.programs.map(p => `"${p.id}"`).join(", ")}.`);
        value.program = obj.program;
      }
      for (const k of ["lead", "qwe"]) {
        if (obj[k] === undefined) continue;
        if (typeof obj[k] !== "boolean") return fail(`${k} must be true or false.`);
        value[k] = obj[k];
      }
      for (const k of ["other", "overrides", "tracked"]) {
        if (obj[k] !== undefined && !Array.isArray(obj[k])) return fail(`${k} must be a list.`);
      }
      for (const [i, o] of (obj.other || []).entries()) {
        const at = `other[${i}]`;
        if (!isObj(o)) return fail(`${at} must be an object.`);
        const num = normalizeNumber(o.num);
        if (!num) return fail(`${at}.num must be a course number such as "35100" or "ECON 30100".`);
        if (!Number.isInteger(o.units) || o.units < 0 || o.units > 1000) return fail(`${at}.units must be a whole number from 0 to 1000.`);
        if (!STATUSES.includes(o.status)) return fail(`${at}.status must be one of ${STATUSES.join(", ")}.`);
        for (const f of ["id", "title", "quarter"]) if (typeof (o[f] ?? "") !== "string") return fail(`${at}.${f} must be text.`);
        value.other.push({ id: o.id || `o${i}-${num}`, num, title: (o.title || "").slice(0, 200), quarter: (o.quarter || "").slice(0, 40), status: o.status, units: o.units });
      }
      if (new Set(value.other.map(o => o.id)).size !== value.other.length) return fail("other has two courses with the same id.");
      for (const [i, o] of (obj.overrides || []).entries()) {
        const at = `overrides[${i}]`;
        if (!isObj(o)) return fail(`${at} must be an object.`);
        const num = normalizeNumber(o.num);
        if (!num) return fail(`${at}.num must be a course number.`);
        if (o.kind !== "add" && o.kind !== "remove") return fail(`${at}.kind must be "add" or "remove".`);
        if (!targets.has(o.target)) return fail(`${at}.target "${String(o.target)}" is not a known requirement.`);
        value.overrides.push({ num, kind: o.kind, target: o.target });
      }
      for (const [i, id] of (obj.tracked || []).entries()) {
        if (!concById.has(id)) return fail(`tracked[${i}] "${String(id)}" is not a known concentration.`);
        if (!value.tracked.includes(id)) value.tracked.push(id);
      }
      return { ok: true, value };
    }

    return {
      targets, concentrations: data.concentrations, programs: data.programs, degree: data.degree, crosslists: data.crosslists,
      defaultUnits, filterOptions, eligibleTargets, fills, isBoothCredit, evaluate, defaultState, validateState,
    };
  }

  return { SOURCES, STATUSES, normalizeNumber, unitsBySource, createEngine };
});
