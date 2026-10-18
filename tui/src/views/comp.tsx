import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "../theme.js";
import { Field, Modal, Msg, Sel, Tag } from "../ui.js";
import { viewKey, type ViewId } from "../keymap.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";

type FocusId = "new-name" | "new-base" | "ed-name" | "ed-base" | "watch-pin" | "wipe-pin" | "wipe-confirm" | "log-pin" | null;

interface St {
  list: Comps.Comp[];
  active: Record<string, boolean>;
  cursor: number;
  adding: boolean;
  editingId: string | null;
  newName: string;
  newBase: string;
  edName: string;
  edBase: string;
  pendingDel: string | null;
  ctlId: string | null;
  ctlBusy: boolean;
  detail: Record<string, unknown> | null;
  ctlBadge: { label: string; tone: "ok" | "bad" | "dim" };
  ctlStatusLine: string;
  watcherEnabled: boolean | null;
  watchPin: string;
  wipePin: string;
  wipeConfirm: string;
  logPin: string;
  logLines: string[] | null;
  focus: FocusId;
  msg: { t: string; tone: "dim" | "ok" | "bad" };
  ctlMsg: { t: string; tone: "dim" | "ok" | "bad" };
}

function badgeOf(st: Comps.CompState): { label: string; tone: "ok" | "bad" | "dim" } {
  if (st.state === "ok") return { label: "[ok]", tone: "ok" };
  if (st.state === "lama") return { label: "[OK·lama]", tone: "ok" };
  if (st.state === "putus") return { label: "[PUTUS]", tone: "bad" };
  return { label: "[--]", tone: "dim" };
}

