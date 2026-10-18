import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "../theme.js";
import { Field, Kpi, Modal, Msg, Sel } from "../ui.js";
import { viewKey } from "../keymap.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
import { DENOMS, buildPayload, fisikTotal, generateReceipt, latestSetoran, normShift, validateForSend, width as receiptWidth } from "../print.js";
import { dots, rupiah, toInt } from "../fmt.js";
function fillInQtyDenoms(qty) {
    const out = {};
    for (const d of DENOMS)
        out[String(d)] = qty[d] || 0;
    return out;
}
export function PrintView({ onView }) {
    const st = useRef({
        kasir: "",
        kasir_id: "",
        cabang: "",
        shift: "",
        metaOpen: true,
        size: "58",
        qty: {},
        expense: 0,
        note: "",
        expOpen: false,
        expAmt: "",
        expNote: "",
        sysCash: 0,
        noncash: 0,
        hasSession: false,
        sessionLabel: "belum ada sesi",
        seq: 0,
        focus: null,
        preview: false,
        picker: null,
        msg: { t: "", tone: "dim" },
    });
    const [, bump] = useState(0);
    const rerender = () => bump((n) => n + 1);
    const dims = useTerminalDimensions();
    function say(t, tone) {
        st.current.msg = { t, tone };
    }
    function saveMeta() {
        const s = st.current;
        Store.savePrintMeta({
            kasir: s.kasir,
            kasir_id: s.kasir_id,
            cabang: s.cabang,
            shift: s.shift,
            size: s.size,
            qty: fillInQtyDenoms(s.qty),
            expense: s.expense,
            note: s.note,
            fold: s.metaOpen ? 0 : 1,
        });
    }
    function metaComplete() {
        const s = st.current;
        return !!(s.kasir.trim() && s.kasir_id.trim() && s.cabang.trim() && s.shift);
    }
    function fillFromSetoran(force) {
        const email = Store.loadCreds()?.email || "";
        const it = latestSetoran(email);
        if (!it)
            return false;
        const s = st.current;
        if (force || !s.kasir)
            s.kasir = it.kasir || s.kasir;
        if (force || !s.cabang)
            s.cabang = it.cabang || s.cabang;
        const ns = normShift(String(it.shift || ""));
        if (ns && (force || !s.shift))
            s.shift = ns;
        return true;
    }
    async function refreshSys() {
        const s = st.current;
        const my = ++s.seq;
        let sysCash = 0;
        let noncash = 0;
        let hasSession = false;
        let label = "belum ada sesi";
        try {
            const ss = await Store.listSessions(10);
            const open = ss.find((x) => x.status === "open");
            if (open) {
                hasSession = true;
                const rows = await Store.listTx(open.id);
                for (const r of rows) {
                    const k = String(r.kategori || "").toLowerCase();
                    if (k === "tunai")
                        sysCash += toInt(r.total);
                    else if (k === "nontunai")
                        noncash += toInt(r.total);
                    else if (k === "split") {
                        sysCash += toInt(r.tunai);
                        noncash += toInt(r.nontunai);
                    }
                    else {
                        sysCash += toInt(r.tunai);
                        noncash += toInt(r.nontunai);
                    }
                }
                const fills = await Store.getFills(open.id);
                let nf = 0;
                for (const fk of Object.keys(fills)) {
                    nf++;
                    const fr = fills[fk] || {};
                    const fkk = String(fr.kategori || "").toLowerCase();
                    if (fkk === "tunai")
                        sysCash += toInt(fr.total);
                    else if (fkk === "nontunai")
                        noncash += toInt(fr.total);
                    else if (fkk === "split") {
                        sysCash += toInt(fr.tunai);
                        noncash += toInt(fr.nontunai);
                    }
                    else {
                        sysCash += toInt(fr.tunai);
                        noncash += toInt(fr.nontunai);
                    }
                }
                label = open.id + " · " + (rows.length + nf) + " tx";
            }
        }
        catch {
            /* empty */
        }
        const s2 = st.current;
        if (my !== s2.seq)
            return;
        s2.sysCash = sysCash;
        s2.noncash = noncash;
        s2.hasSession = hasSession;
        s2.sessionLabel = label;
        rerender();
    }
    useEffect(() => {
        const s = st.current;
        const m = Store.loadPrintMeta();
        for (const d of DENOMS)
            s.qty[d] = Math.max(0, toInt((m.qty || {})[String(d)]));
        s.expense = Math.max(0, toInt(m.expense));
        s.note = String(m.note || "");
        s.size = m.size === "80" ? "80" : "58";
        s.kasir = m.kasir || "";
        s.kasir_id = m.kasir_id || "";
        s.cabang = m.cabang || "";
        s.shift = m.shift || "";
        fillFromSetoran(false);
        s.metaOpen = m.fold === 0 ? true : m.fold === 1 ? false : !metaComplete();
        saveMeta();
        rerender();
        void refreshSys();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    function closeExpense(commit) {
        const s = st.current;
        if (commit) {
            s.expense = Math.max(0, toInt(s.expAmt.replace(/[^0-9]/g, "")));
            s.note = s.expNote.trim();
            saveMeta();
            say(s.expense || s.note ? "pengeluaran tersimpan." : "pengeluaran kosong.", "ok");
        }
        s.expOpen = false;
        s.focus = null;
        rerender();
    }
    function doPreview() {
        const s = st.current;
        const err = validateForSend({ kasir: s.kasir, kasir_id: s.kasir_id }, s.qty);
        if (err) {
            say(err, "bad");
            rerender();
            return false;
        }
        saveMeta();
        s.preview = true;
        say("", "dim");
        rerender();
        return true;
    }
    function doClear() {
        const s = st.current;
        for (const d of DENOMS)
            s.qty[d] = 0;
        s.expense = 0;
        s.note = "";
        saveMeta();
        s.preview = false;
        say("bersih.", "ok");
        rerender();
    }
    async function doSend() {
        const s = st.current;
        const err = validateForSend({ kasir: s.kasir, kasir_id: s.kasir_id }, s.qty);
        if (err) {
            say(err, "bad");
            rerender();
            return;
        }
        s.preview = false;
        s.picker = { list: null, cursor: 0 };
        rerender();
        const list = await Comps.online();
        const s2 = st.current;
        if (!s2.picker)
            return;
        const lu = Comps.lastUsed();
        s2.picker.list = list;
        if (lu) {
            const at = list.findIndex((c) => c.id === lu.id);
            if (at >= 0)
                s2.picker.cursor = at;
        }
        rerender();
    }
    async function sendTo(comp) {
        const s = st.current;
        const my = ++s.seq;
        say("mengirim ke " + comp.name + " ...", "dim");
        rerender();
        Comps.touch(comp.id);
        const payload = buildPayload({ kasir: s.kasir, kasir_id: s.kasir_id, cabang: s.cabang, shift: s.shift, size: s.size }, s.qty, s.expense, s.note, s.noncash);
        const r = await Lan.print(comp.base, payload);
        const s2 = st.current;
        if (my !== s2.seq)
            return;
        if (r.ok && r.data) {
            const d = r.data;
            const t = d.total != null ? " · fisik " + rupiah(d.total) : "";
            const nt = d.nontunai && d.nontunai > 0 ? " · NT " + rupiah(d.nontunai) : "";
            say("tercetak di " + comp.name + "/" + (d.printer || "printer") + t + nt, "ok");
        }
        else {
            say("gagal: " + ((r && r.error) || "tanpa respon"), "bad");
        }
        rerender();
    }
    const s = st.current;
    const fisik = fisikTotal(s.qty);
    const jual = fisik + s.noncash + s.expense;
    const diff = fisik - s.sysCash;
    const fieldOrder = s.expOpen
        ? ["kasir", "kasir_id", "cabang", "shift", ...DENOMS.map((d) => `q-${d}`), "exp-amt", "exp-note"]
        : s.metaOpen
            ? ["kasir", "kasir_id", "cabang", "shift", ...DENOMS.map((d) => `q-${d}`)]
            : [...DENOMS.map((d) => `q-${d}`)];
    function nextFocus(dir) {
        const sx = st.current;
        const n = fieldOrder.length;
        const i = sx.focus ? fieldOrder.indexOf(sx.focus) : -1;
        const next = i < 0 ? 0 : (i + dir + n) % n;
        sx.focus = fieldOrder[next] || null;
        rerender();
    }
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        const sx = st.current;
        if (sx.picker) {
            const p = sx.picker;
            if (key.name === "escape") {
                sx.picker = null;
                rerender();
                return;
            }
            if (p.list) {
                if (key.name === "up") {
                    p.cursor = Math.max(0, p.cursor - 1);
                    rerender();
                    return;
                }
                if (key.name === "down") {
                    p.cursor = Math.min(p.list.length - 1, p.cursor + 1);
                    rerender();
                    return;
                }
                if (key.name === "return") {
                    const c = p.list[p.cursor];
                    sx.picker = null;
                    rerender();
                    if (c)
                        void sendTo(c);
                    return;
                }
            }
            return;
        }
        if (sx.preview) {
            if (key.name === "escape") {
                sx.preview = false;
                rerender();
                return;
            }
            if (key.name === "v") {
                sx.size = sx.size === "58" ? "80" : "58";
                saveMeta();
                rerender();
                return;
            }
            if (key.name === "k")
                void doSend();
            return;
        }
        if (sx.expOpen && sx.focus) {
            if (key.name === "escape") {
                closeExpense(false);
                return;
            }
            if (key.name === "tab") {
                nextFocus(1);
                return;
            }
            return;
        }
        if (sx.focus) {
            if (key.name === "escape") {
                sx.focus = null;
                sx.metaOpen = metaComplete() ? false : sx.metaOpen;
                saveMeta();
                rerender();
                return;
            }
            if (key.name === "tab") {
                nextFocus(1);
                return;
            }
            return;
        }
        const v = viewKey(key.name);
        if (v) {
            if (v !== "print")
                onView(v);
            return;
        }
        switch (key.name) {
            case "p":
                doPreview();
                break;
            case "k":
                void doSend();
                break;
            case "v":
                sx.size = sx.size === "58" ? "80" : "58";
                saveMeta();
                rerender();
                break;
            case "e":
                sx.expOpen = !sx.expOpen;
                if (sx.expOpen) {
                    sx.expAmt = sx.expense ? dots(sx.expense) : "";
                    sx.expNote = sx.note;
                    sx.focus = "exp-amt";
                }
                else {
                    sx.focus = null;
                }
                rerender();
                break;
            case "b":
                doClear();
                break;
            case "r":
                void refreshSys();
                break;
            case "m":
                sx.metaOpen = !sx.metaOpen;
                if (sx.metaOpen)
                    sx.focus = "kasir";
                saveMeta();
                rerender();
                break;
        }
    });
    const receipt = s.preview
        ? generateReceipt(receiptWidth(s.size), fillInQtyDenoms(s.qty), {
            kasir: s.kasir,
            kasir_id: s.kasir_id,
            cabang: s.cabang,
            shift: s.shift,
            noncash: s.noncash,
            expense: s.expense,
            note: s.note,
        })
        : "";
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", gap: 4, children: [_jsx(Kpi, { label: "fisik", value: rupiah(fisik) }), _jsx(Kpi, { label: "sistem", value: s.hasSession ? rupiah(s.sysCash) : "—" }), _jsx(Kpi, { label: "selisih", value: !s.hasSession ? "—" : diff > 0 ? "+ " + rupiah(diff) : rupiah(diff), tone: !s.hasSession ? "faint" : diff > 0 ? "ok" : diff < 0 ? "bad" : "faint" }), _jsx(Kpi, { label: "nontunai", value: rupiah(s.noncash) }), _jsx(Kpi, { label: "jual", value: rupiah(jual) })] }), _jsx("box", { flexDirection: "row", gap: 2, children: _jsx("text", { fg: T.faint, children: `${s.size}mm · ${s.sessionLabel}` }) }), s.metaOpen ? (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Field, { label: "kasir", value: s.kasir, focus: s.focus === "kasir", width: 14, onInput: (v) => { st.current.kasir = v; }, onSubmit: () => nextFocus(1) }), _jsx(Field, { label: "id", value: s.kasir_id, focus: s.focus === "kasir_id", width: 10, onInput: (v) => { st.current.kasir_id = v; }, onSubmit: () => nextFocus(1) }), _jsx(Field, { label: "cabang", value: s.cabang, focus: s.focus === "cabang", width: 12, onInput: (v) => { st.current.cabang = v; }, onSubmit: () => nextFocus(1) }), _jsx(Field, { label: "shift", value: s.shift, focus: s.focus === "shift", width: 9, onInput: (v) => { st.current.shift = v; }, onSubmit: () => nextFocus(1) })] })) : (_jsx("text", { fg: T.dim, children: `└─ ${s.kasir} · ${s.cabang} · ${String(s.shift).toUpperCase()}${s.kasir_id ? " · " + s.kasir_id : ""}  (m ubah)` })), _jsx("box", { flexDirection: "column", children: DENOMS.map((d) => {
                    const f = `q-${d}`;
                    const subtotal = (s.qty[d] || 0) * d;
                    return (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 9, children: _jsx("text", { fg: T.dim, children: dots(d) }) }), _jsx("text", { fg: T.faint, children: "\u00D7" }), _jsx("input", { backgroundColor: T.surface, textColor: T.text, focusedBackgroundColor: T.surface, placeholderColor: T.faint, focused: s.focus === f, value: s.qty[d] ? String(s.qty[d]) : "", placeholder: "0", width: 6, onInput: (v) => {
                                    const c = v.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
                                    st.current.qty[d] = toInt(c);
                                    rerender();
                                }, onSubmit: () => nextFocus(1) }), _jsx("box", { flexGrow: 1, justifyContent: "flex-end", flexDirection: "row", children: _jsx("text", { fg: subtotal ? T.text : T.faint, children: subtotal ? rupiah(subtotal) : "" }) })] }, d));
                }) }), s.expOpen ? (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: T.dim, children: "pengeluaran" }), _jsx("input", { backgroundColor: T.surface, textColor: T.text, focusedBackgroundColor: T.surface, placeholderColor: T.faint, focused: s.focus === "exp-amt", value: s.expAmt, placeholder: "0", width: 12, onInput: (v) => {
                            st.current.expAmt = v.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
                            rerender();
                        }, onSubmit: () => {
                            st.current.focus = "exp-note";
                            rerender();
                        } }), _jsx(Field, { label: "ket", value: s.expNote, focus: s.focus === "exp-note", width: 24, onInput: (v) => { st.current.expNote = v; }, onSubmit: () => closeExpense(true) }), _jsx("text", { fg: T.faint, children: "enter simpan · esc batal" })] })) : (_jsx("text", { fg: T.dim, children: s.expense || s.note ? `pengeluaran: Rp ${dots(s.expense)}${s.note ? " · " + s.note : ""}  (e ubah)` : "pengeluaran: —  (e isi)" })), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone }), s.preview ? (_jsx(Modal, { title: `pratinjau struk ${s.size}mm`, hint: "v ganti lebar \u00B7 k kirim \u00B7 esc", widthPct: 60, heightPct: 85, children: _jsx("scrollbox", { flexGrow: 1, width: "100%", children: receipt.split("\n").map((ln, i) => (_jsx("text", { fg: T.text, wrapMode: "none", children: ln || " " }, i))) }) })) : null, s.picker ? (_jsx(Modal, { title: "kirim ke pc \u00B7 tersambung saja", hint: "esc batal", widthPct: 70, heightPct: 50, children: _jsxs("box", { flexDirection: "column", children: [s.picker.list === null ? (_jsx("text", { fg: T.dim, children: "cek PC\u2026" })) : !s.picker.list.length ? (_jsx("text", { fg: T.dim, children: "tak ada PC tersambung. cek wifi atau tambah via view comp (4)." })) : (s.picker.list.map((c, i) => (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Sel, { on: i === s.picker?.cursor }), _jsx("text", { fg: i === s.picker?.cursor ? T.text : T.dim, children: c.name }), _jsx("text", { fg: T.faint, children: c.base })] }, c.id)))), _jsx("text", { fg: T.faint, children: "enter kirim \u00B7 esc batal" })] }) })) : null] }));
}
