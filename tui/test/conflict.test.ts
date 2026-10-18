import test from "node:test";
import assert from "node:assert/strict";
import { countConflicts, mergeGasData, parseDate, periodeOf, resolve, txKey } from "../dist/conflict.js";

test("periodeOf: batas 28-27", () => {
  assert.equal(periodeOf("2026-07-27"), "2026-07");
  assert.equal(periodeOf("2026-07-28"), "2026-08");
  assert.equal(periodeOf("27/07/2026"), "2026-07");
  assert.equal(periodeOf("28 juli 2026"), "2026-08");
  assert.equal(periodeOf("2026-12-31"), "2027-01");
  assert.equal(periodeOf("bukan tanggal"), null);
});

test("parseDate: berbagai format", () => {
  assert.equal(parseDate("2026-07-05")?.getTime(), new Date(2026, 6, 5).getTime());
  assert.equal(parseDate("05/07/2026")?.getTime(), new Date(2026, 6, 5).getTime());
  assert.equal(parseDate("5 juli 2026")?.getTime(), new Date(2026, 6, 5).getTime());
  assert.equal(parseDate(""), null);
});

test("mergeGasData lalu resolve: konflik, dismiss, dan muncul lagi bila GAS berubah", () => {
  const cache = [{ tanggal: "2026-07-10", shift: "Pagi", cabang: "A", totalKomputer: 100, uangFisik: 100, jumlahSelisih: 0 }];
  const gas = { tanggal: "2026-07-10", shift: "Pagi", cabang: "A", totalKomputer: 100, uangFisik: 100, jumlahSelisih: 5 };
  const key = txKey(gas);
  const r1 = mergeGasData(cache as never[], [gas] as never[]);
  assert.equal(r1.n_new, 0);
  assert.equal(r1.n_conflict, 1);
  assert.equal(countConflicts(cache as never[]), 1);
  const item = resolve(cache as never[], key, false) as { _conflict?: unknown; _dismissed_gas?: unknown };
  assert.ok(item);
  assert.equal(item._conflict, undefined);
  assert.ok(item._dismissed_gas);
  const r2 = mergeGasData(cache as never[], [gas] as never[]);
  assert.equal(r2.n_conflict, 0);
  const gas2 = { ...gas, jumlahSelisih: 7 };
  const r3 = mergeGasData(cache as never[], [gas2] as never[]);
  assert.equal(r3.n_conflict, 1);
});

test("resolve pakai gas mengganti item lokal", () => {
  const cache = [{ tanggal: "2026-07-11", shift: "Malam", cabang: "B", totalKomputer: 1, uangFisik: 2, jumlahSelisih: -1, _conflict: { lokal: { totalKomputer: 1, uangFisik: 2, jumlahSelisih: -1 }, gas: { totalKomputer: 3, uangFisik: 3, jumlahSelisih: 0 }, gas_item: { tanggal: "2026-07-11", shift: "Malam", cabang: "B", totalKomputer: 3, uangFisik: 3, jumlahSelisih: 0 } } }];
  const item = resolve(cache as never[], txKey(cache[0]), true) as { totalKomputer: number; _conflict?: unknown };
  assert.equal(item.totalKomputer, 3);
  assert.equal(item._conflict, undefined);
});
