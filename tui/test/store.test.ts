import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CNCLI_TUI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cncli-tui-test-"));

const Store = await import("../dist/store.js");

const tx = (id: number, opts: Record<string, unknown> = {}) => ({
  server_id: id,
  no_transaksi: "T" + id,
  no_urut: String(id),
  total: 1000,
  tunai: 1000,
  nontunai: 0,
  bank: "",
  kategori: "Tunai",
  created_at: "2026-07-10T08:0" + id + ":00",
  ...opts,
});

test("store roundtrip: sesi, upsert tx dedupe, patchTx, fills, hapus", async () => {
  const s = await Store.createSession([{ id: "c1", name: "kasir 1", base: "http://127.0.0.1:8765" }]);
  assert.ok(s.id.startsWith("s_"));

  const up1 = await Store.upsertTx(s.id, "c1", [tx(1), tx(2)]);
  assert.equal(up1.added, 2);
  const up2 = await Store.upsertTx(s.id, "c1", [tx(2), tx(3)]);
  assert.equal(up2.added, 1);

  const fill = await Store.upsertFill(s.id, "c1", "2026-07-10", 4, 500, 0);
  assert.ok(fill);
  const up3 = await Store.upsertTx(s.id, "c1", [tx(4, { no_urut: "4" })]);
  assert.equal(up3.added, 0);

  const patched = await Store.patchTx(s.id, Store.tid("c1", 1), 700, 300);
  assert.ok(patched);
  assert.equal(patched.total, 1000);
  assert.equal(patched.kategori, "Split");
  assert.equal(patched.edited, 1);

  const rows = await Store.listTx(s.id);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].server_id, 3);

  const fills = await Store.getFills(s.id);
  assert.equal(Object.keys(fills).length, 1);

  assert.equal(await Store.deleteSession(s.id), false);
  await Store.closeSession(s.id, true);
  assert.equal(await Store.deleteSession(s.id), true);
  assert.equal((await Store.listSessions(10)).length, 0);
  assert.equal((await Store.listTx(s.id)).length, 0);
});

test("creds roundtrip", () => {
  Store.saveCreds("a@b.c", "rahasia");
  const c = Store.loadCreds();
  assert.equal(c?.email, "a@b.c");
  assert.equal(c?.password, "rahasia");
  Store.clearCreds();
  assert.equal(Store.loadCreds(), null);
});
