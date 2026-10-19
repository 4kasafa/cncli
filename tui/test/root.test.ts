import test from "node:test";
import assert from "node:assert/strict";
import { capLines, pickLogoFont, rootBudget } from "../dist/layout.js";
import { baseHost, contentRows, pickLastRow, rootLines, type RootData } from "../dist/rootinfo.js";

test("pickLogoFont: ambang 46/32", () => {
  assert.equal(pickLogoFont(80), "block");
  assert.equal(pickLogoFont(46), "block");
  assert.equal(pickLogoFont(45), "slick");
  assert.equal(pickLogoFont(32), "slick");
  assert.equal(pickLogoFont(31), "tiny");
  assert.equal(pickLogoFont(18), "tiny");
});

test("rootBudget: tangga tinggi width 80, contentRows 13 (penuh terburuk)", () => {
  assert.deepEqual(rootBudget(80, 39, 13), { font: "block", tagline: true, gaps: 1, compact: false });
  assert.deepEqual(rootBudget(80, 35, 13), { font: "block", tagline: true, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 34, 13), { font: "block", tagline: false, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 33, 13), { font: "block", tagline: false, gaps: 0, compact: true });
  assert.deepEqual(rootBudget(80, 25, 13), { font: "block", tagline: false, gaps: 0, compact: true });
  assert.deepEqual(rootBudget(80, 24, 13), { font: "tiny", tagline: false, gaps: 0, compact: true });
  assert.deepEqual(rootBudget(80, 21, 13), { font: "tiny", tagline: false, gaps: 0, compact: true });
  assert.deepEqual(rootBudget(80, 20, 13), { font: null, tagline: false, gaps: 0, compact: true });
  assert.deepEqual(rootBudget(80, 18, 13), { font: null, tagline: false, gaps: 0, compact: true });
});

test("rootBudget: contentRows 4 tidak pernah compact", () => {
  assert.deepEqual(rootBudget(80, 30, 4), { font: "block", tagline: true, gaps: 1, compact: false });
  assert.deepEqual(rootBudget(80, 26, 4), { font: "block", tagline: true, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 25, 4), { font: "block", tagline: false, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 24, 4), { font: "tiny", tagline: false, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 21, 4), { font: "tiny", tagline: false, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 20, 4), { font: null, tagline: false, gaps: 0, compact: false });
  assert.deepEqual(rootBudget(80, 18, 4), { font: null, tagline: false, gaps: 0, compact: false });
});

test("rootBudget: font ikut lebar", () => {
  assert.equal(rootBudget(45, 39, 13).font, "slick");
  assert.equal(rootBudget(31, 39, 13).font, "tiny");
  assert.deepEqual(rootBudget(40, 39, 13), { font: "slick", tagline: true, gaps: 1, compact: false });
});

test("rootBudget: kombinasi acak tidak pernah crash dan flag valid", () => {
  for (const h of [10, 14, 18, 25, 33, 39, 50]) {
    for (const w of [20, 31, 32, 45, 46, 80]) {
      for (const cr of [4, 12, 13]) {
        const b = rootBudget(w, h, cr);
        assert.ok(b.font === null || b.font === "tiny" || b.font === "slick" || b.font === "block", `w=${w} h=${h}`);
        assert.ok(b.gaps === 0 || b.gaps === 1);
        assert.equal(typeof b.compact, "boolean");
      }
    }
  }
});

test("capLines: maks + '+N lagi'", () => {
  assert.deepEqual(capLines(["a", "b", "c", "d"], 4), ["a", "b", "c", "d"]);
  assert.deepEqual(capLines(["a", "b", "c", "d", "e", "f"], 4), ["a", "b", "c", "d", "+2 lagi"]);
  assert.deepEqual(capLines([], 4), []);
  assert.deepEqual(capLines(["a"], 0), []);
});

test("baseHost: host:port dari base, fallback mentah", () => {
  assert.equal(baseHost("http://10.0.0.2:8080"), "10.0.0.2:8080");
  assert.equal(baseHost("10.0.0.2:8080"), "10.0.0.2:8080");
});

