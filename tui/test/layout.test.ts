import test from "node:test";
import assert from "node:assert/strict";
import { alignLR, clip, formatRow, kpiCols, planColumns, type ColSpec } from "../dist/layout.js";

test("clip: ellipsis dan tidak pernah melebihi w", () => {
  assert.equal(clip("hello world", 5), "he...");
  assert.equal(clip("hello", 5), "hello");
  assert.equal(clip("abc", 2), "..");
  assert.equal(clip("abc", 0), "");
  assert.equal(clip("abc", -3), "");
  for (let w = 0; w <= 40; w++) {
    for (let len = 0; len <= 40; len++) {
      const got = clip("x".repeat(len), w);
      assert.ok(got.length <= w, `w=${w} len=${len} got=${got.length}`);
    }
  }
});

test("alignLR: kanan menempel di tepi", () => {
  const s = alignLR("T00012", "Rp45.000", 20);
  assert.equal(s.length, 20);
  assert.ok(s.endsWith("Rp45.000"), s);
  assert.ok(s.startsWith("T00012"), s);
  assert.equal(alignLR("abcdef", "XY", 4).length, 4);
});

const txCols: ColSpec[] = [
  { key: "sel", min: 1 },
  { key: "no", min: 8, text: "T0001234" },
  { key: "total", min: 10, align: "right", text: "Rp45.000" },
  { key: "t", min: 8, align: "right", text: "T 45.000" },
  { key: "nt", min: 8, align: "right", text: "NT 0" },
  { key: "payer", min: 6, flex: 1, text: "Budi Santoso" },
  { key: "kat", min: 6, text: "Makanan" },
];

test("planColumns: jumlah tepat per lebar 40/50/60/80", () => {
  for (const width of [40, 50, 60, 80]) {
    const budget = width - (txCols.length - 1);
    const widths = planColumns(budget, txCols);
    assert.ok(widths.every((w) => w >= 0), String(widths));
    assert.equal(widths.reduce((a, b) => a + b, 0), budget, `width=${width} ${widths}`);
  }
  for (const width of [40, 50, 60, 80]) {
    const line = formatRow(width, txCols);
    assert.equal(line.length, width, `width=${width} len=${line.length}: ${JSON.stringify(line)}`);
  }
});

test("formatRow: tidak ada baris melebihi lebar (kombinasi kolom lain)", () => {
  const rows: ColSpec[][] = [
    [{ key: "a", min: 20, flex: 1, text: "no. T0001234 — pelanggan tanpa nama yang sangat panjang" }],
    [
      { key: "a", min: 12, text: "session 2026-10-18" },
      { key: "b", min: 12, align: "right", text: "Rp1.234.567" },
    ],
    [
      { key: "a", min: 10, text: "meta" },
      { key: "b", min: 10, text: "cashier: Budi Santoso" },
      { key: "c", min: 10, text: "branch: Cabang Pusat Jakarta" },
    ],
  ];
  for (const width of [40, 50, 60, 80]) {
    for (const specs of rows) {
      const line = formatRow(width, specs);
      assert.ok(line.length <= width, `width=${width} len=${line.length}`);
    }
  }
  const right = formatRow(20, [
    { key: "a", min: 1, flex: 1, text: "total" },
    { key: "b", min: 8, align: "right", text: "Rp1.000" },
  ]);
  assert.equal(right.length, 20);
  assert.ok(right.endsWith("Rp1.000"), right);
});

test("kpiCols: 3+2 di sempit, satu baris di lebar", () => {
  assert.equal(kpiCols(40), 3);
  assert.equal(kpiCols(60), 3);
  assert.equal(kpiCols(71), 3);
  assert.equal(kpiCols(72), 5);
  assert.equal(kpiCols(80), 5);
});
