import test from "node:test";
import assert from "node:assert/strict";
import { pickLogoFont, rootBudget } from "../dist/layout.js";

test("pickLogoFont: ambang 46/32", () => {
  assert.equal(pickLogoFont(80), "block");
  assert.equal(pickLogoFont(46), "block");
  assert.equal(pickLogoFont(45), "slick");
  assert.equal(pickLogoFont(32), "slick");
  assert.equal(pickLogoFont(31), "tiny");
  assert.equal(pickLogoFont(18), "tiny");
});

test("rootBudget: tangga tinggi width 80", () => {
  assert.deepEqual(rootBudget(80, 30), { font: "block", tagline: true, gaps: 1 });
  assert.deepEqual(rootBudget(80, 25), { font: "block", tagline: true, gaps: 1 });
  assert.deepEqual(rootBudget(80, 24), { font: "block", tagline: true, gaps: 0 });
  assert.deepEqual(rootBudget(80, 21), { font: "block", tagline: true, gaps: 0 });
  assert.deepEqual(rootBudget(80, 20), { font: "block", tagline: false, gaps: 0 });
  assert.deepEqual(rootBudget(80, 16), { font: "tiny", tagline: false, gaps: 0 });
  assert.deepEqual(rootBudget(80, 15), { font: null, tagline: false, gaps: 0 });
});

test("rootBudget: font ikut lebar", () => {
  assert.equal(rootBudget(45, 30).font, "slick");
  assert.equal(rootBudget(31, 30).font, "tiny");
  assert.deepEqual(rootBudget(40, 26), { font: "slick", tagline: true, gaps: 1 });
});

test("rootBudget: 4 box selalu dirender (tidak pernah negatif)", () => {
  for (const h of [10, 14, 15, 16, 20, 21, 24, 25, 40]) {
    for (const w of [20, 31, 32, 45, 46, 80]) {
      const b = rootBudget(w, h);
      assert.ok(b.font === null || b.font === "tiny" || b.font === "slick" || b.font === "block", `w=${w} h=${h}`);
      assert.ok(b.gaps === 0 || b.gaps === 1);
    }
  }
});
