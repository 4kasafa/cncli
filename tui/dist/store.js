import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function baseDir() {
    return process.env.CNCLI_TUI_DIR || path.join(os.homedir(), ".cncli", "tui");
}
function filePath(name) {
    return path.join(baseDir(), name);
}
function readJson(name, fb) {
    try {
        const v = JSON.parse(fs.readFileSync(filePath(name), "utf8"));
        return v == null ? fb : v;
    }
    catch {
        return fb;
    }
}
function writeJson(name, v) {
    try {
        fs.mkdirSync(baseDir(), { recursive: true });
        const p = filePath(name);
        const tmp = p + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(v));
        fs.renameSync(tmp, p);
    }
    catch {
        /* ponytail: write failure = old state kept; no retry queue */
    }
}
function nowIso() {
    return new Date().toISOString();
}
export function toInt(v) {
    const n = parseInt(String(v == null ? "" : v), 10);
    return isNaN(n) ? 0 : n;
}
export function tid(compId, sid) {
    return String(compId) + ":" + toInt(sid);
}
export function splitTid(t) {
    const s = String(t == null ? "" : t);
    const i = s.lastIndexOf(":");
    return i < 0 ? { comp_id: "", sid: s } : { comp_id: s.slice(0, i), sid: s.slice(i + 1) };
}
export function fillKey(compId, day, n) {
    return compId + "|" + day + "|" + n;
}
function bKey(sessionId, compId) {
    return sessionId + "|" + compId;
}
export const CAP_PER_PC = 500;
function sessions() {
    const a = readJson("sessions.json", []);
    return Array.isArray(a) ? a : [];
}
function saveSessions(a) {
    writeJson("sessions.json", a);
}
function txAll() {
    const v = readJson("tx.json", {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function fillsAll() {
    const v = readJson("fills.json", {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
export async function createSession(comps) {
    const pcs = [];
    const seen = {};
    for (const c of comps || []) {
        if (!c || !c.id || !c.base || seen[c.id])
            continue;
        seen[c.id] = true;
        pcs.push({ comp_id: c.id, name: c.name || c.id, base: c.base, last_seen: 0, complete: 1, alive: 1 });
    }
    const a = sessions();
    const s = {
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
export async function getSession(id) {
    if (!id)
        return null;
    for (const s of sessions())
        if (s.id === id)
            return s;
    return null;
}
export async function listSessions(limit) {
    return sessions().slice(0, limit || 20);
}
export async function patchSession(id, patch) {
    const a = sessions();
    let hit = null;
    for (const s of a) {
        if (s.id !== id)
            continue;
        Object.assign(s, patch);
        hit = s;
        break;
    }
    if (hit)
        saveSessions(a);
    return hit;
}
export async function closeSession(id, complete) {
    return patchSession(id, { status: "closed", closed_at: nowIso(), complete: complete ? 1 : 0 });
}
export async function addPc(sessionId, comp) {
    const a = sessions();
    let hit = null;
    for (const s of a) {
        if (s.id !== sessionId)
            continue;
        if (!s.pcs)
            s.pcs = [];
        if (s.pcs.some((p) => p.comp_id === comp.id))
            return null;
        s.pcs.push({ comp_id: comp.id, name: comp.name || comp.id, base: comp.base, last_seen: 0, complete: 1, alive: 1 });
        hit = s;
        break;
    }
    if (hit)
        saveSessions(a);
    return hit;
}
export async function patchPc(sessionId, compId, patch) {
    const a = sessions();
    let hit = null;
    for (const s of a) {
        if (s.id !== sessionId)
            continue;
        const pcs = s.pcs || [];
        for (const p of pcs) {
            if (p.comp_id !== compId)
                continue;
            Object.assign(p, patch);
            hit = p;
            break;
        }
        s.pcs = pcs;
        s.complete = pcs.every((p) => toInt(p.complete)) ? 1 : 0;
        break;
    }
    if (hit)
        saveSessions(a);
    return hit;
}
export async function deleteSession(id) {
    const a = sessions();
    const at = a.findIndex((s) => s.id === id);
    if (at < 0 || a[at].status === "open")
        return false;
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
    if (changed)
        writeJson("tx.json", t);
    const f = fillsAll();
    let ch2 = false;
    for (const k of Object.keys(f)) {
        if (k.startsWith(pre)) {
            delete f[k];
            ch2 = true;
        }
    }
    if (ch2)
        writeJson("fills.json", f);
    return true;
}
export async function getLastSeen(sessionId, compId) {
    for (const s of sessions()) {
        if (s.id !== sessionId)
            continue;
        for (const p of s.pcs || [])
            if (p.comp_id === compId)
                return toInt(p.last_seen);
        return 0;
    }
    return 0;
}
export async function upsertTx(sessionId, compId, rows) {
    const all = txAll();
    const key = bKey(sessionId, compId);
    let cur = all[key] || [];
    const fillsHere = fillsAll()[key] || {};
    const seenId = {};
    const seenNo = {};
    for (const r of cur) {
        seenId[r.server_id] = true;
        if (r.no_transaksi)
            seenNo[r.no_transaksi] = true;
    }
    let added = 0;
    let maxId = 0;
    const ids = [];
    for (const r of cur)
        maxId = Math.max(maxId, toInt(r.server_id));
    const rowNumUrut = (r) => {
        const n = parseInt(String(r.no_urut || ""), 10);
        return isNaN(n) || n <= 0 ? 0 : n;
    };
    const rowDay = (r) => String(r.created_at || "").slice(0, 10) || "??";
    for (const r of rows || []) {
        const sid = toInt(r.server_id);
        if (sid > maxId)
            maxId = sid;
        if (seenId[sid])
            continue;
        if (r.no_transaksi && seenNo[r.no_transaksi])
            continue;
        if (rowNumUrut(r) && fillsHere[fillKey(compId, rowDay(r), rowNumUrut(r))])
            continue;
        seenId[sid] = true;
        if (r.no_transaksi)
            seenNo[r.no_transaksi] = true;
        cur.push(r);
        added++;
        ids.push(tid(compId, sid));
    }
    cur.sort((a, b) => toInt(a.server_id) - toInt(b.server_id));
    if (cur.length > CAP_PER_PC)
        cur = cur.slice(cur.length - CAP_PER_PC);
    all[key] = cur;
    writeJson("tx.json", all);
    const sess = await getSession(sessionId);
    const lastSeen = maxId > 0 ? maxId : await getLastSeen(sessionId, compId);
    if (sess) {
        let count = 0;
        for (const k of Object.keys(all))
            if (k.startsWith(sessionId + "|"))
                count += (all[k] || []).length;
        await patchSession(sessionId, { count });
    }
    await patchPc(sessionId, compId, { last_seen: lastSeen });
    return { added, lastSeen, ids };
}
export async function patchTx(sessionId, t, tunai, nontunai) {
    const parts = splitTid(t);
    const all = txAll();
    const key = bKey(sessionId, parts.comp_id);
    const cur = all[key] || [];
    const tt = toInt(tunai);
    const nt = toInt(nontunai);
    if (tt < 0 || nt < 0)
        return null;
    for (const r of cur) {
        if (toInt(r.server_id) !== toInt(parts.sid))
            continue;
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
export async function listTx(sessionId) {
    const sess = await getSession(sessionId);
    const all = txAll();
    const names = {};
    const out = [];
    for (const p of sess?.pcs || [])
        names[p.comp_id] = p.name || p.comp_id;
    const pre = sessionId + "|";
    for (const k of Object.keys(all)) {
        if (!k.startsWith(pre))
            continue;
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
        if (c !== 0)
            return c;
        return toInt(b.server_id) - toInt(a.server_id);
    });
    return out;
}
export async function getFills(sessionId) {
    const sess = await getSession(sessionId);
    const all = fillsAll();
    const out = {};
    const names = {};
    for (const p of sess?.pcs || [])
        names[p.comp_id] = p.name || p.comp_id;
    const pre = sessionId + "|";
    for (const k of Object.keys(all)) {
        if (!k.startsWith(pre))
            continue;
        const cid = k.slice(pre.length);
        const bag = all[k] || {};
        for (const f of Object.keys(bag)) {
            const v = bag[f] || {};
            v.pc_id = cid;
            v.pc_name = names[cid] || cid;
            v.tid = "fill:" + f;
            out[f] = v;
        }
    }
    return out;
}
export async function upsertFill(sessionId, compId, day, n, tunai, nontunai) {
    const t = toInt(tunai);
    const nt = toInt(nontunai);
    const nn = parseInt(String(n), 10);
    if (!(nn > 0) || !day || t < 0 || nt < 0)
        return null;
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
export async function openSessionOf() {
    for (const s of sessions())
        if (s.status === "open")
            return s;
    return null;
}
export async function isCompInOpenSession(compId) {
    for (const s of sessions()) {
        if (s.status !== "open")
            continue;
        if ((s.pcs || []).some((p) => p.comp_id === compId))
            return true;
    }
    return false;
}
export function loadCreds() {
    const c = readJson("creds.json", null);
    return c && c.email ? c : null;
}
export function saveCreds(email, password) {
    writeJson("creds.json", { email, password });
    try {
        fs.chmodSync(filePath("creds.json"), 0o600);
    }
    catch {
        /* ponytail: chmod no-op di Windows */
    }
}
export function clearCreds() {
    try {
        fs.rmSync(filePath("creds.json"), { force: true });
    }
    catch {
        /* noop */
    }
}
export function loadArchiveBucket(email, cashier) {
    const a = readJson("archive.json", {});
    let b = a[email];
    if (!b || typeof b !== "object" || Array.isArray(b))
        b = { cashier: "", last_sync: null, data: [] };
    if (!Array.isArray(b.data))
        b.data = [];
    if (cashier) {
        const hk = "kasir:" + String(cashier).trim().toLowerCase();
        const hold = a[hk];
        if (hold && Array.isArray(hold.data) && hold.data.length) {
            const have = {};
            b.data.forEach((r) => {
                have[String(r.tanggal || "").trim().toLowerCase() + "|" + String(r.shift || "").trim().toLowerCase() + "|" + String(r.cabang || "").trim().toLowerCase()] = true;
            });
            for (const r of hold.data) {
                const k = String(r.tanggal || "").trim().toLowerCase() + "|" + String(r.shift || "").trim().toLowerCase() + "|" + String(r.cabang || "").trim().toLowerCase();
                if (!have[k])
                    b.data.push(r);
            }
            if (hold.last_sync && !b.last_sync)
                b.last_sync = hold.last_sync;
            if (!b.cashier && hold.cashier)
                b.cashier = hold.cashier;
            delete a[hk];
            writeJson("archive.json", a);
        }
    }
    return b;
}
export function saveArchiveBucket(email, bucket) {
    const a = readJson("archive.json", {});
    a[email] = bucket;
    writeJson("archive.json", a);
}
export function loadPrintMeta() {
    const m = readJson("print-meta.json", null);
    return m && typeof m === "object" ? m : {};
}
export function savePrintMeta(m) {
    writeJson("print-meta.json", m);
}
