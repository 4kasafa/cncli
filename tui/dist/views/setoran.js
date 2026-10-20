import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { Field, KpiGrid, Msg, Panel } from "../ui.js";
import { clip, planColumns } from "../layout.js";
import { reportAmountText, reportBranchLabel, reportDateLabel, reportStatusLine } from "../rootinfo.js";
import * as Gas from "../gas.js";
import * as Store from "../store.js";
import * as Conflict from "../conflict.js";
import { rupiah, nowStamp } from "../fmt.js";
export function SetoranView({ onBack, onTextMode }) {
    const st = useRef({
        email: "",
        pass: "",
        remember: false,
        token: null,
        cashier: "",
        cache: [],
        lastSync: null,
        lastError: null,
        syncing: false,
        syncSeq: 0,
        page: "main",
        autoLogin: false,
        cursor: 0,
        focus: null,
        offline: null,
        detailOpen: false,
        msg: { t: "", tone: "dim" },
    });
    const [, bump] = useState(0);
    const rerender = () => bump((n) => n + 1);
    const dims = useTerminalDimensions();
    useEffect(() => {
        onTextMode?.(st.current.page === "login");
    });
    function say(t, tone) {
        st.current.msg = { t, tone };
    }
    function loadCache(em, cash) {
        const s = st.current;
        const b = Store.loadArchiveBucket(em, cash);
        s.cache = b.data;
        s.lastSync = b.last_sync || null;
        s.cashier = b.cashier || cash;
    }
    function saveCache() {
        const s = st.current;
        if (!s.email)
            return;
        Store.saveArchiveBucket(s.email, { cashier: s.cashier, last_sync: s.lastSync, data: s.cache });
    }
    function openLogin() {
        const s = st.current;
        s.page = "login";
        s.autoLogin = false;
        s.syncSeq++;
        s.focus = "email";
        rerender();
    }
    async function doLogin() {
        const s = st.current;
        const em = s.email.trim().toLowerCase();
        const pw = s.pass;
        if (!em || !pw) {
            say("email and password are required.", "bad");
            rerender();
            return;
        }
        say("contacting GAS...", "dim");
        rerender();
        const my = ++s.syncSeq;
        const res = await Gas.login(em, pw);
        const s2 = st.current;
        if (my !== s2.syncSeq)
            return;
        s2.autoLogin = false;
        if (!res.success) {
            say("failed: " + (res.message || "no response"), "bad");
            s2.page = "login";
            s2.focus = "pass";
            rerender();
            return;
        }
        if (s2.remember)
            Store.saveCreds(em, pw);
        else
            Store.clearCreds();
        s2.token = res.token || null;
        s2.email = em;
        s2.cashier = (res.user && typeof res.user === "object" && res.user.name) || em.split("@")[0];
        s2.offline = null;
        say("signed in.", "ok");
        s2.page = "main";
        s2.focus = null;
        loadCache(em, s2.cashier);
        rerender();
        void syncGas();
    }
    async function syncGas() {
        const s = st.current;
        if (!s.token || s.syncing)
            return;
        s.syncing = true;
        s.lastError = null;
        const seq = ++s.syncSeq;
        rerender();
        const res = await Gas.fetchKasirSummary(s.email, s.pass, s.cashier);
        const s2 = st.current;
        if (seq !== s2.syncSeq)
            return;
        s2.syncing = false;
        if (!res.success) {
            s2.lastError = res.message || "no response";
            if (!s2.cache.length)
                say("failed: " + s2.lastError + " — check connection, then r.", "bad");
            else
                s2.offline = "sync failed: " + s2.lastError;
            rerender();
            return;
        }
        s2.offline = null;
        Conflict.mergeGasData(s2.cache, res.data);
        s2.lastSync = nowStamp();
        if (res.user)
            s2.cashier = typeof res.user === "object" ? res.user.name || s2.cashier : String(res.user);
        saveCache();
        rerender();
    }
    function doLogout() {
        const s = st.current;
        s.token = null;
        s.pass = "";
        s.autoLogin = false;
        s.syncing = false;
        s.syncSeq++;
        s.lastError = null;
        s.cache = [];
        s.lastSync = null;
        s.offline = null;
        openLogin();
    }
    function resolveDetail(row, useGas) {
        const s = st.current;
        if (!row || !row._conflict)
            return;
        Conflict.resolve(s.cache, Conflict.txKey(row), useGas);
        saveCache();
        s.detailOpen = false;
        say(useGas ? "resolved using GAS." : "resolved using local.", "ok");
        rerender();
    }
    useEffect(() => {
        const c = Store.loadCreds();
        if (c) {
            const s = st.current;
            s.email = c.email;
            s.pass = c.password;
            s.remember = true;
            s.autoLogin = true;
            loadCache(c.email, "");
            rerender();
            void doLogin();
        }
        else {
            st.current.page = "login";
            st.current.focus = "email";
            rerender();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const s = st.current;
    const width = Math.max(20, dims.width - 2);
    const innerWidth = Math.max(10, width - 4);
    const cur = Conflict.currentPeriode();
    const rows = s.cache
        .filter((it) => {
        const p = Conflict.periodeOf(it && it.tanggal);
        return p === null || p === cur;
    })
        .sort((a, b) => {
        const da = Conflict.parseDate(a && a.tanggal);
        const db = Conflict.parseDate(b && b.tanggal);
        return (db ? db.getTime() : -1) - (da ? da.getTime() : -1);
    });
    let kurang = 0;
    let lebih = 0;
    for (const it of rows) {
        const v = Conflict.toInt(it.jumlahSelisih);
        if (v < 0)
            kurang += Math.abs(v);
        else if (v > 0)
            lebih += v;
    }
    const cursor = Math.min(Math.max(0, s.cursor), Math.max(0, rows.length - 1));
    const detailRow = s.detailOpen ? rows[cursor] : undefined;
    const detailLines = detailRow ? (detailRow._conflict ? 3 : 1) : 0;
    const listLines = Math.max(1, Math.floor(dims.height - 16 - detailLines));
    const start = Math.max(0, Math.min(cursor - Math.floor(listLines / 2), rows.length - listLines));
    const visible = rows.slice(start, start + listLines);
    const syncText = s.syncing
        ? "SYNC"
        : s.lastError
            ? "ERR"
            : s.lastSync
                ? "OK " + s.lastSync.slice(0, 5) + " " + s.lastSync.slice(11, 16)
                : s.token
                    ? "SIGNED IN"
                    : "--";
    const syncTone = s.syncing ? "dim" : s.lastError ? "bad" : s.lastSync ? "ok" : s.token ? "text" : "faint";
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        const sx = st.current;
        if (sx.page === "login") {
            if (key.name === "escape") {
                key.preventDefault();
                sx.page = "main";
                sx.focus = null;
                rerender();
                return;
            }
            if (key.name === "tab") {
                key.preventDefault();
                sx.focus = sx.focus === "email" ? "pass" : sx.focus === "pass" ? "remember" : "email";
                rerender();
                return;
            }
            if (sx.focus === "remember") {
                if (key.name === "space" || key.name === "return") {
                    key.preventDefault();
                    sx.remember = !sx.remember;
                    rerender();
                    return;
                }
                return;
            }
            if (key.name === "return") {
                key.preventDefault();
                void doLogin();
                return;
            }
            if (sx.focus === "pass") {
                if (key.name === "backspace") {
                    sx.pass = sx.pass.slice(0, -1);
                    rerender();
                    return;
                }
                if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
                    sx.pass += key.sequence;
                    rerender();
                }
            }
            return;
        }
        switch (key.name) {
            case "up":
            case "k":
                sx.detailOpen = false;
                sx.cursor = Math.max(0, cursor - 1);
                rerender();
                break;
            case "down":
            case "j":
                sx.detailOpen = false;
                sx.cursor = Math.min(Math.max(0, rows.length - 1), cursor + 1);
                rerender();
                break;
            case "return":
                key.preventDefault();
                sx.detailOpen = !sx.detailOpen;
                rerender();
                break;
            case "l":
                if (sx.detailOpen)
                    resolveDetail(rows[cursor], false);
                break;
            case "r":
                if (!sx.token) {
                    say("sign in first.", "bad");
                    openLogin();
                }
                else {
                    loadCache(sx.email, sx.cashier);
                    rerender();
                    void syncGas();
                }
                break;
            case "g":
                if (sx.detailOpen) {
                    const row = rows[cursor];
                    if (row && row._conflict)
                        resolveDetail(row, true);
                }
                else {
                    openLogin();
                }
                break;
            case "x":
                doLogout();
                break;
            case "escape":
            case "h":
                if (sx.detailOpen) {
                    sx.detailOpen = false;
                    rerender();
                }
                else {
                    onBack();
                }
                break;
        }
    });
    if (s.page === "login") {
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: "sign in \u2014 GAS" }), _jsxs("box", { flexDirection: "column", paddingTop: 1, gap: 1, children: [_jsx(Field, { label: "email", value: s.email, focus: s.focus === "email", placeholder: "name@email.com", width: Math.max(12, Math.min(34, width - 12)), onInput: (v) => {
                                st.current.email = v;
                                rerender();
                            }, onSubmit: () => {
                                st.current.focus = "pass";
                                rerender();
                            } }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 8, children: _jsx("text", { fg: s.focus === "pass" ? T.text : T.dim, children: "pass" }) }), _jsx("text", { fg: T.text, children: "•".repeat(s.pass.length) + (s.focus === "pass" ? "█" : "") })] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 8, children: _jsx("text", { fg: T.faint, children: "remember" }) }), _jsx("text", { fg: s.focus === "remember" ? T.text : T.dim, children: `[${s.remember ? "x" : " "}] on this device (creds.json 600)` })] })] }), _jsx("box", { paddingTop: 1, children: _jsx("text", { fg: T.faint, children: clip("tab move · enter sign in · esc back", width) }) }), _jsx("box", { flexGrow: 1 }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone })] }));
    }
    const kpis = [
        { label: "period", value: cur },
        { label: "tx", value: String(rows.length) },
        { label: "over", value: rupiah(lebih), tone: (lebih ? "ok" : "faint") },
        { label: "short", value: rupiah(kurang), tone: (kurang ? "bad" : "faint") },
    ];
    const amountMin = Math.max(11, ...rows.map((it) => reportAmountText(it).length));
    function rowSpec(it) {
        return [
            { key: "when", min: 12, text: reportDateLabel(it.tanggal, it.shift) },
            { key: "amount", min: amountMin, text: reportAmountText(it) },
            { key: "branch", min: 8, flex: 1, text: reportBranchLabel(it.cabang) },
        ];
    }
    function renderRow(it, on, i) {
        const specs = rowSpec(it);
        const widths = planColumns(Math.max(0, innerWidth - 6), specs);
        const cells = specs.map((sp, ci) => clip(sp.text ?? "", widths[ci]).padEnd(widths[ci]));
        const st = reportStatusLine(it);
        const tone = st.label === "SHORT" ? "bad" : st.label === "OVER" ? "ok" : "dim";
        return (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { flexDirection: "row", children: [_jsx("text", { fg: on ? T.accent : T.faint, children: on ? ">" : " " }), _jsx("text", { fg: T[tone], attributes: on ? TextAttributes.BOLD : undefined, children: " " + cells[0] }), _jsx("text", { fg: T[tone], attributes: on ? TextAttributes.BOLD : undefined, children: " " + cells[1] }), _jsx("text", { fg: T[tone], attributes: on ? TextAttributes.BOLD : undefined, children: "   " + cells[2] })] }), on && s.detailOpen ? (_jsx("box", { flexDirection: "column", paddingLeft: 2, children: it._conflict ? (_jsxs(_Fragment, { children: [_jsx("text", { fg: T.dim, children: clip("local " + fmt3(it._conflict.lokal), innerWidth - 2) }), _jsx("text", { fg: T.dim, children: clip("GAS   " + fmt3(it._conflict.gas), innerWidth - 2) }), _jsx("text", { fg: T.faint, children: clip("l use local · g use GAS · enter close", innerWidth - 2) })] })) : (_jsx("text", { fg: T.dim, children: clip(fmt3({
                            totalKomputer: Conflict.toInt(it.totalKomputer),
                            uangFisik: Conflict.toInt(it.uangFisik),
                            jumlahSelisih: Conflict.toInt(it.jumlahSelisih),
                        }), innerWidth - 2) })) })) : null] }, (it.tanggal || "") + i));
    }
    const note = [s.msg.t, s.offline ? s.offline + " — r to retry" : ""].filter(Boolean).join(" · ");
    const noteTone = s.offline ? "warn" : s.msg.tone;
    const emailRoom = Math.max(0, innerWidth - syncText.length - 1);
    const hint = s.detailOpen && detailRow?._conflict
        ? "enter close · l local · g GAS · esc back"
        : "enter diff · r sync · g account · x sign out · esc back";
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs(Panel, { title: "summary", children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsx("text", { fg: T.accent, attributes: TextAttributes.BOLD, children: clip(s.email || "--", emailRoom) }), _jsx("text", { fg: T[syncTone], attributes: TextAttributes.BOLD, children: clip(syncText, innerWidth) })] }), _jsx(KpiGrid, { items: kpis, width: innerWidth, cols: 2 })] }), _jsxs(Panel, { title: "transactions", grow: true, children: [_jsxs("box", { flexGrow: 1, flexDirection: "column", children: [!rows.length ? (_jsx("text", { fg: T.faint, children: "no transactions this period." })) : (visible.map((it, i) => renderRow(it, start + i === cursor, start + i))), rows.length > visible.length ? (_jsx("text", { fg: T.faint, children: clip(`... ${rows.length} rows (scroll up/down)`, innerWidth) })) : null] }), _jsx("text", { fg: T.faint, children: clip(hint, innerWidth) }), _jsx(Msg, { text: clip(note, innerWidth), tone: noteTone })] })] }));
}
function fmt3(o) {
    return `K: ${rupiah(o.totalKomputer)} · F: ${rupiah(o.uangFisik)} · S: ${rupiah(o.jumlahSelisih)}`;
}
