import * as Lan from "./lan.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const DEFAULT_PORT = "8765";
const CHECK_MS = 2500;
function filePath() {
    const dir = process.env.CNCLI_TUI_DIR || path.join(os.homedir(), ".cncli", "tui");
    return path.join(dir, "comps.json");
}
function load() {
    try {
        const a = JSON.parse(fs.readFileSync(filePath(), "utf8"));
        return Array.isArray(a) ? a : [];
    }
    catch {
        return [];
    }
}
function save(a) {
    try {
        const p = filePath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p + ".tmp", JSON.stringify(a));
        fs.renameSync(p + ".tmp", p);
    }
    catch {
        /* ponytail: gagal tulis = daftar lama tetap */
    }
}
export function normBase(v) {
    let s = String(v || "")
        .trim()
        .replace(/\/+$/, "");
    if (!s)
        return "";
    if (!/^https?:\/\//i.test(s))
        s = "http://" + s;
    const m = s.match(/^(https?:\/\/)([^/?#]+)(.*)$/i);
    if (!m)
        return "";
    let host = m[2].toLowerCase();
    if (host.indexOf(":") < 0)
        host += ":" + DEFAULT_PORT;
    return m[1].toLowerCase() + host + m[3];
}
function normName(v) {
    return String(v || "")
        .trim()
        .replace(/\s+/g, " ");
}
function newId() {
    return "c_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
}
function findByBase(a, base) {
    for (const c of a)
        if (c.base === base)
            return c;
    return null;
}
export function list() {
    return load();
}
export function get(id) {
    if (!id)
        return null;
    for (const c of load())
        if (c.id === id)
            return c;
    return null;
}
export function byName(id) {
    const c = get(id);
    return (c && c.name) || "pc";
}
export function upsert(id, name, base) {
    const n = normName(name);
    const b = normBase(base);
    if (!n)
        return { ok: false, error: "isi nama computer" };
    if (!b)
        return { ok: false, error: "isi alamat: http://IP:8765" };
    const a = load();
    const dupe = findByBase(a, b);
    if (dupe && dupe.id !== id)
        return { ok: false, error: "alamat itu sudah dipakai " + dupe.name };
    if (id) {
        for (const c of a) {
            if (c.id !== id)
                continue;
            c.name = n;
            c.base = b;
            save(a);
            return { ok: true, comp: c };
        }
        return { ok: false, error: "computer tak ada" };
    }
    const c = { id: newId(), name: n, base: b, last_used: 0 };
    a.push(c);
    save(a);
    return { ok: true, comp: c };
}
export function add(n, b) {
    return upsert(null, n, b);
}
export function remove(id) {
    const a = load();
    const at = a.findIndex((c) => c.id === id);
    if (at < 0)
        return false;
    a.splice(at, 1);
    save(a);
    state.delete(id);
    return true;
}
export function touch(id) {
    const a = load();
    for (const c of a) {
        if (c.id !== id)
            continue;
        c.last_used = Date.now();
        save(a);
        return;
    }
}
export function lastUsed() {
    let best = null;
    for (const c of load()) {
        if (!c.last_used)
            continue;
        if (!best || c.last_used > best.last_used)
            best = c;
    }
    return best;
}
const state = new Map();
export function st(id) {
    return state.get(id) || { state: "?", version: "" };
}
function setSt(id, s, version) {
    state.set(id, { state: s, version: version || "" });
}
function toIntMs(ms) {
    const n = parseInt(String(ms == null ? "" : ms), 10);
    return isNaN(n) || n <= 0 ? 0 : n;
}
async function checkOne(c, ms) {
    const t = toIntMs(ms) || CHECK_MS;
    const r = await Lan.statusGet(c.base, t);
    if (r.ok) {
        setSt(c.id, "ok", String(r.data?.version || ""));
        return;
    }
    if (r.error === "PC versi lama, update dulu") {
        const h = await Lan.health(c.base, t);
        setSt(c.id, h.ok ? "lama" : "putus", "");
        return;
    }
    setSt(c.id, "putus", "");
}
export async function checkAll(ms) {
    const a = list();
    await Promise.all(a.map((c) => checkOne(c, ms)));
    return a;
}
export async function online(ms) {
    await checkAll(ms);
    const out = [];
    for (const c of list())
        if (st(c.id).state !== "putus")
            out.push(c);
    return out;
}
