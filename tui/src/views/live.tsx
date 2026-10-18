import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { KpiGrid, Msg } from "../ui.js";
import { clip, formatRow, type ColSpec } from "../layout.js";
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

function statusTone(s: string): "ok" | "warn" | "bad" | "dim" {
  if (s === "OPEN") return "ok";
  if (s === "PARTIAL") return "warn";
  if (s === "DOWN") return "bad";
  return "dim";
}

function Row({
  on,
  bad,
  width,
  spec,
  tone,
}: {
  on: boolean;
  bad?: boolean;
  width: number;
  spec: ColSpec[];
  tone?: "text" | "dim" | "warn";
}) {
  const line = formatRow(Math.max(0, width - 2), spec);
  const marker = bad ? "!" : on ? ">" : " ";
  const fg = bad ? T.warn : on ? T.text : T[tone || "dim"];
  return (
    <box flexDirection="row">
      <text fg={bad || on ? (bad ? T.warn : T.accent) : T.faint}>{marker}</text>
      <text fg={fg} attributes={on ? TextAttributes.BOLD : undefined}>
        {" " + line}
      </text>
    </box>
  );
}

function txSpec(it: TxMerge.MergedItem): ColSpec[] {
  if (it.t === "hilang") {
    return [
      { key: "text", min: 10, flex: 1, text: `no ${padU(it.n, it.w)} · not on PC — e fill` },
      { key: "pc", min: 4, text: it.pc_name || "" },
    ];
  }
  const r = it.r;
  const isFill = !!it.fill;
  return [
    { key: "no", min: 8, text: r.no_transaksi || `id-${r.server_id}` },
    { key: "total", min: 10, align: "right", text: rupiah(r.total) },
    { key: "t", min: 9, align: "right", text: "T " + rupiah(r.tunai) },
    { key: "nt", min: 9, align: "right", text: "NT " + rupiah(r.nontunai) },
    { key: "pc", min: 5, flex: 1, text: it.pc_name || "" },
    { key: "kat", min: 6, text: isFill ? "manual" : r.kategori || (r.bank ? r.bank : "") },
  ];
}

