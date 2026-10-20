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
        return ["[close] no session"];
    let open = 0;
    for (const p of s.pcs)
        if (toInt(p.alive))
            open++;
    const close = s.pcs.length - open;
    const head = `[open] ${s.pcs.length} pc` + (s.pcs.length >= 2 ? ` · ${open} open ${close} close` : "");
    return [
        head,
        `${s.tx} tx · total ${rupiah(s.total)}`,
        s.last ? `${s.last.no} ${rupiah(s.last.total)}${s.last.time ? " · " + s.last.time : ""}` : "-",
    ];
}
function printBox(m) {
    const v = (x) => String(x == null ? "" : x).trim() || "-";
    const kasir = v(m?.kasir);
    const id = v(m?.kasir_id);
    const cabang = v(m?.cabang);
    const shift = v(m?.shift);
    if (kasir === "-" && id === "-" && cabang === "-" && shift === "-")
        return ["no meta"];
    return [`${kasir} · ${id}`, `${cabang} · ${shift}`];
}
function pcsBox(d) {
    const act = d.session ? d.session.pcs : [];
    if (!act.length)
        return [d.paired ? `${d.paired} paired · 0 aktif` : "none paired"];
    const names = act.map((p) => `${p.name} ${baseHost(p.base)}`);
    return [`${d.paired} paired · ${act.length} aktif`, ...capLines(names, 4)];
}
function fmtDay(d) {
    if (!d || isNaN(d.getTime()))
        return "-";
    const p = (n) => (n < 10 ? "0" : "") + n;
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function syncText(s) {
    const v = String(s == null ? "" : s).trim();
    return v ? v.slice(0, 16) : "-";
}
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function shiftTitle(s) {
    const t = String(s ?? "").trim();
    if (!t)
        return "";
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
export function reportDateLabel(tgl, shift) {
    const d = parseDate(tgl);
    if (!d)
        return String(tgl ?? "").trim() || "--";
    const day = String(d.getDate());
    const mon = MONTH_SHORT[d.getMonth()] || "--";
    const sh = shiftTitle(shift);
    return sh ? `${sh} ${day} ${mon}` : `${day} ${mon}`;
}
export function reportBranchLabel(v) {
    const t = String(v ?? "").trim().toUpperCase();
    return t || "--";
}
export function reportStatusLine(row) {
    const stv = String(row.statusSelisih || "").toUpperCase();
    const v = toInt(row.jumlahSelisih);
    if (stv === "KURANG" || v < 0)
        return { label: "SHORT", amount: Math.abs(v) };
    if (stv === "LEBIH" || v > 0)
        return { label: "OVER", amount: Math.abs(v) };
    return { label: "EVEN", amount: 0 };
}
export function reportAmountText(row) {
    const s = reportStatusLine(row);
    return rupiah(s.label === "EVEN" ? toInt(row.totalKomputer) : s.amount);
}
function reportStatus(row) {
    const s = reportStatusLine(row);
    return s.label === "EVEN" ? "even" : `${s.label.toLowerCase()} ${rupiah(s.amount)}`;
}
function reportBox(d) {
    const row = d.report;
    if (!row)
        return ["no data"];
    return [
        `${fmtDay(parseDate(row.tanggal))} · ${reportStatus(row)}`,
        `K: ${rupiah(row.totalKomputer)} · F: ${rupiah(row.uangFisik)}`,
        syncText(d.sync),
    ];
}
export function rootLines(d) {
    return {
        lines: { live: liveBox(d.session), print: printBox(d.print), pcs: pcsBox(d), reports: reportBox(d) },
    };
}
export function contentRows(v) {
    return v.lines.live.length + v.lines.print.length + v.lines.pcs.length + v.lines.reports.length;
}
