import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { Field, KpiGrid, Msg, Panel } from "../ui.js";
import { clip, formatRow } from "../layout.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
import { DENOMS, buildPayload, fisikTotal, generateReceipt, latestSetoran, normShift, validateForSend, width as receiptWidth } from "../print.js";
import { dots, rupiah, toInt } from "../fmt.js";
const META_FIELDS = [
    ["kasir", "cashier"],
    ["kasir_id", "id"],
    ["cabang", "branch"],
    ["shift", "shift"],
];
function fillInQtyDenoms(qty) {
    const out = {};
    for (const d of DENOMS)
        out[String(d)] = qty[d] || 0;
    return out;
}
export function PrintView({ onBack, onTextMode }) {
    const st = useRef({
        kasir: "",
        kasir_id: "",
        cabang: "",
        shift: "",
        page: "main",
        size: "58",
        qty: {},
        dcur: 0,
        expense: 0,
        note: "",
        expOpen: false,
        expAmt: "",
        expNote: "",
        sysCash: 0,
        noncash: 0,
        hasSession: false,
        sessionLabel: "no session",
        seq: 0,
        focus: null,
        picker: null,
        msg: { t: "", tone: "dim" },
    });
    const [, bump] = useState(0);
    const rerender = () => bump((n) => n + 1);
    const dims = useTerminalDimensions();
    useEffect(() => {
        onTextMode?.(st.current.page === "meta" || st.current.expOpen);
        // reported again on every render via the effect below
    });
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
            fold: s.page === "meta" ? 0 : 1,
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
        let label = "no session";
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
        s.page = metaComplete() ? "main" : "meta";
        if (s.page === "meta")
            s.focus = "kasir";
        saveMeta();
        rerender();
        void refreshSys();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    function nextMetaFocus(dir) {
        const s = st.current;
        const i = META_FIELDS.findIndex(([f]) => f === s.focus);
        const next = i < 0 ? 0 : (i + dir + META_FIELDS.length) % META_FIELDS.length;
        s.focus = META_FIELDS[next][0];
        rerender();
    }
    function closeExpense(commit) {
        const s = st.current;
        if (commit) {
            s.expense = Math.max(0, toInt(s.expAmt.replace(/[^0-9]/g, "")));
            s.note = s.expNote.trim();
            saveMeta();
            say(s.expense || s.note ? "expense saved." : "expense cleared.", "ok");
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
            return;
        }
        saveMeta();
        s.page = "preview";
        say("", "dim");
        rerender();
    }
    function doClear() {
        const s = st.current;
        for (const d of DENOMS)
            s.qty[d] = 0;
        s.expense = 0;
        s.note = "";
        saveMeta();
        say("cleared.", "ok");
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
        s.page = "picker";
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
        s.page = "main";
        say("sending to " + comp.name + " ...", "dim");
        rerender();
        Comps.touch(comp.id);
        const payload = buildPayload({ kasir: s.kasir, kasir_id: s.kasir_id, cabang: s.cabang, shift: s.shift, size: s.size }, s.qty, s.expense, s.note, s.noncash);
        const r = await Lan.print(comp.base, payload);
        const s2 = st.current;
        if (my !== s2.seq)
            return;
        if (r.ok && r.data) {
            const d = r.data;
            const t = d.total != null ? " · physical " + rupiah(d.total) : "";
            const nt = d.nontunai && d.nontunai > 0 ? " · NT " + rupiah(d.nontunai) : "";
            say("printed on " + comp.name + "/" + (d.printer || "printer") + t + nt, "ok");
        }
        else {
            say("failed: " + ((r && r.error) || "no response"), "bad");
        }
        rerender();
    }
    const s = st.current;
    const width = Math.max(20, dims.width - 2);
    const fisik = fisikTotal(s.qty);
    const jual = fisik + s.noncash + s.expense;
    const diff = fisik - s.sysCash;
    const innerWidth = Math.max(10, width - 4);
    const cols = width >= 72 ? 2 : 1;
    const cellW = cols === 1 ? innerWidth : Math.floor((innerWidth - 2) / 2);
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        const sx = st.current;
        if (sx.page === "picker") {
            const p = sx.picker;
            if (!p)
                return;
            if (key.name === "escape") {
                sx.page = "main";
                sx.picker = null;
                rerender();
                return;
            }
            if (p.list) {
                if (key.name === "up" || key.name === "k") {
                    p.cursor = Math.max(0, p.cursor - 1);
                    rerender();
                    return;
                }
                if (key.name === "down" || key.name === "j") {
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
                }
            }
            return;
        }
        if (sx.page === "preview") {
            if (key.name === "escape") {
                sx.page = "main";
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
        if (sx.page === "meta") {
            if (key.name === "escape") {
                key.preventDefault();
                saveMeta();
                sx.page = "main";
                sx.focus = null;
                rerender();
                return;
            }
            if (key.name === "tab" || key.name === "return") {
                key.preventDefault();
                nextMetaFocus(1);
                return;
            }
            if (key.name === "up") {
                key.preventDefault();
                nextMetaFocus(-1);
                return;
            }
            if (key.name === "down") {
                key.preventDefault();
                nextMetaFocus(1);
                return;
            }
            return;
        }
        if (sx.expOpen) {
            if (key.name === "escape") {
                key.preventDefault();
                closeExpense(false);
                return;
            }
            if (key.name === "tab") {
                key.preventDefault();
                sx.focus = sx.focus === "exp-amt" ? "exp-note" : "exp-amt";
                rerender();
                return;
            }
            return;
        }
        switch (key.name) {
            case "up":
            case "k":
                sx.dcur = Math.max(0, sx.dcur - cols);
                rerender();
                break;
            case "down":
            case "j":
                sx.dcur = Math.min(DENOMS.length - 1, sx.dcur + cols);
                rerender();
                break;
            case "left":
                sx.dcur = Math.max(0, sx.dcur - 1);
                rerender();
                break;
            case "right":
                sx.dcur = Math.min(DENOMS.length - 1, sx.dcur + 1);
                rerender();
                break;
            case "backspace": {
                const d = DENOMS[sx.dcur];
                sx.qty[d] = Math.floor((sx.qty[d] || 0) / 10);
                saveMeta();
                rerender();
                break;
            }
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
                sx.expOpen = true;
                sx.expAmt = sx.expense ? dots(sx.expense) : "";
                sx.expNote = sx.note;
                sx.focus = "exp-amt";
                rerender();
                break;
            case "b":
                doClear();
                break;
            case "r":
                void refreshSys();
                break;
            case "m":
                sx.page = "meta";
                sx.focus = "kasir";
                rerender();
                break;
            case "escape":
            case "h":
                onBack();
                break;
            default: {
                if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && /[0-9]/.test(key.sequence)) {
                    key.preventDefault();
                    const d = DENOMS[sx.dcur];
                    sx.qty[d] = Math.min(9999, (sx.qty[d] || 0) * 10 + parseInt(key.sequence, 10));
                    saveMeta();
                    rerender();
                }
                break;
            }
        }
    });
    const receipt = s.page === "preview"
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
    if (s.page === "picker") {
        const p = s.picker;
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: "send to pc \u2014 online only" }), _jsx("box", { flexGrow: 1, flexDirection: "column", paddingTop: 1, children: !p || p.list === null ? (_jsx("text", { fg: T.dim, children: "checking PCs..." })) : !p.list.length ? (_jsx("text", { fg: T.dim, children: "no PCs online. check wifi or add one in PCs (3)." })) : (p.list.map((c, i) => (_jsxs("box", { flexDirection: "row", children: [_jsx("text", { fg: i === p.cursor ? T.accent : T.faint, children: i === p.cursor ? ">" : " " }), _jsx("text", { fg: i === p.cursor ? T.text : T.dim, children: " " + clip(`${c.name}  ${c.base}`, width - 2) })] }, c.id)))) }), _jsx("text", { fg: T.faint, children: clip("enter send · esc back", width) })] }));
    }
    if (s.page === "preview") {
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: `receipt preview — ${s.size}mm` }), _jsx("text", { fg: T.faint, children: "v switch size" })] }), _jsx("scrollbox", { flexGrow: 1, width: "100%", children: receipt.split("\n").map((ln, i) => (_jsx("text", { fg: T.text, wrapMode: "none", children: ln || " " }, i))) }), _jsx("text", { fg: T.faint, children: clip("k send · v 58/80 · esc back", width) })] }));
    }
    if (s.page === "meta") {
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: "meta \u2014 cashier, branch, shift" }), _jsx("box", { flexDirection: "column", paddingTop: 1, gap: 1, children: META_FIELDS.map(([f, label]) => (_jsx(Field, { label: label, value: s[f], focus: s.focus === f, width: Math.max(12, Math.min(30, width - 12)), onInput: (v) => {
                            st.current[f] = v;
                        }, onSubmit: () => nextMetaFocus(1) }, f))) }), _jsx("box", { paddingTop: 1, children: _jsx("text", { fg: T.faint, children: clip("tab/enter/up/down move · esc save & back", width) }) }), _jsx("box", { flexGrow: 1 }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone })] }));
    }
    const kpis = [
        { label: "physical", value: rupiah(fisik) },
        { label: "system", value: s.hasSession ? rupiah(s.sysCash) : "—" },
        {
            label: "diff",
            value: !s.hasSession ? "—" : diff > 0 ? "+ " + rupiah(diff) : rupiah(diff),
            tone: (!s.hasSession ? "faint" : diff > 0 ? "ok" : diff < 0 ? "bad" : "faint"),
        },
        { label: "noncash", value: rupiah(s.noncash) },
        { label: "sales", value: rupiah(jual) },
        { label: "branch", value: s.cabang || "-" },
    ];
    function denomCell(d, on) {
        const q = s.qty[d] || 0;
        const sub = q * d;
        const spec = [
            { key: "d", min: 9, text: dots(d) },
            { key: "x", min: 4, align: "right", text: q ? "x" + q : "" },
            { key: "sub", min: 6, flex: 1, align: "right", text: sub ? rupiah(sub) : "" },
        ];
        return (_jsxs("box", { flexDirection: "row", width: cellW, children: [_jsx("text", { fg: on ? T.accent : T.faint, children: on ? ">" : " " }), _jsx("text", { fg: on ? T.text : T.dim, attributes: on ? TextAttributes.BOLD : undefined, children: formatRow(cellW - 1, spec) })] }));
    }
    const denomRows = [];
    for (let i = 0; i < DENOMS.length; i += cols)
        denomRows.push(DENOMS.slice(i, i + cols).map((_, j) => i + j));
    const sizeTag = `[${s.size}mm]`;
    const refreshHint = innerWidth < 40 ? "r" : "r refresh";
    const headerRoom = Math.max(0, innerWidth - sizeTag.length - refreshHint.length - 2);
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs(Panel, { title: "session", children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: T.accent, attributes: TextAttributes.BOLD, children: sizeTag }), _jsx("text", { fg: T.dim, children: clip(s.sessionLabel, headerRoom) })] }), _jsx("text", { fg: T.faint, children: refreshHint })] }), _jsx(KpiGrid, { items: kpis, width: innerWidth, cols: 3 }), _jsx("text", { fg: T.dim, children: clip(`${s.kasir || "-"} · ${(s.shift || "-").toUpperCase()}${s.kasir_id ? " · " + s.kasir_id : ""}   (m edit)`, innerWidth) })] }), _jsxs(Panel, { title: "denominations", grow: true, children: [_jsx("box", { flexGrow: 1, flexDirection: "column", children: denomRows.map((row, ri) => (_jsx("box", { flexDirection: "row", gap: 2, children: row.map((di) => (_jsx("box", { flexDirection: "row", children: denomCell(DENOMS[di], di === s.dcur) }, DENOMS[di]))) }, ri))) }), s.expOpen ? (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: T.dim, children: "expense" }), _jsx("input", { backgroundColor: T.surface, textColor: T.text, focusedBackgroundColor: T.surface, placeholderColor: T.faint, focused: s.focus === "exp-amt", value: s.expAmt, placeholder: "0", width: 12, onInput: (v) => {
                                    st.current.expAmt = v.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
                                    rerender();
                                }, onSubmit: () => {
                                    st.current.focus = "exp-note";
                                    rerender();
                                } }), _jsx(Field, { label: "note", value: s.expNote, focus: s.focus === "exp-note", width: 20, onInput: (v) => { st.current.expNote = v; }, onSubmit: () => closeExpense(true) }), _jsx("text", { fg: T.faint, children: "enter save · esc cancel" })] })) : (_jsx("text", { fg: T.dim, children: clip(s.expense || s.note ? `expense: ${rupiah(s.expense)}${s.note ? " · " + s.note : ""}  (e edit)` : "expense: —  (e edit)", innerWidth) })), _jsx(Msg, { text: clip(s.msg.t, innerWidth), tone: s.msg.tone })] })] }));
}
