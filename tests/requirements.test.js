// Unit tests for src/requirements.js against the real data/booth_requirements.json.
// Run: node --test tests/requirements.test.js (tests/test_requirements.py runs this from pytest).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeNumber, createEngine } = require("../src/requirements.js");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "booth_requirements.json"), "utf8"));
const engine = createEngine(DATA);

/** Builds 100-unit courses from numbers. source: "other", "scheduled" or "contemplated". */
function courses(nums, source = "other") {
  return nums.map((n, i) => ({ uid: `${source}-${i}-${n}`, num: normalizeNumber(n), units: 100, source }));
}
const row = (r, id) => r.rows.find(x => x.id === id);
const conc = (r, id) => r.concentrations.find(c => c.id === id);
const comp = (c, id) => c.components.find(k => k.id === id);
const nums = list => list.map(c => c.num).sort();

test("normalizeNumber accepts bare, prefixed and sectioned numbers", () => {
  assert.equal(normalizeNumber("35100"), "35100");
  assert.equal(normalizeNumber(" busn 35100-01 "), "35100");
  assert.equal(normalizeNumber("ECON 30100"), "ECON 30100");
  assert.equal(normalizeNumber("laws48230"), "LAWS 48230");
  assert.equal(normalizeNumber("3510"), null);
  assert.equal(normalizeNumber("Finance"), null);
});

test("a course that fits two FLMBE rows goes to the row that maximizes coverage", () => {
  // 38120 fits Decisions (basic) and, by petition, People. 30005 fits only Decisions.
  // 38120 is placed first, so a greedy assignment would put it in Decisions and leave 30005 unused.
  const overrides = [{ num: "38120", kind: "add", target: "flmbe:people" }];
  const r = engine.evaluate({ program: "mba", courses: courses(["38120", "30005"]), overrides });
  assert.equal(row(r, "people").course.num, "38120");
  assert.equal(row(r, "people").override, true);
  assert.equal(row(r, "decisions").course.num, "30005");
  assert.equal(r.flmbe.filled, 2);
});

test("seven of eight FLMBE rows completes FLMBE; Foundations needs all three", () => {
  const r = engine.evaluate({ program: "mba", courses: courses(["35000", "37000", "40000", "42001", "30005", "38001", "33050", "30000", "33001"]) });
  assert.equal(r.flmbe.filled, 7);
  assert.equal(r.flmbe.choose, 7);
  assert.equal(r.flmbe.total, 8);
  assert.equal(row(r, "society").course, null);
  assert.equal(r.foundations.filled, 2);
  assert.equal(r.foundations.choose, 3);
  // Rows used one course each; nothing is left for electives.
  assert.equal(r.electives.units, 0);
  assert.equal(r.total.units, 900);
  assert.equal(r.total.target, 2000);
});

test("an eighth FLMBE line is extra: its weakest course counts as an elective", () => {
  const list = [...courses(["35000", "37000", "40000", "42001", "30005", "38001", "33050"]), ...courses(["33305"], "contemplated")];
  const r = engine.evaluate({ program: "mba", courses: list });
  assert.equal(r.flmbe.filled, 8);
  assert.equal(row(r, "society").surplus, true);
  assert.equal(r.rows.filter(x => x.surplus).length, 1);
  assert.equal(r.electives.units, 100);
  assert.deepEqual(r.electives.bySource, { other: 0, scheduled: 0, contemplated: 100 });
  assert.deepEqual(r.rowUnits, { other: 700, scheduled: 0, contemplated: 0 });
});

test("degree rows prefer completed courses over Winter what-ifs", () => {
  const list = [...courses(["35000"], "contemplated"), ...courses(["35200"], "scheduled"), ...courses(["35001"], "other")];
  const r = engine.evaluate({ program: "jdmba", courses: list });
  assert.equal(row(r, "finance").course.num, "35001");
  assert.equal(r.electives.units, 200);
  assert.deepEqual(r.electives.bySource, { other: 0, scheduled: 100, contemplated: 100 });
  assert.equal(r.total.target, 1600);
});

test("Finance fills asset pricing, corporate and additional components", () => {
  // 35100 fits asset pricing and additional; it is listed first but must move to additional for 35000.
  const r = engine.evaluate({ program: "mba", courses: courses(["35100", "35000", "35200", "35210"]), tracked: ["finance"] });
  const f = conc(r, "finance");
  assert.deepEqual(nums(comp(f, "asset_pricing").courses), ["35000"]);
  assert.deepEqual(nums(comp(f, "corporate").courses), ["35200"]);
  assert.deepEqual(nums(comp(f, "additional").courses), ["35100", "35210"]);
  assert.equal(f.total, 400);
  assert.equal(f.done, true);

  const missing = conc(engine.evaluate({ program: "mba", courses: courses(["35100", "35000", "35120"]), tracked: ["finance"] }), "finance");
  assert.equal(comp(missing, "corporate").done, false);
  assert.equal(missing.done, false);
});

test("Analytic Finance is blocked until Finance is complete", () => {
  // Six Analytic Finance courses, none of them corporate finance, so Finance is incomplete.
  const six = ["34901", "34902", "35100", "35120", "35121", "35126"];
  const blocked = conc(engine.evaluate({ program: "mba", courses: courses(six), tracked: ["analytic_finance"] }), "analytic_finance");
  assert.equal(blocked.total, 600);
  assert.deepEqual(blocked.blockedBy, ["finance"]);
  assert.equal(blocked.done, false);

  const r = engine.evaluate({ program: "mba", courses: courses([...six, "35200"]), tracked: ["analytic_finance"] });
  assert.deepEqual(conc(r, "analytic_finance").blockedBy, []);
  assert.equal(conc(r, "analytic_finance").done, true);
  // Finance was evaluated to decide this but is not reported unless tracked.
  assert.equal(conc(r, "finance"), undefined);
});

