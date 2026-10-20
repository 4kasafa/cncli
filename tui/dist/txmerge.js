import { padU } from "./fmt.js";
export function numUrut(r) {
    const n = parseInt(String((r && r.no_urut) || ""), 10);
    return isNaN(n) || n <= 0 ? 0 : n;
}
export function dayOf(r) {
    return String((r && r.created_at) || "").slice(0, 10) || "??";
}
export function fkey(pcId, day, n) {
    return pcId + "|" + day + "|" + n;
}
export function noUrutText(it) {
    if (it.t === "hilang")
        return padU(it.n, it.w);
    if (it.fill && it.w)
        return padU(it.seq, it.w);
    return String(it.r.no_urut || "") || "-";
}
export function txKind(tunai, nontunai) {
    if (tunai > 0 && nontunai > 0)
        return "SPLIT";
    if (tunai > 0)
        return "CASH";
    if (nontunai > 0)
        return "NONCASH";
    return "-";
}
export function txTime(createdAt) {
    const m = String(createdAt == null ? "" : createdAt).match(/[T ](\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : "--:--:--";
}
export function fillRow(f, pcId, pcName) {
    return {
        tid: "fill:" + fkey(pcId, f.day, f.n),
        pc_id: pcId,
        pc_name: pcName,
        server_id: 0,
        no_transaksi: "",
        no_urut: String(f.n),
        total: f.total,
        tunai: f.tunai,
        nontunai: f.nontunai,
        bank: "",
        kategori: f.kategori,
        created_at: String(f.day || ""),
        day: f.day,
        n: f.n,
        edited: 1,
        manual: 1,
    };
}
function chain(rows, fills, pcId, pcName) {
    const asc = rows.slice().sort((a, b) => (parseInt(String(a.server_id), 10) || 0) - (parseInt(String(b.server_id), 10) || 0));
    const out = [];
    const seen = {};
    let prevDay = null;
    let prevN = 0;
    const dayW = {};
    const tx = (r, sortKey, seq) => ({ t: "tx", r, pc_id: pcId, pc_name: pcName, sortKey, seq });
    for (const r of asc) {
        const d = dayOf(r);
        const n = numUrut(r);
        const ts = String((r && r.created_at) || "");
        if (!n) {
            out.push(tx(r, ts || d, 0));
            prevDay = null;
            prevN = 0;
            continue;
        }
        const dw = String((r && r.no_urut) || "").replace(/[^0-9]/g, "").length;
        dayW[d] = Math.max(dayW[d] || 0, dw);
        if (seen[d + "|" + n]) {
            out.push(tx(r, ts || d, n));
            continue;
        }
        seen[d + "|" + n] = true;
        if (d === prevDay && n > prevN + 1) {
            const w = Math.max(dayW[d] || 0, String(prevN).length, String(n).length, 4);
            for (let m = prevN + 1; m < n; m++) {
                const fk = fkey(pcId, d, m);
                if (fills[fk]) {
                    out.push({ t: "tx", r: fillRow(fills[fk], pcId, pcName), fill: fk, w, pc_id: pcId, pc_name: pcName, sortKey: ts || d, seq: m });
                }
                else {
                    out.push({ t: "hilang", day: d, n: m, w, hkey: fk, pc_id: pcId, pc_name: pcName, sortKey: ts || d, seq: m });
                }
            }
        }
        prevDay = d;
        prevN = n;
        out.push(tx(r, ts || d, n));
    }
    return out;
}
export function buildItems(rows, fills) {
    fills = fills || {};
    rows = rows || [];
    const groups = {};
    const names = {};
    const order = [];
    for (const r of rows) {
        const c = String(r.pc_id || "");
        if (!groups[c]) {
            groups[c] = [];
            order.push(c);
            names[c] = r.pc_name || c;
        }
        groups[c].push(r);
    }
    const all = [];
    for (const k of order) {
        const items = chain(groups[k], fills, k, names[k]);
        for (const it of items)
            all.push(it);
    }
    const sInt = (v) => parseInt(String(v), 10) || 0;
    all.sort((a, b) => {
        const c = String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
        if (c !== 0)
            return c;
        return sInt(b.seq) - sInt(a.seq);
    });
    return all;
}
