import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "../theme.js";
import { Modal, Msg, Sel, Tag } from "../ui.js";
import { viewKey, type ViewId } from "../keymap.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
import * as TxMerge from "../txmerge.js";
import { cleanNum, padU, rupiah } from "../fmt.js";

interface Picker {
  mode: "open" | "add";
  list: Comps.Comp[] | null;
  sel: Record<string, boolean>;
  cursor: number;
}

interface St {
  sessionId: string | null;
  pcs: Store.Pc[];
  seq: number;
  polling: boolean;
  cursor: number;
  items: TxMerge.MergedItem[];
  totals: { tunai: number; nontunai: number; all: number; count: number };
  status: string;
  editingTid: string | null;
  editingFill: string | null;
  editT: string;
  editN: string;
  editFocus: "t" | "n";
  picker: Picker | null;
  history: Store.Session[];
  histCursor: number;
  pendingDelete: string | null;
  msg: { t: string; tone: "dim" | "ok" | "bad" };
}

function pcLabel(pcs: Store.Pc[]): string {
  const names = (pcs || []).map((p) => p.name || p.comp_id);
  if (!names.length) return "--";
  if (names.length <= 2) return names.join(" + ");
  return names[0] + " + " + names[1] + " (+" + (names.length - 2) + ")";
}

