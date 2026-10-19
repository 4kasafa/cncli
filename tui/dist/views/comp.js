import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { Field, Msg } from "../ui.js";
import { clip } from "../layout.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
function badgeOf(st) {
    if (st.state === "ok")
        return { label: "ok", tone: "ok" };
    if (st.state === "lama")
        return { label: "stale", tone: "ok" };
    if (st.state === "putus")
        return { label: "down", tone: "bad" };
    return { label: "--", tone: "dim" };
}
export function CompView({ onBack, onTextMode }) {
    const st = useRef({
        page: "list",
        list: [],
        active: {},
        cursor: 0,
        editingId: null,
        newName: "",
        newBase: "",
        edName: "",
        edBase: "",
        focus: null,
        pendingDel: null,
        ctlId: null,
        ctlBusy: false,
        detail: null,
        ctlBadge: { label: "--", tone: "dim" },
        ctlStatusLine: "",
        watcherEnabled: null,
        pendingAction: null,
        pin: "",
        wipeConfirm: "",
        pinFocus: "pin",
        logLines: null,
        msg: { t: "", tone: "dim" },
        ctlMsg: { t: "", tone: "dim" },
    });
    const [, bump] = useState(0);
    const rerender = () => bump((n) => n + 1);
    const dims = useTerminalDimensions();
    useEffect(() => {
        const s = st.current;
        onTextMode?.(s.page === "add" || s.page === "edit" || s.pendingAction !== null);
    });
    function say(t, tone) {
        st.current.msg = { t, tone };
    }
    function ctlSay(t, tone) {
        st.current.ctlMsg = { t, tone };
    }
    async function refreshList() {
        const s = st.current;
        s.list = Comps.list();
        for (const c of s.list)
            s.active[c.id] = await Store.isCompInOpenSession(c.id);
        rerender();
    }
    function checkAllNow() {
        const s = st.current;
        say("checking all PCs...", "dim");
        rerender();
        void Comps.checkAll().then(() => {
            st.current.list = Comps.list();
            say("", "dim");
            rerender();
        });
    }
    useEffect(() => {
        void refreshList();
        checkAllNow();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    function openCtl(id) {
        const s = st.current;
        s.page = "ctl";
        s.ctlId = id;
        s.detail = null;
        s.watcherEnabled = null;
        s.logLines = null;
        s.pendingAction = null;
        s.pin = "";
        s.wipeConfirm = "";
        s.pinFocus = "pin";
        ctlSay("", "dim");
        rerender();
        void ctlLoad();
    }
    function closeCtl() {
        const s = st.current;
        s.page = "list";
        s.ctlId = null;
        s.pendingAction = null;
        rerender();
        void refreshList();
    }
    async function ctlLoad() {
        const s = st.current;
        if (!s.ctlId)
            return;
        const c = Comps.get(s.ctlId);
        if (!c) {
            closeCtl();
            return;
        }
        s.ctlBusy = true;
        rerender();
        try {
            const r = await Lan.statusGet(c.base);
            const sx = st.current;
            if (sx.ctlId !== c.id)
                return;
            if (!r.ok && r.error === Lan.ERR_LEGACY) {
                const h = await Lan.health(c.base);
                sx.ctlStatusLine = h.ok ? "legacy PC: update firmware first" : "PC not reachable";
                sx.ctlBadge = { label: h.ok ? "stale" : "down", tone: h.ok ? "ok" : "bad" };
                sx.watcherEnabled = null;
                sx.detail = null;
                return;
            }
            if (!r.ok) {
                sx.ctlStatusLine = c.base;
                sx.ctlBadge = { label: "down", tone: "bad" };
                sx.watcherEnabled = null;
                ctlSay(r.error || "failed", "bad");
                return;
            }
            const d = (r.data || {});
            sx.detail = d;
            sx.ctlStatusLine = "v" + (d.version || "?") + " · " + (d.ip || "?") + ":" + (d.port || "?");
            sx.ctlBadge = { label: "ok", tone: "ok" };
            sx.watcherEnabled = !!d.watcher_enabled;
            ctlSay("", "dim");
        }
        finally {
            const sx = st.current;
            sx.ctlBusy = false;
            rerender();
        }
    }
    async function setWatcher(enabled) {
        const s = st.current;
        if (!s.ctlId)
            return;
        const c = Comps.get(s.ctlId);
        if (!c)
            return;
        if (!s.pin) {
            ctlSay("fill the pin first.", "bad");
            rerender();
            return;
        }
        s.ctlBusy = true;
        rerender();
        const r = await Lan.watcherSet(c.base, s.pin, enabled);
        const sx = st.current;
        sx.ctlBusy = false;
        if (r.ok) {
            const d = (r.data || {});
            sx.watcherEnabled = !!d.enabled;
            ctlSay("watcher " + (d.enabled ? "on" : "off"), "ok");
            sx.pendingAction = null;
            sx.pin = "";
        }
        else {
            ctlSay(r.error || "failed", "bad");
            if (r.status === 403 || r.status === 429)
                sx.pin = "";
        }
        rerender();
    }
    async function doWipe() {
        const s = st.current;
        if (!s.ctlId)
            return;
        const c = Comps.get(s.ctlId);
        if (!c)
            return;
        if (await Store.isCompInOpenSession(s.ctlId)) {
            ctlSay("pc is in an active session: close the session first", "bad");
            rerender();
            return;
        }
        s.ctlBusy = true;
        rerender();
        const r = await Lan.wipe(c.base, s.pin, s.wipeConfirm);
        const sx = st.current;
        sx.ctlBusy = false;
        if (r.ok) {
            const n = r.data?.deleted;
            ctlSay("deleted " + (n == null ? "?" : n), "ok");
            sx.pendingAction = null;
            sx.pin = "";
            sx.wipeConfirm = "";
        }
        else {
            ctlSay(r.error || "failed", "bad");
            if (r.status === 400)
                sx.wipeConfirm = "";
            else if (r.status === 403 || r.status === 429)
                sx.pin = "";
        }
        rerender();
    }
    async function loadLog() {
        const s = st.current;
        if (!s.ctlId)
            return;
        const c = Comps.get(s.ctlId);
        if (!c)
            return;
        if (!s.pin) {
            ctlSay("fill the pin first.", "bad");
            rerender();
            return;
        }
        s.ctlBusy = true;
        rerender();
        const r = await Lan.logGet(c.base, s.pin, 200);
        const sx = st.current;
        sx.ctlBusy = false;
        if (r.ok) {
            const lines = r.data?.lines;
            sx.logLines = Array.isArray(lines) && lines.length ? lines : ["(empty)"];
            sx.pendingAction = null;
            sx.pin = "";
            sx.page = "log";
            ctlSay("", "dim");
        }
        else {
            ctlSay(r.error || "failed", "bad");
            if (r.status === 403 || r.status === 429)
                sx.pin = "";
        }
        rerender();
    }
    function saveAdd() {
        const s = st.current;
        const r = Comps.add(s.newName, s.newBase);
        if (!r.ok) {
            say(r.error || "failed", "bad");
            rerender();
            return;
        }
        s.page = "list";
        s.focus = null;
        s.newName = "";
        s.newBase = "";
        say("added " + (r.comp?.name || ""), "ok");
        void refreshList();
        checkAllNow();
    }
    function saveEdit() {
        const s = st.current;
        if (!s.editingId)
            return;
        const r = Comps.upsert(s.editingId, s.edName, s.edBase);
        if (!r.ok) {
            say(r.error || "failed", "bad");
            rerender();
            return;
        }
        s.page = "list";
        s.focus = null;
        s.editingId = null;
        say("updated", "ok");
        void refreshList();
        checkAllNow();
    }
    async function deleteAt(id) {
        const s = st.current;
        if (await Store.isCompInOpenSession(id)) {
            say("pc is used by an active session, close it first", "bad");
            rerender();
            return;
        }
        Comps.remove(id);
        s.pendingDel = null;
        s.editingId = null;
        say("deleted", "ok");
        void refreshList();
    }
    const s = st.current;
    const width = Math.max(20, dims.width - 2);
    const cursor = Math.min(Math.max(0, s.cursor), Math.max(0, s.list.length - 1));
    const listLines = Math.max(1, Math.floor((dims.height - 7) / 1));
    const start = Math.max(0, Math.min(cursor - Math.floor(listLines / 2), s.list.length - listLines));
    const visible = s.list.slice(start, start + listLines);
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        const sx = st.current;
        if (sx.page === "add" || sx.page === "edit") {
            if (key.name === "escape") {
                key.preventDefault();
                sx.page = "list";
                sx.focus = null;
                sx.editingId = null;
                rerender();
                return;
            }
            if (key.name === "tab" || key.name === "down" || key.name === "return") {
                key.preventDefault();
                if (sx.focus === "name")
                    sx.focus = "base";
                else
                    sx.page === "add" ? saveAdd() : saveEdit();
                rerender();
                return;
            }
            if (key.name === "up") {
                key.preventDefault();
                sx.focus = "name";
                rerender();
                return;
            }
            return;
        }
        if (sx.page === "log") {
            if (key.name === "escape" || key.name === "h") {
                sx.page = "ctl";
                rerender();
            }
            return;
        }
        if (sx.page === "ctl") {
            if (sx.pendingAction) {
                if (key.name === "escape") {
                    sx.pendingAction = null;
                    sx.pin = "";
                    sx.wipeConfirm = "";
                    sx.pinFocus = "pin";
                    rerender();
                    return;
                }
                if (key.name === "tab" && sx.pendingAction === "wipe") {
                    sx.pinFocus = sx.pinFocus === "pin" ? "confirm" : "pin";
                    rerender();
                    return;
                }
                if (key.name === "backspace") {
                    if (sx.pendingAction === "wipe" && sx.pinFocus === "confirm")
                        sx.wipeConfirm = sx.wipeConfirm.slice(0, -1);
                    else
                        sx.pin = sx.pin.slice(0, -1);
                    rerender();
                    return;
                }
                if (key.name === "return") {
                    if (sx.pendingAction === "wipe") {
                        if (sx.pinFocus === "pin" && sx.pin) {
                            sx.pinFocus = "confirm";
                            rerender();
                            return;
                        }
                        void doWipe();
                        return;
                    }
                    if (sx.pendingAction === "w-on")
                        void setWatcher(true);
                    else if (sx.pendingAction === "w-off")
                        void setWatcher(false);
                    else if (sx.pendingAction === "log")
                        void loadLog();
                    return;
                }
                if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
                    if (sx.pendingAction === "wipe" && sx.pinFocus === "confirm")
                        sx.wipeConfirm += key.sequence.toUpperCase();
                    else
                        sx.pin += key.sequence;
                    rerender();
                }
                return;
            }
            switch (key.name) {
                case "w":
                    sx.pendingAction = "w-on";
                    sx.pin = "";
                    rerender();
                    break;
                case "m":
                    sx.pendingAction = "w-off";
                    sx.pin = "";
                    rerender();
                    break;
                case "l":
                    sx.pendingAction = "log";
                    sx.pin = "";
                    rerender();
                    break;
                case "x":
                    sx.pendingAction = "wipe";
                    sx.pin = "";
                    sx.wipeConfirm = "";
                    sx.pinFocus = "pin";
                    rerender();
                    break;
                case "r":
                    void ctlLoad();
                    break;
                case "escape":
                case "h":
                    closeCtl();
                    break;
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
                sx.cursor = Math.min(Math.max(0, sx.list.length - 1), cursor + 1);
                rerender();
                break;
            case "return": {
                const row = sx.list[cursor];
                if (row)
                    openCtl(row.id);
                break;
            }
            case "a":
                sx.page = "add";
                sx.editingId = null;
                sx.newName = "";
                sx.newBase = "";
                sx.focus = "name";
                say("", "dim");
                rerender();
                break;
            case "e": {
                const row = sx.list[cursor];
                if (row) {
                    sx.page = "edit";
                    sx.editingId = row.id;
                    sx.edName = row.name;
                    sx.edBase = row.base;
                    sx.focus = "name";
                    rerender();
                }
                break;
            }
            case "d": {
                key.preventDefault();
                const row = sx.list[cursor];
                if (!row)
                    break;
                if (sx.pendingDel === row.id)
                    void deleteAt(row.id);
                else {
                    sx.pendingDel = row.id;
                    say("press d again to delete " + row.name, "bad");
                    rerender();
                }
                break;
            }
            case "r":
                checkAllNow();
                break;
            case "escape":
            case "h":
                onBack();
                break;
        }
    });
    if (s.page === "add" || s.page === "edit") {
        const isAdd = s.page === "add";
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: isAdd ? "add pc" : "edit pc — " + (s.edName || "") }), _jsxs("box", { flexDirection: "column", paddingTop: 1, gap: 1, children: [_jsx(Field, { label: "name", value: isAdd ? s.newName : s.edName, focus: s.focus === "name", placeholder: "kasir 1", width: Math.max(12, Math.min(30, width - 12)), onInput: (v) => {
                                if (isAdd)
                                    st.current.newName = v;
                                else
                                    st.current.edName = v;
                            }, onSubmit: () => {
                                st.current.focus = "base";
                                rerender();
                            } }), _jsx(Field, { label: "address", value: isAdd ? s.newBase : s.edBase, focus: s.focus === "base", placeholder: "http://192.168.1.5:8765", width: Math.max(12, Math.min(36, width - 12)), onInput: (v) => {
                                if (isAdd)
                                    st.current.newBase = v;
                                else
                                    st.current.edBase = v;
                            }, onSubmit: () => (isAdd ? saveAdd() : saveEdit()) })] }), _jsx("box", { paddingTop: 1, children: _jsx("text", { fg: T.faint, children: clip("tab/enter move · enter on address saves · esc cancels", width) }) }), _jsx("box", { flexGrow: 1 }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone })] }));
    }
    if (s.page === "log") {
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsxs("text", { fg: T.text, attributes: TextAttributes.BOLD, children: ["log \u2014 ", Comps.byName(s.ctlId)] }), _jsx("text", { fg: T.faint, children: "last 200 lines" })] }), _jsx("scrollbox", { flexGrow: 1, width: "100%", children: (s.logLines || ["(empty)"]).map((ln, i) => (_jsx("text", { fg: T.dim, wrapMode: "none", children: ln || " " }, i))) }), _jsx("text", { fg: T.faint, children: clip("esc back", width) })] }));
    }
    if (s.page === "ctl") {
        const c = Comps.get(s.ctlId);
        const d = s.detail;
        const kv = [];
        if (d) {
            kv.push(["status", s.ctlStatusLine]);
            kv.push(["watcher", (d.watcher_enabled ? "on" : "off") + (d.watcher_alive ? " (alive)" : " (dead)")]);
            kv.push(["store", d.ketoko ? "present" : "absent"]);
            kv.push(["today", (d.count_today == null ? "?" : String(d.count_today)) + " tx" + (d.last_no ? " · last no " + String(d.last_no) : "")]);
            if (d.uptime_s != null)
                kv.push(["uptime", Math.round(Number(d.uptime_s)) + "s"]);
            if (d.db_busy)
                kv.push(["db", "busy"]);
        }
        else {
            kv.push(["status", s.ctlBusy ? "loading..." : s.ctlStatusLine || "--"]);
        }
        const pendingLabel = s.pendingAction === "w-on" ? "watcher pin" : s.pendingAction === "w-off" ? "watcher pin" : s.pendingAction === "wipe" ? "wipe pin" : s.pendingAction === "log" ? "log pin" : "";
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsxs("text", { fg: T.text, attributes: TextAttributes.BOLD, children: ["control: ", c?.name || "--"] }), _jsx("text", { fg: T[s.ctlBadge.tone], children: `[${s.ctlBadge.label}]` })] }), _jsx("text", { fg: T.faint, children: clip(c?.base || "", Math.max(0, Math.floor(width / 2))) })] }), _jsx("box", { flexDirection: "column", paddingTop: 1, children: kv.map(([k, v]) => (_jsxs("box", { flexDirection: "row", children: [_jsx("box", { width: 9, children: _jsx("text", { fg: T.faint, children: k }) }), _jsx("text", { fg: T.dim, children: clip(v, width - 10) })] }, k))) }), s.pendingAction ? (_jsxs("box", { flexDirection: "column", paddingTop: 1, gap: 1, children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 14, children: _jsx("text", { fg: s.pinFocus === "pin" ? T.text : T.dim, children: pendingLabel }) }), _jsx("text", { fg: T.text, children: "•".repeat(s.pin.length) + (s.pinFocus === "pin" ? "█" : "") })] }), s.pendingAction === "wipe" ? (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 14, children: _jsx("text", { fg: s.pinFocus === "confirm" ? T.text : T.dim, children: "type WIPE" }) }), _jsx("text", { fg: T.text, children: s.wipeConfirm + (s.pinFocus === "confirm" ? "█" : "") })] })) : null, _jsx("text", { fg: T.faint, children: clip(s.pendingAction === "wipe" ? "type · enter next/send · esc cancel" : "type pin · enter send · esc cancel", width) })] })) : (_jsx("box", { paddingTop: 1, children: _jsx("text", { fg: T.faint, children: clip("w watcher on · m watcher off · l log · x wipe · r refresh · esc back", width) }) })), _jsx("box", { flexGrow: 1 }), _jsx(Msg, { text: s.ctlMsg.t, tone: s.ctlMsg.tone })] }));
    }
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsxs("text", { fg: T.text, attributes: TextAttributes.BOLD, children: ["PCs (", s.list.length, ")"] }), _jsx("text", { fg: T.faint, children: "a add \u00B7 r recheck" })] }), _jsx("box", { flexGrow: 1, flexDirection: "column", paddingTop: 1, children: s.list.length ? (visible.map((c, i) => {
                    const idx = start + i;
                    const on = idx === cursor;
                    const b = badgeOf(Comps.st(c.id));
                    const suffix = (s.active[c.id] ? " · session" : "") + (s.pendingDel === c.id ? " · delete? d" : "");
                    const line = clip(`${c.name} [${b.label}] ${c.base}${suffix}`, width - 2);
                    return (_jsxs("box", { flexDirection: "row", children: [_jsx("text", { fg: on ? T.accent : T.faint, children: on ? ">" : " " }), _jsx("text", { fg: b.label === "down" ? T.bad : on ? T.text : T.dim, attributes: on ? TextAttributes.BOLD : undefined, children: " " + line })] }, c.id));
                })) : (_jsx("text", { fg: T.faint, children: "no PCs yet \u2014 press a to add one." })) }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone }), _jsx("text", { fg: T.faint, children: clip("enter control · a add · e edit · d delete (2x) · esc back", width) })] }));
}