test("Applied AI and Business Analytics share at most 100 units", () => {
  // All four count toward both Applied AI and Business Analytics electives.
  const shared = ["32200", "43100", "32810", "35137"];
  const r = engine.evaluate({ program: "mba", courses: courses(shared), tracked: ["applied_ai", "business_analytics"] });
  const ai = conc(r, "applied_ai"), ba = conc(r, "business_analytics");
  const both = ai.courses.filter(c => ba.courses.some(d => d.uid === c.uid));
  assert.ok(both.reduce((s, c) => s + c.units, 0) <= 100);
  assert.equal(ai.caps[0].with, "business_analytics");
  assert.equal(ai.caps[0].max, 100);
  // Four courses plus one shared course: 500 units of progress between the two.
  assert.equal(ai.total + comp(ba, "electives").units, 500);

  // Tracked alone, Applied AI uses all it can.
  const alone = conc(engine.evaluate({ program: "mba", courses: courses(shared), tracked: ["applied_ai"] }), "applied_ai");
  assert.equal(alone.total, 300);
  assert.deepEqual(alone.caps, []);
});

test("overrides add and remove eligibility and are flagged", () => {
  const removed = engine.evaluate({ program: "mba", courses: courses(["35000"]), overrides: [{ num: "35000", kind: "remove", target: "flmbe:finance" }] });
  assert.equal(row(removed, "finance").course, null);
  assert.equal(removed.electives.units, 100);

  const added = engine.evaluate({ program: "mba", courses: courses(["ECON 30300"]), overrides: [{ num: "ECON 30300", kind: "add", target: "flmbe:economy" }] });
  assert.equal(row(added, "economy").course.num, "ECON 30300");
  assert.equal(row(added, "economy").override, true);
  assert.equal(added.usage.get(added.rows.find(x => x.id === "economy").course.uid)[0].override, true);
  assert.ok(engine.eligibleTargets("ECON 30300", [{ num: "ECON 30300", kind: "add", target: "flmbe:economy" }]).some(t => t.id === "flmbe:economy" && t.override));
});

test("LAWS 48230 counts as BUSN 38120", () => {
  const r = engine.evaluate({ program: "jdmba", courses: courses(["LAWS 48230"], "scheduled"), tracked: ["behavioral_science"] });
  assert.equal(row(r, "decisions").course.num, "LAWS 48230");
  assert.equal(row(r, "decisions").via, "38120");
  assert.deepEqual(nums(conc(r, "behavioral_science").courses), ["LAWS 48230"]);
  assert.equal(engine.isBoothCredit("LAWS 48230", []), true);
  assert.equal(engine.isBoothCredit("LAWS 43225", []), true);
  assert.equal(engine.isBoothCredit("LAWS 40101", []), false);
  assert.ok(engine.fills("LAWS 48230", [], "conc:behavioral_science"));
});

test("General Management needs all eight FLMBE rows plus 300 units", () => {
  const eight = ["35000", "37000", "40000", "42001", "30005", "38001", "33050", "33305"];
  const r = engine.evaluate({ program: "mba", courses: courses([...eight, "42108", "42119", "38101"]), tracked: ["general_management"] });
  const gm = conc(r, "general_management");
  assert.equal(comp(gm, "flmbe_all").rowsFilled, 8);
  assert.equal(comp(gm, "extra").units, 300);
  assert.equal(gm.done, true);
  const seven = conc(engine.evaluate({ program: "mba", courses: courses([...eight.slice(1), "42108", "42119", "38101"]), tracked: ["general_management"] }), "general_management");
  assert.equal(comp(seven, "flmbe_all").done, false);
  assert.equal(seven.done, false);
});

test("International Business needs 33501 or 33502", () => {
  const without = conc(engine.evaluate({ program: "mba", courses: courses(["33503", "33520", "35210"]), tracked: ["international_business"] }), "international_business");
  assert.equal(without.total, 300);
  assert.equal(without.done, false);
  assert.match(without.ruleMessages[0], /33501, 33502/);
  const withIt = conc(engine.evaluate({ program: "mba", courses: courses(["33502", "33520", "35210"]), tracked: ["international_business"] }), "international_business");
  assert.equal(withIt.done, true);
});

test("validateState cleans good state and names the first bad field", () => {
  const good = engine.validateState({ program: "jdmba", lead: true, other: [{ id: "a", num: "busn 35100", title: "Investments", quarter: "Autumn 2026", status: "completed", units: 100 }],
    overrides: [{ num: "38120", kind: "add", target: "flmbe:people" }], tracked: ["finance", "finance"] });
  assert.equal(good.ok, true);
  assert.equal(good.value.other[0].num, "35100");
  assert.deepEqual(good.value.tracked, ["finance"]);
  assert.equal(engine.validateState([]).ok, false);
  assert.match(engine.validateState({ other: [{ num: "35100", status: "completed", units: "100" }] }).error, /other\[0\]\.units/);
  assert.match(engine.validateState({ overrides: [{ num: "35100", kind: "add", target: "flmbe:nope" }] }).error, /overrides\[0\]\.target/);
  assert.match(engine.validateState({ tracked: ["astrology"] }).error, /tracked\[0\]/);
  assert.match(engine.validateState({ program: "phd" }).error, /program/);
});
