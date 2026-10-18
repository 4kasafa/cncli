import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GasItem } from "./conflict.js";

export interface Pc {
  comp_id: string;
  name: string;
  base: string;
  last_seen: number;
  complete: number;
  alive: number;
}

export interface Session {
  id: string;
  pcs: Pc[];
  started_at: string;
  closed_at: string | null;
  status: "open" | "closed";
  complete: number;
  count: number;
}

export interface TxRow {
  server_id: number;
  no_transaksi: string;
  no_urut: string;
  total: number;
  tunai: number;
  nontunai: number;
  bank: string;
  kategori: string;
  created_at: string;
  tid?: string;
  pc_id?: string;
  pc_name?: string;
  edited?: number;
  manual?: number;
  day?: string;
  n?: number;
}

export interface Fill {
  day: string;
  n: number;
  tunai: number;
  nontunai: number;
  total: number;
  kategori: string;
  edited: number;
  manual: number;
  filled_at: string;
  pc_id?: string;
  pc_name?: string;
  tid?: string;
}

export interface Cred {
  email: string;
  password: string;
}

export interface ArchiveBucket {
  cashier: string;
  last_sync: string | null;
  data: GasItem[];
}

export interface PrintMeta {
  kasir: string;
  kasir_id: string;
  cabang: string;
  shift: string;
  size: "58" | "80";
  qty: Record<string, number>;
  expense: number;
  note: string;
  fold?: number;
}

function baseDir(): string {
  return process.env.CNCLI_TUI_DIR || path.join(os.homedir(), ".cncli", "tui");
}

function filePath(name: string): string {
  return path.join(baseDir(), name);
}

function readJson<T>(name: string, fb: T): T {
  try {
    const v = JSON.parse(fs.readFileSync(filePath(name), "utf8"));
    return v == null ? fb : (v as T);
  } catch {
    return fb;
  }
}

