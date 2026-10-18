import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { Field, KpiGrid, Msg } from "../ui.js";
import { clip, formatRow } from "../layout.js";
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
        sheetKey: null,
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
    function resolveSheet(useGas) {
        const s = st.current;
        if (!s.sheetKey)
            return;
        Conflict.resolve(s.cache, s.sheetKey, useGas);
        saveCache();
        s.sheetKey = null;
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
    const listLines = Math.max(1, Math.floor((dims.height - 12) / 1));
    const start = Math.max(0, Math.min(cursor - Math.floor(listLines / 2), rows.length - listLines));
    const visible = rows.slice(start, start + listLines);
    const status = s.syncing
        ? ["SYNC", "dim"]
        : Conflict.countConflicts(s.cache)
            ? [`CONF ${Conflict.countConflicts(s.cache)}`, "warn"]
            : s.lastError
                ? ["ERR", "bad"]
                : s.lastSync
                    ? [`OK ${s.lastSync}`, "ok"]
                    : [s.token ? "SIGNED IN" : "--", "faint"];
    function statusOf(it) {
        const stv = String(it.statusSelisih || "").toUpperCase();
        const v = Conflict.toInt(it.jumlahSelisih);
        if (stv === "KURANG" || v < 0)
            return { label: "short", tone: "bad" };
        if (stv === "LEBIH" || v > 0)
            return { label: "over", tone: "ok" };
        return { label: "even", tone: "faint" };
    }
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
        if (sx.sheetKey) {
            if (key.name === "l")
                resolveSheet(false);
            else if (key.name === "g")
                resolveSheet(true);
            else if (key.name === "escape" || key.name === "h") {
                sx.sheetKey = null;
                rerender();
            }
            return;
        }
        switch (key.name) {
            case "up":
            case "k":
                sx.cursor = Math.max(0, cursor - 1);
                rerender();
                break;
            case "down":
            case "j":
                sx.cursor = Math.min(Math.max(0, rows.length - 1), cursor + 1);
                rerender();
                break;
            case "return": {
                const row = rows[cursor];
                if (row && row._conflict) {
                    sx.sheetKey = Conflict.txKey(row);
                    rerender();
                }
                break;
            }
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
                openLogin();
                break;
            case "x":
                doLogout();
                break;
            case "escape":
            case "h":
                onBack();
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
    const conflictRow = s.sheetKey ? s.cache.find((it) => Conflict.txKey(it) === s.sheetKey) : null;
    if (conflictRow && conflictRow._conflict) {
        const k = conflictRow._conflict;
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("text", { fg: T.text, attributes: TextAttributes.BOLD, children: ["diff \u2014 ", conflictRow.tanggal || "--", " / ", conflictRow.shift || "--", " / ", conflictRow.cabang || "--"] }), _jsxs("box", { flexDirection: "column", paddingTop: 1, gap: 1, children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 7, children: _jsx("text", { fg: T.accent, children: "local" }) }), _jsx("text", { fg: T.dim, children: clip(fmt3(k.lokal), width - 8) })] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 7, children: _jsx("text", { fg: T.accent, children: "GAS" }) }), _jsx("text", { fg: T.dim, children: clip(fmt3(k.gas), width - 8) })] }), _jsx("text", { fg: T.faint, children: clip("K: computer | F: physical | S: difference", width) })] }), _jsx("box", { flexGrow: 1 }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone }), _jsx("text", { fg: T.faint, children: clip("l use local · g use GAS · esc back", width) })] }));
    }
    const kpis = [
        { label: "period", value: cur, tone: "accent" },
        { label: "tx", value: String(rows.length) },
        { label: "archive", value: String(s.cache.length) },
        { label: "short", value: rupiah(kurang), tone: (kurang ? "bad" : "faint") },
        { label: "over", value: rupiah(lebih), tone: (lebih ? "ok" : "faint") },
    ];
    function rowSpec(it) {
        const stv = statusOf(it);
        return [
            { key: "date", min: 10, text: it.tanggal || "--" },
            { key: "shift", min: 5, text: it.shift || "--" },
            { key: "status", min: 5, text: stv.label },
            { key: "s", min: 10, align: "right", text: rupiah(it.jumlahSelisih) },
            { key: "k", min: 10, align: "right", text: rupiah(it.totalKomputer) },
            { key: "f", min: 10, align: "right", text: rupiah(it.uangFisik) },
            { key: "branch", min: 4, flex: 1, text: (it._conflict ? "diff " : "") + (it.cabang || "") },
        ];
    }
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: "deposits \u2014 GAS" }), _jsx("text", { fg: T[status[1]], children: `[${status[0]}]` })] }), _jsx("text", { fg: T.faint, children: s.autoLogin ? "connecting to GAS..." : s.syncing ? "syncing..." : "r sync" })] }), _jsx(KpiGrid, { items: kpis, width: width }), _jsx("text", { fg: T.dim, children: clip(s.token
                    ? `signed in as ${s.email} · cashier: ${s.cashier || "-"}`
                    : s.cache.length
                        ? `${s.email || "--"} (cache, not signed in)`
                        : "not signed in — press g", width) }), s.offline ? _jsx("text", { fg: T.warn, children: clip(s.offline + " — r to retry", width) }) : null, _jsxs("box", { flexGrow: 1, flexDirection: "column", paddingTop: 1, children: [!rows.length ? (_jsx("text", { fg: T.faint, children: "no transactions this period." })) : (visible.map((it, i) => {
                        const idx = start + i;
                        const on = idx === cursor;
                        const stv = statusOf(it);
                        const line = formatRow(Math.max(0, width - 2), rowSpec(it));
                        return (_jsxs("box", { flexDirection: "row", children: [_jsx("text", { fg: on ? T.accent : T.faint, children: on ? ">" : " " }), _jsx("text", { fg: stv.label === "short" ? T.bad : on ? T.text : T.dim, attributes: on ? TextAttributes.BOLD : undefined, children: " " + line })] }, (it.tanggal || "") + i));
                    })), rows.length > visible.length ? (_jsx("text", { fg: T.faint, children: clip(`... ${rows.length} rows (scroll up/down)`, width) })) : null] }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone }), _jsx("text", { fg: T.faint, children: clip("enter diff · r sync · g account · x sign out · esc back", width) })] }));
}
function fmt3(o) {
    return `K: ${rupiah(o.totalKomputer)} | F: ${rupiah(o.uangFisik)} | S: ${rupiah(o.jumlahSelisih)}`;
}
