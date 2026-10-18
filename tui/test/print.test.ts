import test from "node:test";
import assert from "node:assert/strict";
import { DENOMS, buildPayload, fisikTotal, generateReceipt, normShift, validateForSend, width } from "../dist/print.js";

const meta = { kasir: "Budi", kasir_id: "K1", cabang: "Cabang A", shift: "Pagi" };

test("fisikTotal & DENOMS", () => {
  assert.equal(DENOMS.length, 11);
  assert.equal(fisikTotal({ 100000: 3, 500: 2 }), 301000);
  assert.equal(fisikTotal({}), 0);
});

test("struk 58mm dan 80mm: semua baris selebar kertas", () => {
  const qty = { 100000: 2, 50000: 1, 1000: 3 };
  const w58 = width("58");
  const r58 = generateReceipt(w58, qty, { ...meta, noncash: 2000, expense: 1500, note: "refund" });
  for (const ln of r58.split("\n")) assert.equal(ln.length, w58, JSON.stringify(ln));
  assert.ok(r58.includes("TOTAL FISIK"));
  assert.ok(r58.includes("Rp 253.000"));
  const w80 = width("80");
  const r80 = generateReceipt(w80, qty, { ...meta, noncash: 0, expense: 0, note: "" });
  for (const ln of r80.split("\n")) assert.equal(ln.length, w80, JSON.stringify(ln));
});

test("validasi kirim", () => {
  assert.equal(validateForSend({ kasir: "", kasir_id: "K1" }, { 1000: 1 }), "pilih/isi kasir dulu.");
  assert.equal(validateForSend({ kasir: "Budi", kasir_id: "" }, { 1000: 1 }), "isi id kasir dulu.");
  assert.equal(validateForSend({ kasir: "Budi", kasir_id: "K1" }, {}), "total fisik nol, isi denominasi dulu.");
  assert.equal(validateForSend({ kasir: "Budi", kasir_id: "K1" }, { 1000: 1 }), null);
});

test("buildPayload: hanya denom terisi, user_id fallback", () => {
  const p = buildPayload({ ...meta, size: "58", kasir_id: "" }, { 100000: 2, 100: 0 }, 1000, "note", 500);
  assert.deepEqual(p.qty, { "100000": 2 });
  assert.equal(p.user_id, "-");
  assert.equal(p.expense_amount, 1000);
  assert.equal(p.nontunai_amount, 500);
  assert.equal(p.size, "58");
});

test("normShift", () => {
  assert.equal(normShift("pagi"), "Pagi");
  assert.equal(normShift("SHIFT MALAM"), "Malam");
  assert.equal(normShift("sore"), "");
});