function writeJson(name: string, v: unknown): void {
  try {
    fs.mkdirSync(baseDir(), { recursive: true });
    const p = filePath(name);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(v));
    fs.renameSync(tmp, p);
  } catch {
    /* ponytail: gagal tulis = state lama tetap; tanpa retry queue */
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function toInt(v: unknown): number {
  const n = parseInt(String(v == null ? "" : v), 10);
  return isNaN(n) ? 0 : n;
}

export function tid(compId: string, sid: unknown): string {
  return String(compId) + ":" + toInt(sid);
}

export function splitTid(t: unknown): { comp_id: string; sid: string } {
  const s = String(t == null ? "" : t);
  const i = s.lastIndexOf(":");
  return i < 0 ? { comp_id: "", sid: s } : { comp_id: s.slice(0, i), sid: s.slice(i + 1) };
}

export function fillKey(compId: string, day: string, n: number | string): string {
  return compId + "|" + day + "|" + n;
}

function bKey(sessionId: string, compId: string): string {
  return sessionId + "|" + compId;
}

export const CAP_PER_PC = 500;

function sessions(): Session[] {
  const a = readJson<Session[]>("sessions.json", []);
  return Array.isArray(a) ? a : [];
}

function saveSessions(a: Session[]): void {
  writeJson("sessions.json", a);
}

function txAll(): Record<string, TxRow[]> {
  const v = readJson<Record<string, TxRow[]>>("tx.json", {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function fillsAll(): Record<string, Record<string, Fill>> {
  const v = readJson<Record<string, Record<string, Fill>>>("fills.json", {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export async function createSession(comps: { id?: string; name?: string; base?: string }[]): Promise<Session> {
  const pcs: Pc[] = [];
  const seen: Record<string, boolean> = {};
  for (const c of comps || []) {
    if (!c || !c.id || !c.base || seen[c.id]) continue;
    seen[c.id] = true;
    pcs.push({ comp_id: c.id, name: c.name || c.id, base: c.base, last_seen: 0, complete: 1, alive: 1 });
  }
  const a = sessions();
  const s: Session = {
    id: "s_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    pcs,
    started_at: nowIso(),
    closed_at: null,
    status: "open",
    complete: 1,
    count: 0,
  };
  a.unshift(s);
  saveSessions(a.slice(0, 50));
  return s;
}

export async function getSession(id: string | null): Promise<Session | null> {
  if (!id) return null;
  for (const s of sessions()) if (s.id === id) return s;
  return null;
}

export async function listSessions(limit?: number): Promise<Session[]> {
  return sessions().slice(0, limit || 20);
}

export async function patchSession(id: string, patch: Partial<Session>): Promise<Session | null> {
  const a = sessions();
  let hit: Session | null = null;
  for (const s of a) {
    if (s.id !== id) continue;
    Object.assign(s, patch);
    hit = s;
    break;
  }
  if (hit) saveSessions(a);
  return hit;
}

export async function closeSession(id: string, complete: boolean): Promise<Session | null> {
  return patchSession(id, { status: "closed", closed_at: nowIso(), complete: complete ? 1 : 0 });
}

export async function addPc(sessionId: string, comp: { id: string; name?: string; base: string }): Promise<Session | null> {
  const a = sessions();
  let hit: Session | null = null;
  for (const s of a) {
    if (s.id !== sessionId) continue;
    if (!s.pcs) s.pcs = [];
    if (s.pcs.some((p) => p.comp_id === comp.id)) return null;
    s.pcs.push({ comp_id: comp.id, name: comp.name || comp.id, base: comp.base, last_seen: 0, complete: 1, alive: 1 });
    hit = s;
    break;
  }
  if (hit) saveSessions(a);
  return hit;
}

export async function patchPc(sessionId: string, compId: string, patch: Partial<Pc>): Promise<Pc | null> {
  const a = sessions();
  let hit: Pc | null = null;
  for (const s of a) {
    if (s.id !== sessionId) continue;
    const pcs = s.pcs || [];
    for (const p of pcs) {
      if (p.comp_id !== compId) continue;
      Object.assign(p, patch);
      hit = p;
      break;
    }
    s.pcs = pcs;
    s.complete = pcs.every((p) => toInt(p.complete)) ? 1 : 0;
    break;
  }
  if (hit) saveSessions(a);
  return hit;
}

export async function deleteSession(id: string): Promise<boolean> {
  const a = sessions();
  const at = a.findIndex((s) => s.id === id);
  if (at < 0 || a[at].status === "open") return false;
  a.splice(at, 1);
  saveSessions(a);
  const t = txAll();
  const pre = id + "|";
  let changed = false;
  for (const k of Object.keys(t)) {
    if (k.startsWith(pre)) {
      delete t[k];
      changed = true;
    }
  }
  if (changed) writeJson("tx.json", t);
  const f = fillsAll();
  let ch2 = false;
  for (const k of Object.keys(f)) {
    if (k.startsWith(pre)) {
      delete f[k];
      ch2 = true;
    }
  }
  if (ch2) writeJson("fills.json", f);
  return true;
}

export async function getLastSeen(sessionId: string, compId: string): Promise<number> {
  for (const s of sessions()) {
    if (s.id !== sessionId) continue;
    for (const p of s.pcs || []) if (p.comp_id === compId) return toInt(p.last_seen);
    return 0;
  }
  return 0;
}

export async function upsertTx(sessionId: string, compId: string, rows: TxRow[]): Promise<{ added: number; lastSeen: number; ids: string[] }> {
  const all = txAll();
  const key = bKey(sessionId, compId);
  let cur = all[key] || [];
  const fillsHere = fillsAll()[key] || {};
  const seenId: Record<string, boolean> = {};
  const seenNo: Record<string, boolean> = {};
  for (const r of cur) {
    seenId[r.server_id] = true;
    if (r.no_transaksi) seenNo[r.no_transaksi] = true;
  }
  let added = 0;
  let maxId = 0;
  const ids: string[] = [];
  for (const r of cur) maxId = Math.max(maxId, toInt(r.server_id));
  const rowNumUrut = (r: TxRow) => {
    const n = parseInt(String(r.no_urut || ""), 10);
    return isNaN(n) || n <= 0 ? 0 : n;
  };
  const rowDay = (r: TxRow) => String(r.created_at || "").slice(0, 10) || "??";
  for (const r of rows || []) {
    const sid = toInt(r.server_id);
    if (sid > maxId) maxId = sid;
    if (seenId[sid]) continue;
    if (r.no_transaksi && seenNo[r.no_transaksi]) continue;
    if (rowNumUrut(r) && fillsHere[fillKey(compId, rowDay(r), rowNumUrut(r))]) continue;
    seenId[sid] = true;
    if (r.no_transaksi) seenNo[r.no_transaksi] = true;
    cur.push(r);
    added++;
    ids.push(tid(compId, sid));
  }
  cur.sort((a, b) => toInt(a.server_id) - toInt(b.server_id));
  if (cur.length > CAP_PER_PC) cur = cur.slice(cur.length - CAP_PER_PC);
  all[key] = cur;
  writeJson("tx.json", all);

  const sess = await getSession(sessionId);
  const lastSeen = maxId > 0 ? maxId : await getLastSeen(sessionId, compId);
  if (sess) {
    let count = 0;
    for (const k of Object.keys(all)) if (k.startsWith(sessionId + "|")) count += (all[k] || []).length;
    await patchSession(sessionId, { count });
  }
  await patchPc(sessionId, compId, { last_seen: lastSeen });
  return { added, lastSeen, ids };
}

export async function patchTx(sessionId: string, t: string, tunai: unknown, nontunai: unknown): Promise<TxRow | null> {
  const parts = splitTid(t);
  const all = txAll();
  const key = bKey(sessionId, parts.comp_id);
  const cur = all[key] || [];
  const tt = toInt(tunai);
  const nt = toInt(nontunai);
  if (tt < 0 || nt < 0) return null;
  for (const r of cur) {
    if (toInt(r.server_id) !== toInt(parts.sid)) continue;
    r.tunai = tt;
    r.nontunai = nt;
    r.total = tt + nt;
    r.kategori = tt > 0 && nt > 0 ? "Split" : tt > 0 ? "Tunai" : nt > 0 ? "Nontunai" : r.kategori || "";
    r.edited = 1;
    all[key] = cur;
    writeJson("tx.json", all);
    return r;
  }
  return null;
}

export async function listTx(sessionId: string): Promise<TxRow[]> {
  const sess = await getSession(sessionId);
  const all = txAll();
  const names: Record<string, string> = {};
  const out: TxRow[] = [];
  for (const p of sess?.pcs || []) names[p.comp_id] = p.name || p.comp_id;
  const pre = sessionId + "|";
  for (const k of Object.keys(all)) {
    if (!k.startsWith(pre)) continue;
    const cid = k.slice(pre.length);
    for (const r of all[k] || []) {
      r.tid = tid(cid, r.server_id);
      r.pc_id = cid;
      r.pc_name = names[cid] || cid;
      out.push(r);
    }
  }
  out.sort((a, b) => {
    const c = String(b.created_at || "").localeCompare(String(a.created_at || ""));
    if (c !== 0) return c;
    return toInt(b.server_id) - toInt(a.server_id);
  });
  return out;
}

export async function getFills(sessionId: string): Promise<Record<string, Fill>> {
  const sess = await getSession(sessionId);
  const all = fillsAll();
  const out: Record<string, Fill> = {};
  const names: Record<string, string> = {};
  for (const p of sess?.pcs || []) names[p.comp_id] = p.name || p.comp_id;
  const pre = sessionId + "|";
  for (const k of Object.keys(all)) {
    if (!k.startsWith(pre)) continue;
    const cid = k.slice(pre.length);
    const bag = all[k] || {};
    for (const f of Object.keys(bag)) {
      const v = bag[f] || ({} as Fill);
      v.pc_id = cid;
      v.pc_name = names[cid] || cid;
      v.tid = "fill:" + f;
      out[f] = v;
    }
  }
  return out;
}

export async function upsertFill(sessionId: string, compId: string, day: string, n: number, tunai: unknown, nontunai: unknown): Promise<Fill | null> {
  const t = toInt(tunai);
  const nt = toInt(nontunai);
  const nn = parseInt(String(n), 10);
  if (!(nn > 0) || !day || t < 0 || nt < 0) return null;
  const all = fillsAll();
  const key = bKey(sessionId, compId);
  const cur = all[key] || {};
  const fk = fillKey(compId, day, nn);
  cur[fk] = {
    day,
    n: nn,
    tunai: t,
    nontunai: nt,
    total: t + nt,
    kategori: t > 0 && nt > 0 ? "Split" : t > 0 ? "Tunai" : nt > 0 ? "Nontunai" : "",
    edited: 1,
    manual: 1,
    filled_at: nowIso(),
  };
  all[key] = cur;
  writeJson("fills.json", all);
  return cur[fk];
}

export async function openSessionOf(): Promise<Session | null> {
  for (const s of sessions()) if (s.status === "open") return s;
  return null;
}

export async function isCompInOpenSession(compId: string): Promise<boolean> {
  for (const s of sessions()) {
    if (s.status !== "open") continue;
    if ((s.pcs || []).some((p) => p.comp_id === compId)) return true;
  }
  return false;
}

export function loadCreds(): Cred | null {
  const c = readJson<Cred | null>("creds.json", null);
  return c && c.email ? c : null;
}

export function saveCreds(email: string, password: string): void {
  writeJson("creds.json", { email, password });
  try {
    fs.chmodSync(filePath("creds.json"), 0o600);
  } catch {
    /* ponytail: chmod no-op di Windows */
  }
}

export function clearCreds(): void {
  try {
    fs.rmSync(filePath("creds.json"), { force: true });
  } catch {
    /* noop */
  }
}

export function loadArchiveBucket(email: string, cashier: string): ArchiveBucket {
  const a = readJson<Record<string, ArchiveBucket>>("archive.json", {});
  let b = a[email];
  if (!b || typeof b !== "object" || Array.isArray(b)) b = { cashier: "", last_sync: null, data: [] };
  if (!Array.isArray(b.data)) b.data = [];
  if (cashier) {
    const hk = "kasir:" + String(cashier).trim().toLowerCase();
    const hold = a[hk];
    if (hold && Array.isArray(hold.data) && hold.data.length) {
      const have: Record<string, boolean> = {};
      b.data.forEach((r) => {
        have[String(r.tanggal || "").trim().toLowerCase() + "|" + String(r.shift || "").trim().toLowerCase() + "|" + String(r.cabang || "").trim().toLowerCase()] = true;
      });
      for (const r of hold.data) {
        const k = String(r.tanggal || "").trim().toLowerCase() + "|" + String(r.shift || "").trim().toLowerCase() + "|" + String(r.cabang || "").trim().toLowerCase();
        if (!have[k]) b.data.push(r);
      }
      if (hold.last_sync && !b.last_sync) b.last_sync = hold.last_sync;
      if (!b.cashier && hold.cashier) b.cashier = hold.cashier;
      delete a[hk];
      writeJson("archive.json", a);
    }
  }
  return b;
}

export function saveArchiveBucket(email: string, bucket: ArchiveBucket): void {
  const a = readJson<Record<string, ArchiveBucket>>("archive.json", {});
  a[email] = bucket;
  writeJson("archive.json", a);
}

export function loadPrintMeta(): Partial<PrintMeta> {
  const m = readJson<Partial<PrintMeta> | null>("print-meta.json", null);
  return m && typeof m === "object" ? m : {};
}

export function savePrintMeta(m: PrintMeta): void {
  writeJson("print-meta.json", m);
}