export function CompView({ onView }: { onView: (v: ViewId) => void }) {
  const st = useRef<St>({
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

  function say(t: string, tone: "dim" | "ok" | "bad") {
    st.current.msg = { t, tone };
  }
  function ctlSay(t: string, tone: "dim" | "ok" | "bad") {
    st.current.ctlMsg = { t, tone };
  }

  async function refreshList() {
    const s = st.current;
    s.list = Comps.list();
    for (const c of s.list) s.active[c.id] = await Store.isCompInOpenSession(c.id);
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

  function openCtl(id: string) {
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
    if (!s.ctlId) return;
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
      if (sx.ctlId !== c.id) return;
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
      const d = (r.data || {}) as Record<string, unknown>;
      sx.detail = d;
      sx.ctlStatusLine = "└─ v" + (d.version || "?") + " · " + (d.ip || "?") + ":" + (d.port || "?");
      sx.ctlBadge = { label: "[OK]", tone: "ok" };
      sx.watcherEnabled = !!d.watcher_enabled;
      ctlSay("", "dim");
    } finally {
      const sx = st.current;
      sx.ctlBusy = false;
      rerender();
    }
  }

  async function setWatcher(enabled: boolean) {
    const s = st.current;
    if (!s.ctlId) return;
    const c = Comps.get(s.ctlId);
    if (!c) return;
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
      const d = (r.data || {}) as { enabled?: boolean };
      sx.watcherEnabled = !!d.enabled;
      ctlSay("watcher " + (d.enabled ? "nyala" : "mati"), "ok");
      sx.watchPin = "";
    } else {
      ctlSay(r.error || "gagal", "bad");
      if (r.status === 403 || r.status === 429) sx.watchPin = "";
    }
    rerender();
  }

  async function doWipe() {
    const s = st.current;
    if (!s.ctlId) return;
    const c = Comps.get(s.ctlId);
    if (!c) return;
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
      const n = (r.data as { deleted?: number } | undefined)?.deleted;
      ctlSay("dihapus " + (n == null ? "?" : n), "ok");
      sx.wipePin = "";
      sx.wipeConfirm = "";
    } else {
      ctlSay(r.error || "gagal", "bad");
      if (r.status === 400) sx.wipeConfirm = "";
      else if (r.status === 403 || r.status === 429) sx.wipePin = "";
    }
    rerender();
  }

  async function loadLog() {
    const s = st.current;
    if (!s.ctlId) return;
    const c = Comps.get(s.ctlId);
    if (!c) return;
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
      const lines = (r.data as { lines?: string[] } | undefined)?.lines;
      sx.logLines = Array.isArray(lines) && lines.length ? lines : ["(kosong)"];
      ctlSay("", "dim");
    } else {
      ctlSay(r.error || "gagal", "bad");
      if (r.status === 403 || r.status === 429) sx.logPin = "";
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
    if (!s.editingId) return;
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

  async function deleteAt(id: string) {
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
  const ctlFields: FocusId[] = ["watch-pin", "wipe-pin", "wipe-confirm", "log-pin"];

  useKeyboard((key) => {
    if (key.eventType === "release") return;
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
            if (sx.focus === "watch-pin") sx.watchPin = sx.watchPin.slice(0, -1);
            else if (sx.focus === "wipe-pin") sx.wipePin = sx.wipePin.slice(0, -1);
            else if (sx.focus === "log-pin") sx.logPin = sx.logPin.slice(0, -1);
            else sx.wipeConfirm = sx.wipeConfirm.slice(0, -1);
            rerender();
            return;
          }
          if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
            const ch = isConfirm ? key.sequence.toUpperCase() : key.sequence;
            if (sx.focus === "watch-pin") sx.watchPin += ch;
            else if (sx.focus === "wipe-pin") sx.wipePin += ch;
            else if (sx.focus === "log-pin") sx.logPin += ch;
            else sx.wipeConfirm += ch;
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
      if (v !== "comp") onView(v);
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
        if (row) openCtl(row.id);
        break;
      case "a":
        sx.adding = !sx.adding;
        sx.editingId = null;
        sx.newName = "";
        sx.newBase = "";
        if (sx.adding) sx.focus = "new-name";
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
        if (!row) break;
        if (sx.pendingDel === row.id) void deleteAt(row.id);
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
    if (!d) return null;
    return (
      "watcher " +
      (d.watcher_enabled ? "nyala" : "mati") +
      (d.watcher_alive ? " (hidup)" : " (tak hidup)") +
      " · ketoko " +
      (d.ketoko ? "ada" : "tak ada") +
      " · tx hari ini " +
      (d.count_today == null ? "?" : String(d.count_today)) +
      (d.last_no ? " · " + String(d.last_no) : "") +
      (d.uptime_s != null ? " · up " + Math.round(Number(d.uptime_s)) + " dtk" : "") +
      (d.db_busy ? " · db sibuk" : "")
    );
  })();

  if (s.ctlId) {
    const c = Comps.get(s.ctlId);
    const logHeight = Math.max(3, Math.floor(dims.height / 3));
    return (
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" gap={2}>
          <text fg={T.text}>{`kontrol: ${c?.name || "--"}`}</text>
          <text fg={T.faint}>{c?.base || ""}</text>
          <Tag label={st.current.ctlBadge.label} tone={st.current.ctlBadge.tone} />
        </box>
        <text fg={T.dim}>{st.current.ctlStatusLine}</text>
        {detailLine ? <text fg={T.dim}>{"└─ " + detailLine}</text> : null}
        <box flexDirection="column" paddingTop={1}>
          <box flexDirection="row" gap={1}>
            <text fg={st.current.focus === "watch-pin" ? T.text : T.dim}>{"pin watcher"}</text>
            <text fg={T.text}>{"•".repeat(st.current.watchPin.length) + (st.current.focus === "watch-pin" ? "▏" : "")}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={st.current.focus === "wipe-pin" ? T.text : T.dim}>{"pin wipe   "}</text>
            <text fg={T.text}>{"•".repeat(st.current.wipePin.length) + (st.current.focus === "wipe-pin" ? "▏" : "")}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={st.current.focus === "wipe-confirm" ? T.text : T.dim}>{"ketik HAPUS"}</text>
            <text fg={T.text}>{st.current.wipeConfirm + (st.current.focus === "wipe-confirm" ? "▏" : "")}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={st.current.focus === "log-pin" ? T.text : T.dim}>{"pin log    "}</text>
            <text fg={T.text}>{"•".repeat(st.current.logPin.length) + (st.current.focus === "log-pin" ? "▏" : "")}</text>
          </box>
          <text fg={T.faint}>{"tab pilih field · w watcher nyala · m mati · l log · x wipe · r reload · esc kembali"}</text>
          <Msg text={st.current.ctlMsg.t} tone={st.current.ctlMsg.tone} />
        </box>
        <box flexDirection="column" height={logHeight + 1}>
          <text fg={T.faint}>{st.current.logLines ? "└─ log (200 baris terakhir)" : "└─ log: l untuk muat"}</text>
          {st.current.logLines ? (
            <scrollbox height={logHeight} width="100%">
              {st.current.logLines.map((ln, i) => (
                <text key={i} fg={T.dim} wrapMode="none">
                  {ln || " "}
                </text>
              ))}
            </scrollbox>
          ) : null}
        </box>
      </box>
    );
  }

  const rowLines = Math.max(2, Math.floor((dims.height - 8) / 2));

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2}>
        <text fg={T.text}>daftar computer</text>
        <text fg={T.faint}>{`${s.list.length} pc · enter kontrol · a tambah · e ubah · d hapus (2x) · r cek ulang`}</text>
      </box>
      {s.adding ? (
        <box flexDirection="row" gap={1} paddingTop={1}>
          <Field label="nama  " value={s.newName} focus={s.focus === "new-name"} placeholder="kasir 1" width={14} onInput={(v) => { st.current.newName = v; }} onSubmit={() => { st.current.focus = "new-base"; rerender(); }} />
          <Field label="alamat" value={s.newBase} focus={s.focus === "new-base"} placeholder="http://192.168.1.5:8765" width={26} onInput={(v) => { st.current.newBase = v; }} onSubmit={saveAdd} />
          <text fg={T.faint}>{"enter simpan · esc batal"}</text>
        </box>
      ) : null}
      <box flexDirection="column" paddingTop={1}>
        {!s.list.length ? (
          <text fg={T.faint}>└─ belum ada computer. a tambah dulu.</text>
        ) : (
          s.list.slice(0, rowLines).map((c, i) => {
            const b = badgeOf(Comps.st(c.id));
            const on = i === Math.min(Math.max(0, s.cursor), Math.max(0, s.list.length - 1));
            return (
              <box key={c.id} flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <Sel on={on} />
                  <text fg={on ? T.text : T.dim}>{c.name}</text>
                  <Tag label={b.label} tone={b.tone} />
                  {s.active[c.id] ? <Tag label="sesi aktif" tone="warn" /> : null}
                  {s.pendingDel === c.id ? <Tag label="yakin? d" tone="bad" /> : null}
                </box>
                <box flexDirection="row" gap={1}>
                  <text>{" "}</text>
                  <text fg={T.faint}>{c.base}</text>
                </box>
                {s.editingId === c.id ? (
                  <box flexDirection="row" gap={1}>
                    <Field label="nama  " value={s.edName} focus={s.focus === "ed-name"} width={14} onInput={(v) => { st.current.edName = v; }} onSubmit={() => { st.current.focus = "ed-base"; rerender(); }} />
                    <Field label="alamat" value={s.edBase} focus={s.focus === "ed-base"} width={26} onInput={(v) => { st.current.edBase = v; }} onSubmit={saveEdit} />
                    <text fg={T.faint}>{"enter simpan · esc batal"}</text>
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
