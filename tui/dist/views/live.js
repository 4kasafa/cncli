import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "../theme.js";
import { Modal, Msg, Sel, Tag } from "../ui.js";
import { viewKey } from "../keymap.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
import * as TxMerge from "../txmerge.js";
import { cleanNum, padU, rupiah } from "../fmt.js";
function pcLabel(pcs) {
    const names = (pcs || []).map((p) => p.name || p.comp_id);
    if (!names.length)
        return "--";
    if (names.length <= 2)
        return names.join(" + ");
    return names[0] + " + " + names[1] + " (+" + (names.length - 2) + ")";
}
export function LiveView({ onView }) {
    const st = useRef({
        sessionId: null,
        pcs: [],
        seq: 0,
        polling: false,
        cursor: 0,
        items: [],
        totals: { tunai: 0, nontunai: 0, all: 0, count: 0 },
        status: "--",
        editingTid: null,
        editingFill: null,
        editT: "",
        editN: "",
        editFocus: "t",
        picker: null,
        history: [],
        histCursor: 0,
        pendingDelete: null,
        msg: { t: "", tone: "dim" },
    });
    const [, bump] = useState(0);
    const rerender = () => bump((n) => n + 1);
    const dims = useTerminalDimensions();
    const timerRef = useRef(null);
    function say(t, tone) {
        st.current.msg = { t, tone };
    }
    function stopTimer() {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }
    function startTimer(my) {
        stopTimer();
        timerRef.current = setInterval(() => void pollOnce(my), 2000);
    }
    function paintStatus() {
        const s = st.current;
        if (!s.sessionId) {
            s.status = "--";
            return;
        }
        let n = 0;
        let alive = 0;
        for (const p of s.pcs) {
            n++;
            if (p.alive)
                alive++;
        }
        if (!n)
            s.status = "--";
        else if (alive === n)
            s.status = "BUKA·ok";
        else if (!alive)
            s.status = "PUTUS";
        else
            s.status = "BUKA·kurang";
    }
    async function reload() {
        const s = st.current;
        if (!s.sessionId) {
            s.items = [];
            s.totals = { tunai: 0, nontunai: 0, all: 0, count: 0 };
            s.history = await Store.listSessions(10);
            paintStatus();
            rerender();
            return;
        }
        const sess = await Store.getSession(s.sessionId);
        s.pcs = sess?.pcs || [];
        const rows = await Store.listTx(s.sessionId);
        const fills = await Store.getFills(s.sessionId);
        s.items = TxMerge.buildItems(rows, fills);
        let t = 0;
        let nt = 0;
        let all = 0;
        let nf = 0;
        for (const r of rows) {
            t += r.tunai || 0;
            nt += r.nontunai || 0;
            all += r.total || 0;
        }
        for (const k of Object.keys(fills)) {
            nf++;
            t += fills[k].tunai || 0;
            nt += fills[k].nontunai || 0;
            all += fills[k].total || 0;
        }
        s.totals = { tunai: t, nontunai: nt, all, count: rows.length + nf };
        paintStatus();
        rerender();
    }
    async function drainPc(my, pc) {
        const s = st.current;
        let since = pc.last_seen || 0;
        for (;;) {
            if (my !== s.seq)
                return true;
            const r = await Lan.fetchTx(pc.base, since, 50);
            if (!r.ok) {
                pc.alive = 0;
                pc.complete = 0;
                if (s.sessionId)
                    await Store.patchPc(s.sessionId, pc.comp_id, { alive: 0, complete: 0 });
                return false;
            }
            if (r.rows.length) {
                const up = await Store.upsertTx(s.sessionId, pc.comp_id, r.rows);
                if (up)
                    pc.last_seen = up.lastSeen;
            }
            if (r.rows.length < 50)
                break;
            since = pc.last_seen || 0;
        }
        pc.alive = 1;
        pc.complete = 1;
        if (s.sessionId)
            await Store.patchPc(s.sessionId, pc.comp_id, { alive: 1, complete: 1, last_seen: pc.last_seen || 0 });
        return true;
    }
    async function drain(my) {
        const s = st.current;
        let allOk = true;
        for (const pc of s.pcs) {
            if (my !== s.seq)
                return true;
            if (!(await drainPc(my, pc)))
                allOk = false;
        }
        if (my !== s.seq)
            return true;
        await reload();
        return allOk;
    }
    async function pollOnce(my) {
        const s = st.current;
        if (my !== s.seq || s.polling)
            return;
        s.polling = true;
        try {
            await drain(my);
        }
        finally {
            if (my === s.seq)
                s.polling = false;
        }
    }
    async function openSession(picks) {
        const s = st.current;
        if (!picks.length)
            return;
        const my = ++s.seq;
        stopTimer();
        s.editingTid = null;
        s.editingFill = null;
        s.pendingDelete = null;
        const sess = await Store.createSession(picks);
        s.sessionId = sess.id;
        s.pcs = sess.pcs;
        s.status = "kuras…";
        for (const p of picks)
            Comps.touch(p.id);
        await reload();
        say(`sesi ${sess.id} dibuka (${sess.pcs.length} pc)`, "ok");
        await drain(my);
        if (my !== s.seq)
            return;
        startTimer(my);
        rerender();
    }
    async function closeCurrent() {
        const s = st.current;
        const my = ++s.seq;
        stopTimer();
        s.editingTid = null;
        s.editingFill = null;
        if (s.sessionId) {
            const sess = await Store.getSession(s.sessionId);
            await Store.closeSession(s.sessionId, !!(sess && sess.complete));
            say(`sesi ditutup${sess && !sess.complete ? " (belum lengkap)" : ""}`, "ok");
            s.sessionId = null;
        }
        s.pcs = [];
        if (my !== s.seq)
            return;
        await reload();
    }
    async function reopenSession(id) {
        const s = st.current;
        const sess = await Store.getSession(id);
        if (!sess || sess.status === "open")
            return;
        stopTimer();
        if (s.sessionId && s.sessionId !== id)
            await closeCurrent();
        const my = ++s.seq;
        await Store.patchSession(id, { status: "open", closed_at: null });
        s.sessionId = id;
        s.pcs = sess.pcs || [];
        for (const p of s.pcs) {
            p.alive = 0;
            p.complete = 0;
        }
        s.status = "kuras…";
        await reload();
        say(`sesi ${id} dilanjutkan`, "ok");
        await drain(my);
        if (my !== s.seq)
            return;
        startTimer(my);
        rerender();
    }
    async function deleteSession(id) {
        const ok = await Store.deleteSession(id);
        const s = st.current;
        say(ok ? "sesi dihapus" : "sesi open tak bisa dihapus", ok ? "ok" : "bad");
        s.pendingDelete = null;
        await reload();
    }
    function openPicker(mode) {
        const s = st.current;
        const exclude = {};
        if (mode === "add")
            for (const p of s.pcs)
                exclude[p.comp_id] = true;
        const sel = {};
        if (mode === "open") {
            const lu = Comps.lastUsed();
            if (lu && !exclude[lu.id])
                sel[lu.id] = true;
        }
        s.picker = { mode, list: null, sel, cursor: 0 };
        rerender();
        void (async () => {
            const list = await Comps.online();
            const sx = st.current;
            if (!sx.picker)
                return;
            sx.picker.list = list.filter((c) => !exclude[c.id]);
            rerender();
        })();
    }
    async function confirmPicker() {
        const s = st.current;
        if (!s.picker)
            return;
        const list = s.picker.list || [];
        const picks = list.filter((c) => s.picker?.sel[c.id]);
        const mode = s.picker.mode;
        s.picker = null;
        rerender();
        if (!picks.length) {
            say("tak ada pc dipilih: batal.", "bad");
            rerender();
            return;
        }
        if (mode === "open") {
            await openSession(picks);
        }
        else if (s.sessionId) {
            for (const c of picks) {
                const sess = await Store.addPc(s.sessionId, c);
                if (!sess) {
                    say("pc sudah ada di sesi.", "bad");
                    continue;
                }
                Comps.touch(c.id);
                say(`+${c.name}`, "ok");
            }
            await reload();
            if (s.sessionId)
                await drain(s.seq);
            rerender();
        }
    }
    async function saveEdit() {
        const s = st.current;
        if (!s.sessionId)
            return;
        const ct = cleanNum(s.editT);
        const cn = cleanNum(s.editN);
        if (ct === null || cn === null) {
            say("angka negatif tak valid.", "bad");
            rerender();
            return;
        }
        const key = s.editingFill || s.editingTid;
        if (!key)
            return;
        if (s.editingFill) {
            const parts = s.editingFill.split("|");
            const fn = parseInt(parts.pop() || "", 10);
            const fday = parts.pop() || "";
            const fcomp = parts.join("|");
            const f = await Store.upsertFill(s.sessionId, fcomp, fday, fn, ct, cn);
            if (!f) {
                say("isian tak valid.", "bad");
                rerender();
                return;
            }
            say("isian tersimpan.", "ok");
        }
        else {
            const ok = await Store.patchTx(s.sessionId, s.editingTid, ct, cn);
            if (!ok) {
                say("koreksi gagal.", "bad");
                rerender();
                return;
            }
            say("koreksi tersimpan.", "ok");
        }
        s.editingTid = null;
        s.editingFill = null;
        await reload();
    }
    async function retryNow() {
        const s = st.current;
        if (!s.sessionId)
            return;
        const my = s.seq;
        s.status = "coba…";
        rerender();
        await drain(my);
        rerender();
    }
    useEffect(() => {
        void (async () => {
            const ss = await Store.listSessions(10);
            const open = ss.find((x) => x.status === "open");
            const s = st.current;
            if (open) {
                s.sessionId = open.id;
                s.pcs = open.pcs || [];
                for (const p of s.pcs) {
                    p.alive = 0;
                    p.complete = 0;
                }
                const my = ++s.seq;
                s.status = "BUKA·kurang";
                await reload();
                startTimer(my);
            }
            else {
                await reload();
            }
        })();
        return () => stopTimer();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const s = st.current;
    const cursor = Math.min(Math.max(0, s.cursor), Math.max(0, s.items.length - 1));
    const rowLines = Math.max(1, Math.floor((dims.height - 10) / 2));
    const start = Math.max(0, Math.min(cursor - Math.floor(rowLines / 2), s.items.length - rowLines));
    const visible = s.items.slice(start, start + rowLines);
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        const sx = st.current;
        if (sx.editingTid !== null || sx.editingFill !== null) {
            if (key.name === "escape") {
                sx.editingTid = null;
                sx.editingFill = null;
                rerender();
                return;
            }
            if (key.name === "tab") {
                sx.editFocus = sx.editFocus === "t" ? "n" : "t";
                rerender();
                return;
            }
            if (key.name === "return") {
                void saveEdit();
                return;
            }
            if (key.name === "backspace") {
                if (sx.editFocus === "t")
                    sx.editT = sx.editT.slice(0, -1);
                else
                    sx.editN = sx.editN.slice(0, -1);
                rerender();
                return;
            }
            if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && /[0-9]/.test(key.sequence)) {
                if (sx.editFocus === "t")
                    sx.editT += key.sequence;
                else
                    sx.editN += key.sequence;
                rerender();
            }
            return;
        }
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
                if (key.name === "space" && p.mode === "open") {
                    const c = p.list[p.cursor];
                    if (c)
                        p.sel[c.id] = !p.sel[c.id];
                    rerender();
                    return;
                }
                if (key.name === "return") {
                    if (p.mode === "add") {
                        const c = p.list[p.cursor];
                        if (c) {
                            p.sel = { [c.id]: true };
                        }
                    }
                    void confirmPicker();
                    return;
                }
            }
            return;
        }
        const v = viewKey(key.name);
        if (v) {
            if (v !== "live")
                onView(v);
            return;
        }
        switch (key.name) {
            case "up":
                if (sx.sessionId)
                    sx.cursor = Math.max(0, cursor - 1);
                else
                    sx.histCursor = Math.max(0, sx.histCursor - 1);
                rerender();
                break;
            case "down":
                if (sx.sessionId)
                    sx.cursor = Math.min(Math.max(0, s.items.length - 1), cursor + 1);
                else
                    sx.histCursor = Math.min(Math.max(0, sx.history.length - 1), sx.histCursor + 1);
                rerender();
                break;
            case "o":
                if (!sx.sessionId)
                    openPicker("open");
                break;
            case "x":
                if (sx.sessionId)
                    void closeCurrent();
                break;
            case "a":
                if (sx.sessionId)
                    openPicker("add");
                break;
            case "r":
                void retryNow();
                break;
            case "return": {
                if (!sx.sessionId) {
                    const sess = sx.history[Math.min(sx.histCursor, Math.max(0, sx.history.length - 1))];
                    if (sess && sess.status !== "open")
                        void reopenSession(sess.id);
                    else if (sess)
                        say("sesi sudah aktif.", "dim");
                    rerender();
                }
                break;
            }
            case "e": {
                if (!sx.sessionId)
                    break;
                const it = s.items[cursor];
                if (!it)
                    break;
                if (it.t === "hilang") {
                    sx.editingFill = it.hkey;
                    sx.editingTid = null;
                    sx.editT = "";
                    sx.editN = "";
                    sx.editFocus = "t";
                }
                else if (it.t === "tx") {
                    if (it.fill) {
                        sx.editingFill = it.fill;
                        sx.editingTid = null;
                        sx.editT = String(it.r.tunai || 0);
                        sx.editN = String(it.r.nontunai || 0);
                        sx.editFocus = "t";
                    }
                    else {
                        sx.editingTid = it.r.tid || null;
                        sx.editingFill = null;
                        sx.editT = String(it.r.tunai || 0);
                        sx.editN = String(it.r.nontunai || 0);
                        sx.editFocus = "t";
                    }
                }
                rerender();
                break;
            }
            case "d": {
                if (sx.sessionId)
                    break;
                const sess = sx.history[Math.min(sx.histCursor, Math.max(0, sx.history.length - 1))];
                if (!sess || sess.status === "open")
                    break;
                if (sx.pendingDelete === sess.id)
                    void deleteSession(sess.id);
                else {
                    sx.pendingDelete = sess.id;
                    say("hapus sesi? d lagi = yakin.", "bad");
                    rerender();
                }
                break;
            }
            case "j":
                if (!sx.sessionId) {
                    sx.histCursor = Math.min(sx.history.length - 1, sx.histCursor + 1);
                    rerender();
                }
                break;
            case "k":
                if (!sx.sessionId) {
                    sx.histCursor = Math.max(0, sx.histCursor - 1);
                    rerender();
                }
                break;
        }
    });
    const banner = s.sessionId
        ? `${s.pcs.length} pc · tx: ${s.totals.count} · tunai: ${rupiah(s.totals.tunai)} · nontunai: ${rupiah(s.totals.nontunai)} · semua: ${rupiah(s.totals.all)}`
        : null;
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsxs("box", { flexDirection: "row", gap: 2, children: [_jsx("text", { fg: s.status === "BUKA·ok" ? T.ok : s.status === "PUTUS" ? T.bad : T.dim, children: `[${s.status}]` }), _jsx("text", { fg: T.dim, children: s.sessionId ? pcLabel(s.pcs) : "belum ada sesi — o buka / enter lanjutkan riwayat" })] }), banner ? _jsx("text", { fg: T.dim, children: banner }) : null, _jsx("box", { flexGrow: 1, flexDirection: "column", paddingTop: 1, children: s.sessionId ? (!s.items.length ? (_jsx("text", { fg: T.faint, children: "\u2514\u2500 sesi ini belum ada transaksi." })) : (visible.map((it, i) => {
                    const idx = start + i;
                    const on = idx === cursor;
                    if (it.t === "hilang") {
                        return (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Sel, { on: on }), _jsx("text", { fg: T.warn, children: `HILANG no ${padU(it.n, it.w)}` }), _jsx(Tag, { label: it.pc_name, tone: "dim" }), _jsx(Tag, { label: "HILANG", tone: "warn" })] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { children: " " }), _jsx("text", { fg: T.faint, children: `${it.day} · tak ada di PC — e isi` })] })] }, "h" + it.hkey));
                    }
                    const r = it.r;
                    const isFill = !!it.fill;
                    const conf = sxEditRow(st.current, it);
                    return (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Sel, { on: on }), _jsx("text", { fg: on ? T.text : T.dim, children: isFill ? `MANUAL no ${padU(r.n || 0, it.w || 4)}` : r.no_transaksi || `id-${r.server_id}` }), _jsx(Tag, { label: it.pc_name, tone: "dim" }), isFill ? _jsx(Tag, { label: "MANUAL", tone: "warn" }) : _jsx(Tag, { label: r.kategori || "--", tone: "dim" }), r.edited ? _jsx(Tag, { label: "EDIT", tone: "accent" }) : null] }), conf ?? (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { children: " " }), _jsx("text", { fg: T.dim, children: rupiah(r.total) }), _jsx("text", { fg: T.faint, children: `T: ${rupiah(r.tunai)} NT: ${rupiah(r.nontunai)}${r.bank ? " " + r.bank : ""}` }), _jsx("text", { fg: T.faint, children: isFill ? `${r.day || ""} · isian hp` : r.created_at || "" })] }))] }, it.fill || r.tid || "tx" + idx));
                }))) : (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: T.faint, children: "\u2514\u2500 riwayat sesi (j/k pilih \u00B7 enter lanjut \u00B7 d hapus 2x)" }), s.history.length ? (s.history.map((h, i) => (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Sel, { on: i === s.histCursor }), _jsx("text", { fg: i === s.histCursor ? T.text : T.dim, children: `${h.status === "open" ? "[buka]" : "[tutup]"} ${h.id}` }), !h.complete ? _jsx(Tag, { label: "belum lengkap", tone: "warn" }) : null, s.pendingDelete === h.id ? _jsx(Tag, { label: "yakin? d", tone: "bad" }) : null] }), _jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { children: " " }), _jsx("text", { fg: T.faint, children: `${h.started_at || ""} · ${h.count || 0} tx · ${pcLabel(h.pcs)}` })] })] }, h.id)))) : (_jsx("text", { fg: T.faint, children: "\u2514\u2500 riwayat: kosong." }))] })) }), _jsx(Msg, { text: s.msg.t, tone: s.msg.tone }), s.picker ? (_jsx(Modal, { title: s.picker.mode === "open" ? "pilih computer · tersambung saja" : "tambah pc · tersambung saja", hint: "esc batal", widthPct: 70, heightPct: 60, children: _jsxs("box", { flexDirection: "column", children: [s.picker.list === null ? (_jsx("text", { fg: T.dim, children: "cek PC\u2026" })) : !s.picker.list.length ? (_jsx("text", { fg: T.dim, children: "tak ada PC tersambung. cek wifi atau tambah via view comp (4)." })) : (s.picker.list.map((c, i) => (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx(Sel, { on: i === s.picker?.cursor }), _jsx("text", { fg: T.text, children: s.picker?.mode === "open" ? `[${s.picker?.sel[c.id] ? "x" : " "}]` : "    " }), _jsx("text", { fg: i === s.picker?.cursor ? T.text : T.dim, children: c.name }), _jsx("text", { fg: T.faint, children: c.base })] }, c.id)))), _jsx("text", { fg: T.faint, children: s.picker.mode === "open" ? "space pilih · enter mulai" : "enter tambah · esc batal" })] }) })) : null] }));
}
function sxEditRow(s, it) {
    const isEditing = s.editingFill ? s.editingFill === it.fill : s.editingTid !== null && s.editingTid === it.r.tid;
    if (!isEditing)
        return null;
    return (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { children: " " }), _jsx("text", { fg: s.editFocus === "t" ? T.text : T.dim, children: "T:" }), _jsx("text", { fg: T.text, children: s.editT + (s.editFocus === "t" ? "▏" : "") }), _jsx("text", { fg: s.editFocus === "n" ? T.text : T.dim, children: "NT:" }), _jsx("text", { fg: T.text, children: s.editN + (s.editFocus === "n" ? "▏" : "") }), _jsx("text", { fg: T.faint, children: "enter simpan · tab pindah · esc batal" })] }));
}
