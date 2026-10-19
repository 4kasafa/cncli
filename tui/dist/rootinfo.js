import { parseDate, toInt } from "./conflict.js";
import { capLines } from "./layout.js";
import { rupiah } from "./fmt.js";
export function baseHost(base) {
    try {
        return new URL(base).host || base;
    }
    catch {
        return base;
    }
}
export function pickLastRow(data) {
    let best = null;
    let bestT = -1;
    for (const r of data || []) {
        if (!r)
            continue;
        const d = parseDate(r.tanggal);
        if (!d)
            continue;
        const t = d.getTime();
        if (t > bestT) {
            bestT = t;
            best = r;
        }
    }
    return best;
}
function liveBox(s) {
    if (!s)
        return { lines: ["[close] no session"], tone: "dim" };
    let open = 0;
    for (const p of s.pcs)
        if (toInt(p.alive))
            open++;
    const close = s.pcs.length - open;
    const lines = [
        `[open] ${s.pcs.length} pc · ${open} open ${close} close`,
        `${s.tx} tx · total ${rupiah(s.total)}`,
        s.last ? `last: ${s.last.no} ${rupiah(s.last.total)}${s.last.time ? " · " + s.last.time : ""}` : "last: -",
    ];
    return { lines, tone: "ok" };
}
function printBox(m) {
    if (!m || !(m.kasir || m.kasir_id || m.shift || m.cabang))
        return { lines: ["no meta"], tone: "dim" };
    const v = (x) => (x && String(x).trim()) || "-";
    return {
        lines: [`kasir: ${v(m.kasir)}`, `id: ${v(m.kasir_id)}`, `shift: ${v(m.shift)}`, `cabang: ${v(m.cabang)}`],
        tone: "ok",
    };
}
function pcsBox(d) {
    const act = d.session ? d.session.pcs : [];
    if (!act.length)
        return { lines: [d.paired ? `${d.paired} paired · 0 aktif` : "none paired"], tone: "dim" };
    const names = act.map((p) => `${p.name} ${baseHost(p.base)}`);
    return { lines: [`${d.paired} paired · ${act.length} aktif`, ...capLines(names, 4)], tone: "ok" };
}
// ponytail: tone reports ikut konvensi setoran (short bad, over ok, even dim)
function reportStatus(row) {
    const stv = String(row.statusSelisih || "").toUpperCase();
    const v = toInt(row.jumlahSelisih);
    if (stv === "KURANG" || v < 0)
        return { text: `short ${rupiah(Math.abs(v))}`, tone: "bad" };
    if (stv === "LEBIH" || v > 0)
        return { text: `over ${rupiah(Math.abs(v))}`, tone: "ok" };
    return { text: "even", tone: "dim" };
}
function reportBox(row) {
    if (!row)
        return { lines: ["no data"], tone: "dim" };
    const st = reportStatus(row);
    return {
        lines: [
            `tgl: ${String(row.tanggal || "-")}`,
            `total komputer: ${rupiah(row.totalKomputer)}`,
            `total fisik: ${rupiah(row.uangFisik)}`,
            st.text,
        ],
        tone: st.tone,
    };
}
export function rootLines(d) {
    const live = liveBox(d.session);
    const print = printBox(d.print);
    const pcs = pcsBox(d);
    const reports = reportBox(d.report);
    return {
        lines: { live: live.lines, print: print.lines, pcs: pcs.lines, reports: reports.lines },
        tone: { live: live.tone, print: print.tone, pcs: pcs.tone, reports: reports.tone },
    };
}
export function contentRows(v) {
    return v.lines.live.length + v.lines.print.length + v.lines.pcs.length + v.lines.reports.length;
}
