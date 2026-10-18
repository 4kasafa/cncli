import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "../theme.js";
import { Field, Msg, Sel, Tag } from "../ui.js";
import { viewKey } from "../keymap.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
function badgeOf(st) {
    if (st.state === "ok")
        return { label: "[ok]", tone: "ok" };
    if (st.state === "lama")
        return { label: "[OK·lama]", tone: "ok" };
    if (st.state === "putus")
        return { label: "[PUTUS]", tone: "bad" };
    return { label: "[--]", tone: "dim" };
}
export function CompView({ onView }) {
    const st = useRef({
        list: [],
        active: {},
        cursor: 0,
        adding: false,
        editingId: null,
        newName: "",
        newBase: "",
        edName: "",
        edBase: "",
        pendingDel: null,
        ctlId: null,
        ctlBusy: false,
        detail: null,
        ctlBadge: { label: "[--]", tone: "dim" },
        ctlStatusLine: "",
        watcherEnabled: null,
        watchPin: "",
        wipePin: "",
        wipeConfirm: "",
        logPin: "",
        logLines: null,
        focus: null,
        msg: { t: "", tone: "dim" },
        ctlMsg: { t: "", tone: "dim" },
    });
    const [, bump] = useState(0);
    const rerender = () => bump((n) => n + 1);
    const dims = useTerminalDimensions();
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
        say("cek semua PC…", "dim");
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
        s.ctlId = id;
        s.detail = null;
        s.watcherEnabled = null;
        s.logLines = null;
        s.watchPin = "";
        s.wipePin = "";
        s.wipeConfirm = "";
        s.logPin = "";
        s.focus = null;
        ctlSay("", "dim");
        rerender();
        void ctlLoad();
    }
    function closeCtl() {
        const s = st.current;
        s.ctlId = null;
        s.focus = null;
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
            if (!r.ok && r.error === "PC versi lama, update dulu") {
                const h = await Lan.health(c.base);
                sx.ctlStatusLine = h.ok ? "└─ pc versi lama: update dulu" : "└─ pc tak terjangkau";
                sx.ctlBadge = { label: h.ok ? "[OK·lama]" : "[PUTUS]", tone: h.ok ? "ok" : "bad" };
                sx.watcherEnabled = null;
                sx.detail = null;
                return;
            }
            if (!r.ok) {
                sx.ctlStatusLine = "└─ " + c.base;
                sx.ctlBadge = { label: "[PUTUS]", tone: "bad" };
                sx.watcherEnabled = null;
                ctlSay(r.error || "gagal", "bad");
                return;
            }
            const d = (r.data || {});
            sx.detail = d;
            sx.ctlStatusLine = "└─ v" + (d.version || "?") + " · " + (d.ip || "?") + ":" + (d.port || "?");
            sx.ctlBadge = { label: "[OK]", tone: "ok" };
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
        if (!s.watchPin) {
            ctlSay("isi pin watcher dulu (tab ke field pin).", "bad");
            rerender();
            return;
        }
        s.ctlBusy = true;
        rerender();
        const r = await Lan.watcherSet(c.base, s.watchPin, enabled);
        const sx = st.current;
        sx.ctlBusy = false;
        if (r.ok) {
            const d = (r.data || {});
            sx.watcherEnabled = !!d.enabled;
            ctlSay("watcher " + (d.enabled ? "nyala" : "mati"), "ok");
            sx.watchPin = "";
        }
        else {
            ctlSay(r.error || "gagal", "bad");
            if (r.status === 403 || r.status === 429)
                sx.watchPin = "";
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
            ctlSay("pc dipakai sesi aktif: tutup sesi dulu", "bad");
            rerender();
            return;
        }
        s.ctlBusy = true;
        rerender();
        const r = await Lan.wipe(c.base, s.wipePin, s.wipeConfirm);
        const sx = st.current;
        sx.ctlBusy = false;
        if (r.ok) {
            const n = r.data?.deleted;
            ctlSay("dihapus " + (n == null ? "?" : n), "ok");
            sx.wipePin = "";
            sx.wipeConfirm = "";
        }
        else {
            ctlSay(r.error || "gagal", "bad");
            if (r.status === 400)
                sx.wipeConfirm = "";
            else if (r.status === 403 || r.status === 429)
                sx.wipePin = "";
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
        if (!s.logPin) {
            ctlSay("isi pin log dulu (tab ke field pin).", "bad");
            rerender();
            return;
        }
        s.ctlBusy = true;
        rerender();
        const r = await Lan.logGet(c.base, s.logPin, 200);
        const sx = st.current;
        sx.ctlBusy = false;
        if (r.ok) {
            const lines = r.data?.lines;
            sx.logLines = Array.isArray(lines) && lines.length ? lines : ["(kosong)"];
            ctlSay("", "dim");
        }
        else {
            ctlSay(r.error || "gagal", "bad");
            if (r.status === 403 || r.status === 429)
                sx.logPin = "";
        }
        rerender();
    }
    function saveAdd() {
        const s = st.current;
        const r = Comps.add(s.newName, s.newBase);
        if (!r.ok) {
            say(r.error || "gagal", "bad");
            rerender();
            return;
        }
        s.adding = false;
        s.newName = "";
        s.newBase = "";
        say("ditambah " + (r.comp?.name || ""), "ok");
        void refreshList();
        checkAllNow();
    }
    function saveEdit() {
        const s = st.current;
        if (!s.editingId)
            return;
        const r = Comps.upsert(s.editingId, s.edName, s.edBase);
        if (!r.ok) {
            say(r.error || "gagal", "bad");
            rerender();
            return;
        }
        s.editingId = null;
        say("diperbarui", "ok");
        void refreshList();
        checkAllNow();
    }
    async function deleteAt(id) {
        const s = st.current;
        if (await Store.isCompInOpenSession(id)) {
            say("pc itu dipakai sesi aktif, tutup sesi dulu", "bad");
            rerender();
            return;
        }
        Comps.remove(id);
        s.pendingDel = null;
        s.editingId = null;
        say("dihapus", "ok");
        void refreshList();
    }
    const s = st.current;
    const listFocus = s.focus === "new-name" || s.focus === "new-base" || s.focus === "ed-name" || s.focus === "ed-base";
    const ctlFields = ["watch-pin", "wipe-pin", "wipe-confirm", "log-pin"];
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        const sx = st.current;
        if (sx.ctlId) {
            const ctl = Comps.get(sx.ctlId);
            if (sx.focus) {
                if (key.name === "escape") {
                    sx.focus = null;
                    rerender();
                    return;
                }
                if (key.name === "tab") {
                    const i = ctlFields.indexOf(sx.focus);
                    sx.focus = ctlFields[(i + 1) % ctlFields.length] || null;
                    rerender();
                    return;
                }
                const isPin = sx.focus === "watch-pin" || sx.focus === "wipe-pin" || sx.focus === "log-pin";
                const isConfirm = sx.focus === "wipe-confirm";
                if (isPin || isConfirm) {
                    if (key.name === "backspace") {
                        if (sx.focus === "watch-pin")
                            sx.watchPin = sx.watchPin.slice(0, -1);
                        else if (sx.focus === "wipe-pin")
                            sx.wipePin = sx.wipePin.slice(0, -1);
                        else if (sx.focus === "log-pin")
                            sx.logPin = sx.logPin.slice(0, -1);
                        else
                            sx.wipeConfirm = sx.wipeConfirm.slice(0, -1);
                        rerender();
                        return;
                    }
                    if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
                        const ch = isConfirm ? key.sequence.toUpperCase() : key.sequence;
                        if (sx.focus === "watch-pin")
                            sx.watchPin += ch;
                        else if (sx.focus === "wipe-pin")
                            sx.wipePin += ch;
                        else if (sx.focus === "log-pin")
                            sx.logPin += ch;
                        else
                            sx.wipeConfirm += ch;
                        rerender();
                        return;
                    }
                }
                return;
            }
            if (!ctl) {
                closeCtl();
                return;
            }
            if (key.name === "escape") {
                closeCtl();
                return;
            }
            switch (key.name) {
                case "w":
                    void setWatcher(true);
                    break;
                case "m":
                    void setWatcher(false);
                    break;
                case "l":
                    void loadLog();
                    break;
                case "x":
                    void doWipe();
                    break;
                case "r":
                    void ctlLoad();
                    break;
            }
            return;
        }
        if (listFocus) {
            if (key.name === "escape") {
                sx.adding = false;
                sx.editingId = null;
                rerender();
                return;
            }
            if (key.name === "tab") {
                sx.focus = sx.focus === "new-name" ? "new-base" : sx.focus === "new-base" ? "new-name" : sx.focus === "ed-name" ? "ed-base" : "ed-name";
                rerender();
                return;
            }
            return;
        }
        const v = viewKey(key.name);
        if (v) {
            if (v !== "comp")
                onView(v);
            return;
        }
        const cursor = Math.min(Math.max(0, sx.cursor), Math.max(0, sx.list.length - 1));
        const row = sx.list[cursor];
        switch (key.name) {
            case "up":
                sx.cursor = Math.max(0, cursor - 1);
                rerender();
                break;
            case "down":
                sx.cursor = Math.min(Math.max(0, sx.list.length - 1), cursor + 1);
                rerender();
                break;
            case "return":
                if (row)
                    openCtl(row.id);
                break;
            case "a":
                sx.adding = !sx.adding;
                sx.editingId = null;
                sx.newName = "";
                sx.newBase = "";
                if (sx.adding)
                    sx.focus = "new-name";
                say("", "dim");
                rerender();
                break;
            case "e":
                if (row) {
                    sx.editingId = row.id;
                    sx.adding = false;
                    sx.edName = row.name;
                    sx.edBase = row.base;
                    sx.focus = "ed-name";
                    rerender();
                }
                break;
            case "d":
                if (!row)
                    break;
                if (sx.pendingDel === row.id)
                    void deleteAt(row.id);
                else {
                    sx.pendingDel = row.id;
                    say("d lagi = yakin hapus " + row.name, "bad");
                    rerender();
                }
                break;
            case "r":
                checkAllNow();
                break;
        }
    });
    const detailLine = (() => {
        const d = st.current.detail;
        if (!d)
            return null;
        return ("watcher " +
            (d.watcher_enabled ? "nyala" : "mati") +
            (d.watcher_alive ? " (hidup)" : " (tak hidup)") +
            " · ketoko " +
            (d.ketoko ? "ada" : "tak ada") +
            " · tx hari ini " +
            (d.count_today == null ? "?" : String(d.count_today)) +
            (d.last_no ? " · " + String(d.last_no) : "") +
            (d.uptime_s != null ? " · up " + Math.round(Number(d.uptime_s)) + " dtk" : "") +
            (d.db_busy ? " · db sibuk" : ""));
    })();
    if (s.ctlId) {
        const c = Comps.get(s.ctlId);
        const logHeight = Math.max(3, Math.floor(dims.height / 3));
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", gap: 2, children: [_jsx("text", { fg: T.text, children: `kontrol: ${c?.name || "--"}` }), _jsx("text", { fg: T.faint, children: c?.base || "" }), _jsx(Tag, { label: st.current.ctlBadge.label, tone: st.current.ctlBadge.tone })] }), _jsx("text", { fg: T.dim, children: st.current.ctlStatusLine }), detailLine ? _jsx("text", { fg: T.dim, children: "└─ " + detailLine }) : null, _jsxs("box", { flexDirection: "column", paddingTop: 1, children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: st.current.focus === "watch-pin" ? T.text : T.dim, children: "pin watcher" }), _jsx("text", { fg: T.text, children: "•".repeat(st.current.watchPin.length) + (st.current.focus === "watch-pin" ? "▏" : "") })] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: st.current.focus === "wipe-pin" ? T.text : T.dim, children: "pin wipe   " }), _jsx("text", { fg: T.text, children: "•".repeat(st.current.wipePin.length) + (st.current.focus === "wipe-pin" ? "▏" : "") })] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: st.current.focus === "wipe-confirm" ? T.text : T.dim, children: "ketik HAPUS" }), _jsx("text", { fg: T.text, children: st.current.wipeConfirm + (st.current.focus === "wipe-confirm" ? "▏" : "") })] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: st.current.focus === "log-pin" ? T.text : T.dim, children: "pin log    " }), _jsx("text", { fg: T.text, children: "•".repeat(st.current.logPin.length) + (st.current.focus === "log-pin" ? "▏" : "") })] }), _jsx("text", { fg: T.faint, children: "tab pilih field · w watcher nyala · m mati · l log · x wipe · r reload · esc kembali" }), _jsx(Msg, { text: st.current.ctlMsg.t, tone: st.current.ctlMsg.tone })] }), _jsxs("box", { flexDirection: "column", height: logHeight + 1, children: [_jsx("text", { fg: T.faint, children: st.current.logLines ? "└─ log (200 baris terakhir)" : "└─ log: l untuk muat" }), st.current.logLines ? (_jsx("scrollbox", { height: logHeight, width: "100%", children: st.current.logLines.map((ln, i) => (_jsx("text", { fg: T.dim, wrapMode: "none", children: ln || " " }, i))) })) : null] })] }));
    }
    const rowLines = Math.max(2, Math.floor((dims.height - 8) / 2));
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", gap: 2, children: [_jsx("text", { fg: T.text, children: "daftar computer" }), _jsx("text", { fg: T.faint, children: `${s.list.length} pc · enter kontrol · a tambah · e ubah · d hapus (2x) · r cek ulang` })] }), s.adding ? (_jsxs("box", { flexDirection: "row", gap: 1, paddingTop: 1, children: [_jsx(Field, { label: "nama  ", value: s.newName, focus: s.focus === "new-name", placeholder: "kasir 1", width: 14, onInput: (v) => { st.current.newName = v; }, onSubmit: () => { st.current.focus = "new-base"; rerender(); } }), _jsx(Field, { label: "alamat", value: s.newBase, focus: s.focus === "new-base", placeholder: "http://192.168.1.5:8765", width: 26, onInput: (v) => { st.current.newBase = v; }, onSubmit: saveAdd }), _jsx("text", { fg: T.faint, children: "enter simpan · esc batal" })] })) : null, _jsx("box", { flexDirection: "column", paddingTop: 1, children: !s.list.length ? (_jsx("text", { fg: T.faint, children: "\u2514\u2500 belum ada computer. a tambah dulu." })) : (s.list.slice(0, rowLines).map((c, i) => {
                    const b = badgeOf(Comps.st(c.id));
                    const on = i === Math.min(Math.max(0, s.cursor), Math.max(0, s.list.length - 1));
                    return (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Sel, { on: on }), _jsx("text", { fg: on ? T.text : T.dim, children: c.name }), _jsx(Tag, { label: b.label, tone: b.tone }), s.active[c.id] ? _jsx(Tag, { label: "sesi aktif", tone: "warn" }) : null, s.pendingDel === c.id ? _jsx(Tag, { label: "yakin? d", tone: "bad" }) : null] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { children: " " }), _jsx("text", { fg: T.faint, children: c.base })] }), s.editingId === c.id ? (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Field, { label: "nama  ", value: s.edName, focus: s.focus === "ed-name", width: 14, onInput: (v) => { st.current.edName = v; }, onSubmit: () => { st.current.focus = "ed-base"; rerender(); } }), _jsx(Field, { label: "alamat", value: s.edBase, focus: s.focus === "ed-base", width: 26, onInput: (v) => { st.current.edBase = v; }, onSubmit: saveEdit }), _jsx("text", { fg: T.faint, children: "enter simpan · esc batal" })] })) : null] }, c.id));
                })) }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone })] }));
}