export function LiveView({ onBack }: { onBack: () => void }) {
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
    else if (alive === n) s.status = "OPEN";
    else if (!alive) s.status = "DOWN";
    else s.status = "PARTIAL";
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
    s.status = "draining...";
    for (const p of picks) Comps.touch(p.id);
    await reload();
    say(`session ${sess.id} opened (${sess.pcs.length} pc)`, "ok");
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
      say(`session closed${sess && !sess.complete ? " (incomplete)" : ""}`, "ok");
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
    s.status = "draining...";
    await reload();
    say(`session ${id} resumed`, "ok");
    await drain(my);
    if (my !== s.seq) return;
    startTimer(my);
    rerender();
  }

  async function deleteSession(id: string) {
    const ok = await Store.deleteSession(id);
    const s = st.current;
    say(ok ? "session deleted" : "open session cannot be deleted", ok ? "ok" : "bad");
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
      say("no pc selected: cancelled.", "bad");
      rerender();
      return;
    }
    if (mode === "open") {
      await openSession(picks);
    } else if (s.sessionId) {
      for (const c of picks) {
        const sess = await Store.addPc(s.sessionId, c);
        if (!sess) {
          say("pc already in session.", "bad");
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
      say("negative numbers are not valid.", "bad");
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
        say("fill is not valid.", "bad");
        rerender();
        return;
      }
      say("fill saved.", "ok");
    } else {
      const ok = await Store.patchTx(s.sessionId, s.editingTid as string, ct, cn);
      if (!ok) {
        say("edit failed.", "bad");
        rerender();
        return;
      }
      say("edit saved.", "ok");
    }
    s.editingTid = null;
    s.editingFill = null;
    await reload();
  }

  async function retryNow() {
    const s = st.current;
    if (!s.sessionId) return;
    const my = s.seq;
    s.status = "retrying...";
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
        s.status = "PARTIAL";
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
  const width = Math.max(20, dims.width - 2);
  const cursor = Math.min(Math.max(0, s.cursor), Math.max(0, s.items.length - 1));
  const listLines = Math.max(1, Math.floor((dims.height - 13) / 1));
  const start = Math.max(0, Math.min(cursor - Math.floor(listLines / 2), s.items.length - listLines));
  const visible = s.items.slice(start, start + listLines);
  const histCursor = Math.min(s.histCursor, Math.max(0, s.history.length - 1));

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
        if (key.name === "space" && p.mode === "open") {
          const c = p.list[p.cursor];
          if (c) p.sel[c.id] = !p.sel[c.id];
          rerender();
          return;
        }
        if (key.name === "return") {
          if (p.mode === "add") {
            const c = p.list[p.cursor];
            if (c) p.sel = { [c.id]: true };
          }
          void confirmPicker();
          return;
        }
      }
      return;
    }
    if (sx.sessionId) {
      switch (key.name) {
        case "up":
        case "k":
          sx.cursor = Math.max(0, cursor - 1);
          rerender();
          break;
        case "down":
        case "j":
          sx.cursor = Math.min(Math.max(0, s.items.length - 1), cursor + 1);
          rerender();
          break;
        case "x":
          void closeCurrent();
          break;
        case "a":
          openPicker("add");
          break;
        case "r":
          void retryNow();
          break;
        case "e": {
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
        case "escape":
        case "h":
          onBack();
          break;
      }
      return;
    }
    switch (key.name) {
      case "up":
      case "k":
        sx.histCursor = Math.max(0, histCursor - 1);
        rerender();
        break;
      case "down":
      case "j":
        sx.histCursor = Math.min(Math.max(0, sx.history.length - 1), histCursor + 1);
        rerender();
        break;
      case "o":
        openPicker("open");
        break;
      case "return": {
        const sess = sx.history[histCursor];
        if (sess && sess.status !== "open") void reopenSession(sess.id);
        else if (sess) say("session is already active.", "dim");
        rerender();
        break;
      }
      case "d": {
        const sess = sx.history[histCursor];
        if (!sess || sess.status === "open") break;
        if (sx.pendingDelete === sess.id) void deleteSession(sess.id);
        else {
          sx.pendingDelete = sess.id;
          say("delete session? press d again to confirm.", "bad");
          rerender();
        }
        break;
      }
      case "escape":
      case "h":
        onBack();
        break;
    }
  });

  if (s.picker) {
    const p = s.picker;
    return (
      <box flexDirection="column" flexGrow={1}>
        <text fg={T.text} attributes={TextAttributes.BOLD}>
          {p.mode === "open" ? "select computers — online only" : "add pc — online only"}
        </text>
        <box flexGrow={1} flexDirection="column" paddingTop={1}>
          {p.list === null ? (
            <text fg={T.dim}>checking PCs...</text>
          ) : !p.list.length ? (
            <text fg={T.dim}>no PCs online. check wifi or add one in PCs (3).</text>
          ) : (
            p.list.map((c, i) => (
              <box key={c.id} flexDirection="row">
                <text fg={i === p.cursor ? T.accent : T.faint}>{i === p.cursor ? ">" : " "}</text>
                <text fg={i === p.cursor ? T.text : T.dim}>
                  {" " + clip(`${p.mode === "open" ? `[${p.sel[c.id] ? "x" : " "}] ` : ""}${c.name}  ${c.base}`, width - 2)}
                </text>
              </box>
            ))
          )}
        </box>
        <text fg={T.faint}>{clip(p.mode === "open" ? "space toggle · enter start · esc back" : "enter add · esc back", width)}</text>
      </box>
    );
  }

  if (!s.sessionId) {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={T.text} attributes={TextAttributes.BOLD}>
            session history
          </text>
          <text fg={T.faint}>o new session</text>
        </box>
        <box flexGrow={1} flexDirection="column" paddingTop={1}>
          {s.history.length ? (
            s.history.map((h, i) => {
              const on = i === histCursor;
              const spec: ColSpec[] = [
                { key: "state", min: 8, text: h.status === "open" ? "[open]" : "[closed]" },
                { key: "when", min: 16, text: String(h.started_at || "").replace("T", " ").slice(0, 16) },
                { key: "tx", min: 5, align: "right", text: `${h.count || 0} tx` },
                { key: "pcs", min: 5, flex: 1, text: pcLabel(h.pcs) },
                { key: "flag", min: 0, text: h.complete ? "" : "incomplete" },
              ];
              return <Row key={h.id} on={on} bad={!h.complete} width={width} spec={spec} />;
            })
          ) : (
            <text fg={T.faint}>history is empty — press o to open a session.</text>
          )}
        </box>
        <Msg text={s.msg.t} tone={s.msg.tone} />
        <text fg={T.faint}>{clip("j/k move · enter resume · d delete (2x) · o new · esc back", width)}</text>
      </box>
    );
  }

  const kpis = [
    { label: "tx", value: String(s.totals.count) },
    { label: "cash", value: rupiah(s.totals.tunai) },
    { label: "noncash", value: rupiah(s.totals.nontunai) },
    { label: "total", value: rupiah(s.totals.all) },
  ];

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={T[statusTone(s.status)]} attributes={TextAttributes.BOLD}>{`[${s.status}]`}</text>
          <text fg={T.dim}>{clip(pcLabel(s.pcs), Math.max(0, width - 12))}</text>
        </box>
        <text fg={T.faint}>x close session</text>
      </box>
      <KpiGrid items={kpis} width={width} />
      <box flexGrow={1} flexDirection="column" paddingTop={1}>
        {!s.items.length ? (
          <text fg={T.faint}>no transactions in this session yet.</text>
        ) : (
          visible.map((it, i) => {
            const idx = start + i;
            const on = idx === cursor;
            const isEditing =
              it.t === "hilang" ? s.editingFill === it.hkey : it.fill ? s.editingFill === it.fill : s.editingTid !== null && s.editingTid === it.r.tid;
            return (
              <box key={it.t === "hilang" ? "h" + it.hkey : it.fill || it.r.tid || "tx" + idx} flexDirection="column">
                <Row on={on} bad={it.t === "hilang"} width={width} spec={txSpec(it)} />
                {isEditing ? (
                  <box flexDirection="row">
                    <text>{" "}</text>
                    <text fg={s.editFocus === "t" ? T.text : T.dim}>{"T:"}</text>
                    <text fg={T.text}>{s.editT + (s.editFocus === "t" ? "█" : "")}</text>
                    <text fg={s.editFocus === "n" ? T.text : T.dim}>{" NT:"}</text>
                    <text fg={T.text}>{s.editN + (s.editFocus === "n" ? "█" : "")}</text>
                    <text fg={T.faint}>{"  enter save · tab switch · esc cancel"}</text>
                  </box>
                ) : null}
              </box>
            );
          })
        )}
      </box>
      <Msg text={s.msg.t} tone={s.msg.tone} />
    </box>
  );
}
