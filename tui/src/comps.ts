import * as Lan from "./lan.js";

export interface Comp {
  id: string;
  name: string;
  base: string;
  last_used: number;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = "8765";
const CHECK_MS = 2500;

function filePath(): string {
  const dir = process.env.CNCLI_TUI_DIR || path.join(os.homedir(), ".cncli", "tui");
  return path.join(dir, "comps.json");
}

function load(): Comp[] {
  try {
    const a = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function save(a: Comp[]): void {
  try {
    const p = filePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p + ".tmp", JSON.stringify(a));
    fs.renameSync(p + ".tmp", p);
  } catch {
    /* ponytail: write failure = old list kept */
  }
}

export function normBase(v: unknown): string {
  let s = String(v || "")
    .trim()
    .replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  const m = s.match(/^(https?:\/\/)([^/?#]+)(.*)$/i);
  if (!m) return "";
  let host = m[2].toLowerCase();
  if (host.indexOf(":") < 0) host += ":" + DEFAULT_PORT;
  return m[1].toLowerCase() + host + m[3];
}

function normName(v: unknown): string {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ");
}

function newId(): string {
  return "c_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
}

function findByBase(a: Comp[], base: string): Comp | null {
  for (const c of a) if (c.base === base) return c;
  return null;
}

export function list(): Comp[] {
  return load();
}

export function get(id: string | null): Comp | null {
  if (!id) return null;
  for (const c of load()) if (c.id === id) return c;
  return null;
}

export function byName(id: string | null): string {
  const c = get(id);
  return (c && c.name) || "pc";
}

export function upsert(id: string | null, name: string, base: string): { ok: boolean; error?: string; comp?: Comp } {
  const n = normName(name);
  const b = normBase(base);
  if (!n) return { ok: false, error: "name is required" };
  if (!b) return { ok: false, error: "address is required: http://IP:8765" };
  const a = load();
  const dupe = findByBase(a, b);
  if (dupe && dupe.id !== id) return { ok: false, error: "address already used by " + dupe.name };
  if (id) {
    for (const c of a) {
      if (c.id !== id) continue;
      c.name = n;
      c.base = b;
      save(a);
      return { ok: true, comp: c };
    }
    return { ok: false, error: "pc not found" };
  }
  const c: Comp = { id: newId(), name: n, base: b, last_used: 0 };
  a.push(c);
  save(a);
  return { ok: true, comp: c };
}

export function add(n: string, b: string): { ok: boolean; error?: string; comp?: Comp } {
  return upsert(null, n, b);
}

export function remove(id: string): boolean {
  const a = load();
  const at = a.findIndex((c) => c.id === id);
  if (at < 0) return false;
  a.splice(at, 1);
  save(a);
  state.delete(id);
  return true;
}

export function touch(id: string): void {
  const a = load();
  for (const c of a) {
    if (c.id !== id) continue;
    c.last_used = Date.now();
    save(a);
    return;
  }
}

export function lastUsed(): Comp | null {
  let best: Comp | null = null;
  for (const c of load()) {
    if (!c.last_used) continue;
    if (!best || c.last_used > best.last_used) best = c;
  }
  return best;
}

export interface CompState {
  state: "ok" | "lama" | "putus" | "?";
  version: string;
}

const state = new Map<string, CompState>();

export function st(id: string): CompState {
  return state.get(id) || { state: "?", version: "" };
}

function setSt(id: string, s: CompState["state"], version?: string): void {
  state.set(id, { state: s, version: version || "" });
}

function toIntMs(ms: unknown): number {
  const n = parseInt(String(ms == null ? "" : ms), 10);
  return isNaN(n) || n <= 0 ? 0 : n;
}

async function checkOne(c: Comp, ms?: number): Promise<void> {
  const t = toIntMs(ms) || CHECK_MS;
  const r = await Lan.statusGet(c.base, t);
  if (r.ok) {
    setSt(c.id, "ok", String((r.data as { version?: unknown })?.version || ""));
    return;
  }
  if (r.error === Lan.ERR_LEGACY) {
    const h = await Lan.health(c.base, t);
    setSt(c.id, h.ok ? "lama" : "putus", "");
    return;
  }
  setSt(c.id, "putus", "");
}

export async function checkAll(ms?: number): Promise<Comp[]> {
  const a = list();
  await Promise.all(a.map((c) => checkOne(c, ms)));
  return a;
}

export async function online(ms?: number): Promise<Comp[]> {
  await checkAll(ms);
  const out: Comp[] = [];
  for (const c of list()) if (st(c.id).state !== "putus") out.push(c);
  return out;
}