export function LiveView({ onView }: { onView: (v: ViewId) => void }) {
  const st = useRef<St>({
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function say(t: string, tone: "dim" | "ok" | "bad") {
    st.current.msg = { t, tone };
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  function startTimer(my: number) {
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
      if (p.alive) alive++;
    }
    if (!n) s.status = "--";
    else if (alive === n) s.status = "BUKA·ok";
    else if (!alive) s.status = "PUTUS";
    else s.status = "BUKA·kurang";
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

  async function drainPc(my: number, pc: Store.Pc): Promise<boolean> {
    const s = st.current;
    let since = pc.last_seen || 0;
    for (;;) {
      if (my !== s.seq) return true;
      const r = await Lan.fetchTx(pc.base, since, 50);
      if (!r.ok) {
        pc.alive = 0;
        pc.complete = 0;
        if (s.sessionId) await Store.patchPc(s.sessionId, pc.comp_id, { alive: 0, complete: 0 });
        return false;
      }
      if (r.rows.length) {
        const up = await Store.upsertTx(s.sessionId as string, pc.comp_id, r.rows as unknown as Store.TxRow[]);
        if (up) pc.last_seen = up.lastSeen;
      }
      if (r.rows.length < 50) break;
      since = pc.last_seen || 0;
    }
    pc.alive = 1;
    pc.complete = 1;
    if (s.sessionId) await Store.patchPc(s.sessionId, pc.comp_id, { alive: 1, complete: 1, last_seen: pc.last_seen || 0 });
    return true;
  }

  async function drain(my: number): Promise<boolean> {
    const s = st.current;
    let allOk = true;
    for (const pc of s.pcs) {
      if (my !== s.seq) return true;
      if (!(await drainPc(my, pc))) allOk = false;
    }
    if (my !== s.seq) return true;
    await reload();
    return allOk;
  }

  async function pollOnce(my: number) {
    const s = st.current;
    if (my !== s.seq || s.polling) return;
    s.polling = true;
    try {
      await drain(my);
    } finally {
      if (my === s.seq) s.polling = false;
    }
  }

  async function openSession(picks: Comps.Comp[]) {
    const s = st.current;
    if (!picks.length) return;
    const my = ++s.seq;
    stopTimer();
    s.editingTid = null;
    s.editingFill = null;
    s.pendingDelete = null;
    const sess = await Store.createSession(picks);
    s.sessionId = sess.id;
    s.pcs = sess.pcs;
    s.status = "kuras…";
    for (const p of picks) Comps.touch(p.id);
    await reload();
    say(`sesi ${sess.id} dibuka (${sess.pcs.length} pc)`, "ok");
    await drain(my);
    if (my !== s.seq) return;
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
    if (my !== s.seq) return;
    await reload();
  }

  async function reopenSession(id: string) {
    const s = st.current;
    const sess = await Store.getSession(id);
    if (!sess || sess.status === "open") return;
    stopTimer();
    if (s.sessionId && s.sessionId !== id) await closeCurrent();
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
    if (my !== s.seq) return;
    startTimer(my);
    rerender();
  }

  async function deleteSession(id: string) {
    const ok = await Store.deleteSession(id);
    const s = st.current;
    say(ok ? "sesi dihapus" : "sesi open tak bisa dihapus", ok ? "ok" : "bad");
    s.pendingDelete = null;
    await reload();
  }

  function openPicker(mode: "open" | "add") {
    const s = st.current;
    const exclude: Record<string, boolean> = {};
    if (mode === "add") for (const p of s.pcs) exclude[p.comp_id] = true;
    const sel: Record<string, boolean> = {};
    if (mode === "open") {
      const lu = Comps.lastUsed();
      if (lu && !exclude[lu.id]) sel[lu.id] = true;
    }
    s.picker = { mode, list: null, sel, cursor: 0 };
    rerender();
    void (async () => {
      const list = await Comps.online();
      const sx = st.current;
      if (!sx.picker) return;
      sx.picker.list = list.filter((c) => !exclude[c.id]);
      rerender();
    })();
  }

  async function confirmPicker() {
    const s = st.current;
    if (!s.picker) return;
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
    } else if (s.sessionId) {
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
      if (s.sessionId) await drain(s.seq);
      rerender();
    }
  }

  async function saveEdit() {
    const s = st.current;
    if (!s.sessionId) return;
    const ct = cleanNum(s.editT);
    const cn = cleanNum(s.editN);
    if (ct === null || cn === null) {
      say("angka negatif tak valid.", "bad");
      rerender();
      return;
    }
    const key = s.editingFill || s.editingTid;
    if (!key) return;
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
    } else {
      const ok = await Store.patchTx(s.sessionId, s.editingTid as string, ct, cn);
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
    if (!s.sessionId) return;
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
      } else {
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
    if (key.eventType === "release") return;
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
        if (sx.editFocus === "t") sx.editT = sx.editT.slice(0, -1);
        else sx.editN = sx.editN.slice(0, -1);
        rerender();
        return;
      }
      if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && /[0-9]/.test(key.sequence)) {
        if (sx.editFocus === "t") sx.editT += key.sequence;
        else sx.editN += key.sequence;
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
          if (c) p.sel[c.id] = !p.sel[c.id];
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
      if (v !== "live") onView(v);
      return;
    }
    switch (key.name) {
      case "up":
        if (sx.sessionId) sx.cursor = Math.max(0, cursor - 1);
        else sx.histCursor = Math.max(0, sx.histCursor - 1);
        rerender();
        break;
      case "down":
        if (sx.sessionId) sx.cursor = Math.min(Math.max(0, s.items.length - 1), cursor + 1);
        else sx.histCursor = Math.min(Math.max(0, sx.history.length - 1), sx.histCursor + 1);
        rerender();
        break;
      case "o":
        if (!sx.sessionId) openPicker("open");
        break;
      case "x":
        if (sx.sessionId) void closeCurrent();
        break;
      case "a":
        if (sx.sessionId) openPicker("add");
        break;
      case "r":
        void retryNow();
        break;
      case "return": {
        if (!sx.sessionId) {
          const sess = sx.history[Math.min(sx.histCursor, Math.max(0, sx.history.length - 1))];
          if (sess && sess.status !== "open") void reopenSession(sess.id);
          else if (sess) say("sesi sudah aktif.", "dim");
          rerender();
        }
        break;
      }
      case "e": {
        if (!sx.sessionId) break;
        const it = s.items[cursor];
        if (!it) break;
        if (it.t === "hilang") {
          sx.editingFill = it.hkey;
          sx.editingTid = null;
          sx.editT = "";
          sx.editN = "";
          sx.editFocus = "t";
        } else if (it.t === "tx") {
          if (it.fill) {
            sx.editingFill = it.fill;
            sx.editingTid = null;
            sx.editT = String(it.r.tunai || 0);
            sx.editN = String(it.r.nontunai || 0);
            sx.editFocus = "t";
          } else {
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
        if (sx.sessionId) break;
        const sess = sx.history[Math.min(sx.histCursor, Math.max(0, sx.history.length - 1))];
        if (!sess || sess.status === "open") break;
        if (sx.pendingDelete === sess.id) void deleteSession(sess.id);
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

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2}>
        <text fg={s.status === "BUKA·ok" ? T.ok : s.status === "PUTUS" ? T.bad : T.dim}>{`[${s.status}]`}</text>
        <text fg={T.dim}>{s.sessionId ? pcLabel(s.pcs) : "belum ada sesi — o buka / enter lanjutkan riwayat"}</text>
      </box>
      {banner ? <text fg={T.dim}>{banner}</text> : null}
      <box flexGrow={1} flexDirection="column" paddingTop={1}>
        {s.sessionId ? (
          !s.items.length ? (
            <text fg={T.faint}>└─ sesi ini belum ada transaksi.</text>
          ) : (
            visible.map((it, i) => {
              const idx = start + i;
              const on = idx === cursor;
              if (it.t === "hilang") {
                return (
                  <box key={"h" + it.hkey} flexDirection="column">
                    <box flexDirection="row" gap={1}>
                      <Sel on={on} />
                      <text fg={T.warn}>{`HILANG no ${padU(it.n, it.w)}`}</text>
                      <Tag label={it.pc_name} tone="dim" />
                      <Tag label="HILANG" tone="warn" />
                    </box>
                    <box flexDirection="row" gap={1}>
                      <text>{" "}</text>
                      <text fg={T.faint}>{`${it.day} · tak ada di PC — e isi`}</text>
                    </box>
                  </box>
                );
              }
              const r = it.r;
              const isFill = !!it.fill;
              const conf = sxEditRow(st.current, it);
              return (
                <box key={it.fill || r.tid || "tx" + idx} flexDirection="column">
                  <box flexDirection="row" gap={1}>
                    <Sel on={on} />
                    <text fg={on ? T.text : T.dim}>{isFill ? `MANUAL no ${padU(r.n || 0, it.w || 4)}` : r.no_transaksi || `id-${r.server_id}`}</text>
                    <Tag label={it.pc_name} tone="dim" />
                    {isFill ? <Tag label="MANUAL" tone="warn" /> : <Tag label={r.kategori || "--"} tone="dim" />}
                    {r.edited ? <Tag label="EDIT" tone="accent" /> : null}
                  </box>
                  {conf ?? (
                    <box flexDirection="row" gap={1}>
                      <text>{" "}</text>
                      <text fg={T.dim}>{rupiah(r.total)}</text>
                      <text fg={T.faint}>{`T: ${rupiah(r.tunai)} NT: ${rupiah(r.nontunai)}${r.bank ? " " + r.bank : ""}`}</text>
                      <text fg={T.faint}>{isFill ? `${r.day || ""} · isian hp` : r.created_at || ""}</text>
                    </box>
                  )}
                </box>
              );
            })
          )
        ) : (
          <box flexDirection="column">
            <text fg={T.faint}>└─ riwayat sesi (j/k pilih · enter lanjut · d hapus 2x)</text>
            {s.history.length ? (
              s.history.map((h, i) => (
                <box key={h.id} flexDirection="column">
                  <box flexDirection="row" gap={1}>
                    <Sel on={i === s.histCursor} />
                    <text fg={i === s.histCursor ? T.text : T.dim}>{`${h.status === "open" ? "[buka]" : "[tutup]"} ${h.id}`}</text>
                    {!h.complete ? <Tag label="belum lengkap" tone="warn" /> : null}
                    {s.pendingDelete === h.id ? <Tag label="yakin? d" tone="bad" /> : null}
                  </box>
                  <box flexDirection="row" gap={1}>
                    <text>{" "}</text>
                    <text fg={T.faint}>{`${h.started_at || ""} · ${h.count || 0} tx · ${pcLabel(h.pcs)}`}</text>
                  </box>
                </box>
              ))
            ) : (
              <text fg={T.faint}>└─ riwayat: kosong.</text>
            )}
          </box>
        )}
      </box>
      <Msg text={s.msg.t} tone={s.msg.tone} />
      {s.picker ? (
        <Modal title={s.picker.mode === "open" ? "pilih computer · tersambung saja" : "tambah pc · tersambung saja"} hint="esc batal" widthPct={70} heightPct={60}>
          <box flexDirection="column">
            {s.picker.list === null ? (
              <text fg={T.dim}>cek PC…</text>
            ) : !s.picker.list.length ? (
              <text fg={T.dim}>tak ada PC tersambung. cek wifi atau tambah via view comp (4).</text>
            ) : (
              s.picker.list.map((c, i) => (
                <box key={c.id} flexDirection="row" gap={1}>
                  <Sel on={i === s.picker?.cursor} />
                  <text fg={T.text}>{s.picker?.mode === "open" ? `[${s.picker?.sel[c.id] ? "x" : " "}]` : "    "}</text>
                  <text fg={i === s.picker?.cursor ? T.text : T.dim}>{c.name}</text>
                  <text fg={T.faint}>{c.base}</text>
                </box>
              ))
            )}
            <text fg={T.faint}>{s.picker.mode === "open" ? "space pilih · enter mulai" : "enter tambah · esc batal"}</text>
          </box>
        </Modal>
      ) : null}
    </box>
  );
}

function sxEditRow(s: St, it: TxMerge.MergedTx) {
  const isEditing = s.editingFill ? s.editingFill === it.fill : s.editingTid !== null && s.editingTid === it.r.tid;
  if (!isEditing) return null;
  return (
    <box flexDirection="row" gap={1}>
      <text>{" "}</text>
      <text fg={s.editFocus === "t" ? T.text : T.dim}>{"T:"}</text>
      <text fg={T.text}>{s.editT + (s.editFocus === "t" ? "▏" : "")}</text>
      <text fg={s.editFocus === "n" ? T.text : T.dim}>{"NT:"}</text>
      <text fg={T.text}>{s.editN + (s.editFocus === "n" ? "▏" : "")}</text>
      <text fg={T.faint}>{"enter simpan · tab pindah · esc batal"}</text>
    </box>
  );
}