test("pickLastRow: tanggal terbaru menang, tanggal invalid diabaikan", () => {
  const rows = [
    { tanggal: "2026-10-01", shift: "1" },
    { tanggal: "18/10/2026", shift: "2" },
    { tanggal: "3 maret 2026", shift: "1" },
    { tanggal: null },
    { tanggal: "bukan tanggal" },
  ];
  assert.equal(pickLastRow(rows)?.shift, "2");
  assert.equal(pickLastRow([]), null);
  assert.equal(pickLastRow(null), null);
  assert.equal(pickLastRow([{ tanggal: "??" }]), null);
});

const base: RootData = { session: null, print: null, paired: 0, report: null, sync: null };

test("rootLines: live 2 PC, print, pcs, reports", () => {
  const d: RootData = {
    ...base,
    session: {
      pcs: [
        { name: "kasir1", base: "http://10.0.0.2:8080", alive: 1 },
        { name: "kasir2", base: "http://10.0.0.3:8080", alive: 0 },
      ],
      tx: 12,
      total: 1240000,
      last: { no: "T00012", total: 45000, time: "14:32" },
    },
    paired: 2,
    report: { tanggal: "18/10/2026", totalKomputer: 1240000, uangFisik: 1190000, jumlahSelisih: -50000, statusSelisih: "KURANG" },
    sync: "18/10/2026 14:20:33",
  };
  const v = rootLines(d);
  assert.deepEqual(v.lines.live, ["[open] 2 pc · 1 open 1 close", "12 tx · total Rp 1.240.000", "T00012 Rp 45.000 · 14:32"]);
  assert.deepEqual(v.lines.pcs, ["2 paired · 2 aktif", "kasir1 10.0.0.2:8080", "kasir2 10.0.0.3:8080"]);
  assert.deepEqual(v.lines.print, ["no meta"]);
  assert.deepEqual(v.lines.reports, ["18/10/2026 · short Rp 50.000", "K: Rp 1.240.000 · F: Rp 1.190.000", "18/10/2026 14:20"]);
  assert.equal(contentRows(v), 3 + 1 + 3 + 3);
});

test("rootLines: live 1 PC tanpa breakdown, tanpa tx", () => {
  const v = rootLines({
    ...base,
    session: { pcs: [{ name: "kasir1", base: "http://10.0.0.2:8080", alive: 1 }], tx: 0, total: 0, last: null },
    paired: 1,
  });
  assert.equal(v.lines.live[0], "[open] 1 pc");
  assert.equal(v.lines.live[2], "-");
  assert.deepEqual(v.lines.live, ["[open] 1 pc", "0 tx · total Rp 0", "-"]);
});

test("rootLines: empty states", () => {
  const v = rootLines(base);
  assert.deepEqual(v.lines.live, ["[close] no session"]);
  assert.deepEqual(v.lines.pcs, ["none paired"]);
  assert.deepEqual(v.lines.reports, ["no data"]);
  assert.deepEqual(v.lines.print, ["no meta"]);
});

test("rootLines: print 2 baris, field kosong jadi '-'", () => {
  const full = rootLines({ ...base, print: { kasir: "Budi", kasir_id: "k-01", shift: "1", cabang: "A" } });
  assert.deepEqual(full.lines.print, ["Budi · k-01", "A · 1"]);
  const partial = rootLines({ ...base, print: { kasir: "Budi" } });
  assert.deepEqual(partial.lines.print, ["Budi · -", "- · -"]);
});

test("rootLines: reports over/even, sync null, tanggal zero-pad", () => {
  const over = rootLines({
    ...base,
    report: { tanggal: "18/10/2026", totalKomputer: 100, uangFisik: 50, jumlahSelisih: 50000, statusSelisih: "" },
  });
  assert.equal(over.lines.reports[0], "18/10/2026 · over Rp 50.000");
  assert.equal(over.lines.reports[2], "-");

  const even = rootLines({
    ...base,
    report: { tanggal: "2/10/2026", totalKomputer: 100, uangFisik: 100, jumlahSelisih: 0, statusSelisih: "" },
  });
  assert.equal(even.lines.reports[0], "02/10/2026 · even");
  assert.deepEqual(even.lines.reports, ["02/10/2026 · even", "K: Rp 100 · F: Rp 100", "-"]);
});
