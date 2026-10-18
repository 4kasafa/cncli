import test from "node:test";
import assert from "node:assert/strict";
import { buildItems } from "../dist/txmerge.js";

const row = (id: number, no_urut: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  server_id: id,
  no_transaksi: "T" + id,
  no_urut,
  total: 1000,
  tunai: 1000,
  nontunai: 0,
  bank: "",
  kategori: "Tunai",
  created_at,
  pc_id: "c1",
  pc_name: "kasir 1",
  ...extra,
});

test("gap chain: baris HILANG + fill manual duduk tepat di bawah tx penggantinya", () => {
  const rows = [
    row(1, "1", "2026-07-10T08:00:00"),
    row(2, "2", "2026-07-10T08:05:00"),
    row(3, "5", "2026-07-10T08:20:00"),
  ];
  const fills = {
    "c1|2026-07-10|3": {
      day: "2026-07-10",
      n: 3,
      tunai: 500,
      nontunai: 0,
      total: 500,
      kategori: "Tunai",
      edited: 1,
      manual: 1,
      filled_at: "2026-07-10T08:10:00",
    },
  };
  const items = buildItems(rows as never[], fills as never);
  const hilang = items.filter((i) => i.t === "hilang");
  assert.equal(hilang.length, 1);
  assert.equal(hilang[0].t === "hilang" ? hilang[0].n : 0, 4);
  const fillTx = items.filter((i) => i.t === "tx" && (i as { fill?: string }).fill);
  assert.equal(fillTx.length, 1);
  assert.equal(fillTx[0].t === "tx" ? fillTx[0].r.total : 0, 500);
  const seqs = items.slice(0, 4).map((i) => i.seq);
  assert.deepEqual(seqs, [5, 4, 3, 2]);
});

test("rantai gap dihitung per PC, duplikat no_urut tidak dihitung ulang", () => {
  const rows = [
    row(1, "1", "2026-07-10T08:00:00", { pc_id: "a", pc_name: "A" }),
    row(1, "1", "2026-07-10T08:00:00", { pc_id: "b", pc_name: "B" }),
    row(2, "3", "2026-07-10T08:10:00", { pc_id: "a", pc_name: "A" }),
    row(2, "2", "2026-07-10T08:12:00", { pc_id: "b", pc_name: "B" }),
  ];
  const items = buildItems(rows as never[], {});
  const hilangA = items.filter((i) => i.t === "hilang" && i.pc_id === "a");
  const hilangB = items.filter((i) => i.t === "hilang" && i.pc_id === "b");
  assert.equal(hilangA.length, 1);
  assert.equal(hilangA[0].t === "hilang" ? hilangA[0].n : 0, 2);
  assert.equal(hilangB.length, 0);
});
