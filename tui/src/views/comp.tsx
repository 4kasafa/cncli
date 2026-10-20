import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T, type Tone } from "../theme.js";
import { Field, Msg, Panel } from "../ui.js";
import { clip } from "../layout.js";
import * as Lan from "../lan.js";
import * as Store from "../store.js";
import * as Comps from "../comps.js";
import { qrAddress, scanQr } from "../qr.js";

type Page = "list" | "add" | "edit" | "log";
type Pending = "w-on" | "w-off" | "wipe" | "log" | null;
type ScanState = "idle" | "countdown" | "running" | "found" | "error";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface St {
  page: Page;
  list: Comps.Comp[];
  active: Record<string, boolean>;
  cursor: number;
  editingId: string | null;
  newName: string;
  newBase: string;
  edName: string;
  edBase: string;
  focus: "name" | "base" | "scan" | null;
  scanState: ScanState;
  scanCount: number;
  scanLines: string[];
  scanSeq: number;
  pendingDel: string | null;
  detail: Record<string, unknown> | null;
  detailId: string | null;
  detailBusy: boolean;
  detailSeq: number;
  statusLine: string;
  statusBadge: { label: string; tone: "ok" | "bad" | "dim" };
  watcherEnabled: boolean | null;
  pendingAction: Pending;
  pin: string;
  wipeConfirm: string;
  pinFocus: "pin" | "confirm";
  loading: string | null;
  reqSeq: number;
  logLines: string[] | null;
  logId: string | null;
  msg: { t: string; tone: "dim" | "ok" | "bad" };
}

function badgeOf(st: Comps.CompState): { label: string; tone: "ok" | "bad" | "dim" } {
  if (st.state === "ok") return { label: "ok", tone: "ok" };
  if (st.state === "lama") return { label: "stale", tone: "ok" };
  if (st.state === "putus") return { label: "down", tone: "bad" };
  return { label: "--", tone: "dim" };
}

function fmtLastUsed(ms: number): string {
  if (!ms) return "never";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

export function CompView({ onBack, onTextMode }: { onBack: () => void; onTextMode?: (b: boolean) => void }) {
  const st = useRef<St>({
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
    scanState: "idle",
    scanCount: 0,
    scanLines: [],
    scanSeq: 0,
    pendingDel: null,
    detail: null,
    detailId: null,
    detailBusy: false,
    detailSeq: 0,
    statusLine: "",
    statusBadge: { label: "--", tone: "dim" },
    watcherEnabled: null,
    pendingAction: null,
    pin: "",
    wipeConfirm: "",
    pinFocus: "pin",
    loading: null,
    reqSeq: 0,
    logLines: null,
    logId: null,
    msg: { t: "", tone: "dim" },
  });
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);
  const dims = useTerminalDimensions();
  const [spinFrame, setSpinFrame] = useState(0);
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const s = st.current;
  const scanBusy = s.scanState === "countdown" || s.scanState === "running";
  const busy = scanBusy || Boolean(s.loading);
  const spinChar = SPIN[spinFrame % SPIN.length];

  useEffect(() => {
    onTextMode?.(s.page === "add" || s.page === "edit" || s.pendingAction !== null);
  });

  useEffect(() => {
    if (!busy) {
      setSpinFrame(0);
      return;
    }
    const id = setInterval(() => setSpinFrame((n) => (n + 1) % SPIN.length), 90);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    void (async () => {
      await refreshList();
      checkAllNow();
    })();
    return () => {
      st.current.scanSeq++;
      clearScanTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function say(t: string, tone: "dim" | "ok" | "bad") {
    st.current.msg = { t, tone };
  }

  function beginLoad(label: string): number {
    const sx = st.current;
    const seq = ++sx.reqSeq;
    sx.loading = label;
    rerender();
    return seq;
  }

  function endLoad(seq: number) {
    const sx = st.current;
    if (seq !== sx.reqSeq) return;
    sx.loading = null;
    rerender();
  }

  function clearScanTimer() {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
  }

  function pushScanLog(line: string) {
    const sx = st.current;
    sx.scanLines.push(line);
    if (sx.scanLines.length > 200) sx.scanLines.splice(0, sx.scanLines.length - 200);
  }

  function selected(): Comps.Comp | null {
    const sx = st.current;
    return sx.list[sx.cursor] || null;
  }

  async function refreshList() {
    const sx = st.current;
    sx.list = Comps.list();
    sx.cursor = Math.min(Math.max(0, sx.cursor), Math.max(0, sx.list.length - 1));
    sx.active = {};
    for (const c of sx.list) sx.active[c.id] = await Store.isCompInOpenSession(c.id);
    rerender();
  }

  function checkAllNow(silent = false) {
    const seq = beginLoad("checking connections...");
    if (!silent) {
      say("checking all PCs...", "dim");
      rerender();
    }
    void (async () => {
      await Comps.checkAll();
      await refreshList();
      const sx = st.current;
      endLoad(seq);
      if (!silent) {
        say("", "dim");
        rerender();
      }
      const row = sx.list[sx.cursor];
      await loadDetail(row?.id || null);
    })();
  }

  async function loadDetail(id: string | null) {
    const sx = st.current;
    const my = ++sx.detailSeq;
    sx.detailId = id;
    sx.detail = null;
    sx.detailBusy = !!id;
    sx.watcherEnabled = null;
    sx.statusLine = "";
    sx.statusBadge = id ? badgeOf(Comps.st(id)) : { label: "--", tone: "dim" };
    rerender();
    if (!id) return;
    const c = Comps.get(id);
    if (!c) {
      sx.detailBusy = false;
      rerender();
      return;
    }
    const seq = beginLoad("getting status...");
    const r = await Lan.statusGet(c.base);
    const cur = st.current;
    if (my !== cur.detailSeq || cur.detailId !== id) {
      endLoad(seq);
      return;
    }
    if (!r.ok && r.error === Lan.ERR_LEGACY) {
      const h = await Lan.health(c.base);
      const after = st.current;
      if (my !== after.detailSeq || after.detailId !== id) {
        endLoad(seq);
        return;
      }
      after.detailBusy = false;
      after.statusLine = h.ok ? "legacy PC: update firmware first" : "PC not reachable";
      after.statusBadge = h.ok ? { label: "stale", tone: "ok" } : { label: "down", tone: "bad" };
      endLoad(seq);
      rerender();
      return;
    }
    if (!r.ok) {
      cur.detailBusy = false;
      cur.statusLine = c.base;
      cur.statusBadge = { label: "down", tone: "bad" };
      cur.msg = { t: r.error || "failed", tone: "bad" };
      endLoad(seq);
      rerender();
      return;
    }
    const d = (r.data || {}) as Record<string, unknown>;
    cur.detail = d;
    cur.detailBusy = false;
    cur.statusLine = "v" + (d.version || "?") + " · " + (d.ip || "?") + ":" + (d.port || "?");
    cur.statusBadge = { label: "ok", tone: "ok" };
    cur.watcherEnabled = !!d.watcher_enabled;
    endLoad(seq);
    rerender();
  }

  function selectAt(i: number) {
    const sx = st.current;
    const next = Math.min(Math.max(0, i), Math.max(0, sx.list.length - 1));
    sx.cursor = next;
    sx.pendingDel = null;
    sx.pendingAction = null;
    sx.pin = "";
    sx.wipeConfirm = "";
    rerender();
    void loadDetail(sx.list[next]?.id || null);
  }

  function beginAction(action: Exclude<Pending, null>) {
    if (!selected()) return;
    const sx = st.current;
    sx.pendingAction = action;
    sx.pin = "";
    sx.wipeConfirm = "";
    sx.pinFocus = "pin";
    say("", "dim");
    rerender();
  }

  function openAdd() {
    resetScan();
    const sx = st.current;
    sx.page = "add";
    sx.editingId = null;
    sx.newName = "";
    sx.newBase = "";
    sx.focus = "name";
    say("", "dim");
    rerender();
  }

  function openEdit() {
    const row = selected();
    if (!row) return;
    resetScan();
    const sx = st.current;
    sx.page = "edit";
    sx.editingId = row.id;
    sx.edName = row.name;
    sx.edBase = row.base;
    sx.focus = "name";
    say("", "dim");
    rerender();
  }

  function resetScan() {
    clearScanTimer();
    const sx = st.current;
    sx.scanSeq++;
    sx.scanState = "idle";
    sx.scanCount = 0;
    sx.scanLines = [];
    setSpinFrame(0);
  }

  function discardScan() {
    clearScanTimer();
    const sx = st.current;
    sx.scanSeq++;
    sx.scanState = "idle";
    sx.scanCount = 0;
  }

  function cancelScan() {
    const sx = st.current;
    const active = sx.scanState === "countdown" || sx.scanState === "running";
    clearScanTimer();
    sx.scanSeq++;
    if (active) {
      sx.scanState = "idle";
      sx.scanCount = 0;
      pushScanLog("scan cancelled");
    }
    rerender();
  }

  function leaveForm() {
    discardScan();
    const sx = st.current;
    sx.page = "list";
    sx.focus = null;
    sx.editingId = null;
    rerender();
  }

  function startScan() {
    const sx = st.current;
    if (sx.page !== "add" && sx.page !== "edit") return;
    if (sx.scanState === "countdown" || sx.scanState === "running") return;
    clearScanTimer();
    const my = ++sx.scanSeq;
    sx.scanState = "countdown";
    sx.scanCount = 3;
    pushScanLog("scan starts in 3...");
    rerender();
    let left = 3;
    scanTimer.current = setInterval(() => {
      const cur = st.current;
      if (my !== cur.scanSeq) {
        clearScanTimer();
        return;
      }
      left -= 1;
      if (left > 0) {
        cur.scanCount = left;
        pushScanLog("scan starts in " + left + "...");
        rerender();
        return;
      }
      clearScanTimer();
      cur.scanCount = 0;
      void runScan(my);
    }, 1000);
  }

  async function runScan(my: number) {
    const sx = st.current;
    if (my !== sx.scanSeq) return;
    sx.scanState = "running";
    rerender();
    const r = await scanQr((line) => {
      const cur = st.current;
      if (my !== cur.scanSeq) return;
      pushScanLog(line);
      rerender();
    });
    const cur = st.current;
    if (my !== cur.scanSeq) return;
    if (r.ok) {
      const addr = qrAddress(r.value || "");
      if (!addr) {
        cur.scanState = "error";
        cur.focus = "scan";
        pushScanLog("QR payload is not an HTTP(S) URL");
      } else {
        cur.scanState = "found";
        if (cur.page === "add") cur.newBase = addr;
        else cur.edBase = addr;
        cur.focus = "base";
        pushScanLog("qr found");
      }
    } else {
      cur.scanState = "error";
      cur.focus = "scan";
      pushScanLog(r.error === "no QR code found" ? "qr not found — press enter to try again" : r.error || "scan failed");
    }
    rerender();
  }

  async function setWatcher(enabled: boolean) {
    const sx = st.current;
    const c = selected();
    if (!c) return;
    if (!sx.pin) {
      say("fill the pin first.", "bad");
      rerender();
      return;
    }
    const seq = beginLoad("updating watcher...");
    const r = await Lan.watcherSet(c.base, sx.pin, enabled);
    const cur = st.current;
    if (r.ok) {
      const d = (r.data || {}) as { enabled?: boolean };
      cur.watcherEnabled = !!d.enabled;
      cur.pendingAction = null;
      cur.pin = "";
      say("watcher " + (d.enabled ? "on" : "off"), "ok");
      void loadDetail(c.id);
    } else {
      say(r.error || "failed", "bad");
      if (r.status === 403 || r.status === 429) cur.pin = "";
    }
    endLoad(seq);
    rerender();
  }

  async function doWipe() {
    const sx = st.current;
    const c = selected();
    if (!c) return;
    if (await Store.isCompInOpenSession(c.id)) {
      say("pc is in an active session: close the session first", "bad");
      rerender();
      return;
    }
    const seq = beginLoad("wiping data...");
    const r = await Lan.wipe(c.base, sx.pin, sx.wipeConfirm);
    const cur = st.current;
    if (r.ok) {
      const n = (r.data as { deleted?: number } | undefined)?.deleted;
      cur.pendingAction = null;
      cur.pin = "";
      cur.wipeConfirm = "";
      say("deleted " + (n == null ? "?" : n), "ok");
      void loadDetail(c.id);
    } else {
      say(r.error || "failed", "bad");
      if (r.status === 400) cur.wipeConfirm = "";
      else if (r.status === 403 || r.status === 429) cur.pin = "";
    }
    endLoad(seq);
    rerender();
  }

  async function loadLog() {
    const sx = st.current;
    const c = selected();
    if (!c) return;
    if (!sx.pin) {
      say("fill the pin first.", "bad");
      rerender();
      return;
    }
    const seq = beginLoad("loading log...");
    const r = await Lan.logGet(c.base, sx.pin, 200);
    const cur = st.current;
    if (r.ok) {
      const lines = (r.data as { lines?: string[] } | undefined)?.lines;
      cur.logLines = Array.isArray(lines) && lines.length ? lines : ["(empty)"];
      cur.logId = c.id;
      cur.pendingAction = null;
      cur.pin = "";
      cur.page = "log";
      say("", "dim");
    } else {
      say(r.error || "failed", "bad");
      if (r.status === 403 || r.status === 429) cur.pin = "";
    }
    endLoad(seq);
    rerender();
  }

  function saveAdd() {
    const sx = st.current;
    const r = Comps.add(sx.newName, sx.newBase);
    if (!r.ok) {
      pushScanLog("save: " + (r.error || "failed"));
      rerender();
      return;
    }
    discardScan();
    sx.page = "list";
    sx.focus = null;
    sx.newName = "";
    sx.newBase = "";
    say("added " + (r.comp?.name || ""), "ok");
    void (async () => {
      await refreshList();
      checkAllNow(true);
    })();
  }

  function saveEdit() {
    const sx = st.current;
    if (!sx.editingId) return;
    const r = Comps.upsert(sx.editingId, sx.edName, sx.edBase);
    if (!r.ok) {
      pushScanLog("save: " + (r.error || "failed"));
      rerender();
      return;
    }
    discardScan();
    sx.page = "list";
    sx.focus = null;
    sx.editingId = null;
    say("updated", "ok");
    void (async () => {
      await refreshList();
      checkAllNow(true);
    })();
  }

  async function deleteAt(id: string) {
    const sx = st.current;
    if (await Store.isCompInOpenSession(id)) {
      say("pc is used by an active session, close it first", "bad");
      rerender();
      return;
    }
    Comps.remove(id);
    sx.pendingDel = null;
    sx.editingId = null;
    say("deleted", "ok");
    await refreshList();
    const row = st.current.list[st.current.cursor];
    await loadDetail(row?.id || null);
  }

  const width = Math.max(20, dims.width - 2);
  const innerWidth = Math.max(10, width - 4);
  const cursor = Math.min(Math.max(0, s.cursor), Math.max(0, s.list.length - 1));
  const listLines = Math.max(1, dims.height - 18 - (s.pendingAction ? 3 : 0));
  const start = Math.max(0, Math.min(cursor - Math.floor(listLines / 2), s.list.length - listLines));
  const visible = s.list.slice(start, start + listLines);
  const sel = s.list[cursor];
  const active = sel ? !!s.active[sel.id] : false;
  const d = s.detail;
  const watcher = d ? (d.watcher_enabled ? "on" : "off") + (d.watcher_alive ? " (alive)" : " (dead)") : "--";
  const store = d ? (d.ketoko ? "present" : "absent") : "--";
  const today = d ? String(d.count_today ?? "?") + " tx" + (d.last_no ? " · last no " + String(d.last_no) : "") : "--";
  const uptime = d && d.uptime_s != null ? Math.round(Number(d.uptime_s)) + "s" : "--";
  const db = d ? (d.db_busy ? "busy" : "ok") : "--";
  const pendingLabel =
    s.pendingAction === "w-on" ? "watcher pin" : s.pendingAction === "w-off" ? "watcher pin" : s.pendingAction === "wipe" ? "wipe pin" : s.pendingAction === "log" ? "log pin" : "";

  function statusRow(label: string, value: string, tone: Tone = "dim") {
    return (
      <box flexDirection="row">
        <box width={9}>
          <text fg={T.faint}>{label}</text>
        </box>
        <text fg={T[tone]}>{clip(value, Math.max(0, innerWidth - 9))}</text>
      </box>
    );
  }

  useKeyboard((key) => {
    if (key.eventType === "release") return;
    const sx = st.current;

    if (sx.page === "add" || sx.page === "edit") {
      if (key.name === "escape") {
        key.preventDefault();
        if (sx.scanState === "countdown" || sx.scanState === "running") cancelScan();
        else leaveForm();
        return;
      }
      if (key.name === "tab" || key.name === "down") {
        key.preventDefault();
        sx.focus = sx.focus === "name" ? "base" : sx.focus === "base" ? "scan" : "name";
        rerender();
        return;
      }
      if (key.name === "return") {
        key.preventDefault();
        if (sx.focus === "name") {
          sx.focus = "base";
          rerender();
          return;
        }
        if (sx.focus === "scan") {
          startScan();
          return;
        }
        sx.page === "add" ? saveAdd() : saveEdit();
        rerender();
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        sx.focus = sx.focus === "scan" ? "base" : sx.focus === "base" ? "name" : "name";
        rerender();
        return;
      }
      return;
    }

    if (sx.page === "log") {
      if (key.name === "escape" || key.name === "h") {
        sx.page = "list";
        rerender();
      }
      return;
    }

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
        if (sx.pendingAction === "wipe" && sx.pinFocus === "confirm") sx.wipeConfirm = sx.wipeConfirm.slice(0, -1);
        else sx.pin = sx.pin.slice(0, -1);
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
        if (sx.pendingAction === "w-on") void setWatcher(true);
        else if (sx.pendingAction === "w-off") void setWatcher(false);
        else if (sx.pendingAction === "log") void loadLog();
        return;
      }
      if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
        if (sx.pendingAction === "wipe" && sx.pinFocus === "confirm") sx.wipeConfirm += key.sequence.toUpperCase();
        else sx.pin += key.sequence;
        rerender();
      }
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        selectAt(cursor - 1);
        break;
      case "down":
      case "j":
        selectAt(cursor + 1);
        break;
      case "return":
      case "r":
        checkAllNow();
        break;
      case "a":
        openAdd();
        break;
      case "e":
        openEdit();
        break;
      case "d": {
        key.preventDefault();
        const row = sx.list[cursor];
        if (!row) break;
        if (sx.pendingDel === row.id) void deleteAt(row.id);
        else {
          sx.pendingDel = row.id;
          say("press d again to delete " + row.name, "bad");
          rerender();
        }
        break;
      }
      case "w":
        beginAction("w-on");
        break;
      case "m":
        beginAction("w-off");
        break;
      case "l":
        beginAction("log");
        break;
      case "x":
        beginAction("wipe");
        break;
      case "escape":
      case "h":
        if (sx.pendingDel) {
          sx.pendingDel = null;
          rerender();
          break;
        }
        onBack();
        break;
    }
  });

  if (s.page === "add" || s.page === "edit") {
    const isAdd = s.page === "add";
    const logRoom = Math.max(3, dims.height - 18);
    const shownLog = s.scanLines.slice(-logRoom);
    const scanStatus =
      s.scanState === "countdown"
        ? "scan starts in " + s.scanCount + "..."
        : s.scanState === "running"
          ? "scanning..."
          : s.scanState === "found"
            ? "qr found — press enter to save"
            : s.scanState === "error"
              ? "scan failed — press enter to try again"
              : "ready";
    return (
      <box flexDirection="column" flexGrow={1}>
        <Panel title={isAdd ? "new computer" : "edit computer"}>
          <box flexDirection="column" paddingTop={1}>
            <Field
              label="name"
              value={isAdd ? s.newName : s.edName}
              focus={s.focus === "name"}
              placeholder="kasir 1"
              width={Math.max(12, Math.min(30, innerWidth - 12))}
              onInput={(v) => {
                if (isAdd) st.current.newName = v;
                else st.current.edName = v;
              }}
              onSubmit={() => {
                st.current.focus = "base";
                rerender();
              }}
            />
            <Field
              label="address"
              value={isAdd ? s.newBase : s.edBase}
              focus={s.focus === "base"}
              placeholder="http://192.168.1.5:8765"
              width={Math.max(12, Math.min(36, innerWidth - 12))}
              onInput={(v) => {
                if (isAdd) st.current.newBase = v;
                else st.current.edBase = v;
              }}
              onSubmit={() => (isAdd ? saveAdd() : saveEdit())}
            />
            <text fg={s.focus === "scan" ? T.text : T.dim} attributes={s.focus === "scan" ? TextAttributes.BOLD : undefined}>
              {scanBusy ? "scanning..." : "[ scan qr ]"}
            </text>
          </box>
        </Panel>
        <Panel title="scan qr" grow>
          <text fg={T.faint}>{clip("point the camera at the QR code on the PC screen", innerWidth)}</text>
          <box flexDirection="row" gap={1}>
            <text fg={T.accent}>{scanBusy ? spinChar : " "}</text>
            <text fg={scanBusy ? T.text : T.dim}>{clip(scanStatus, Math.max(0, innerWidth - 2))}</text>
          </box>
          <box flexGrow={1} flexDirection="column">
            {shownLog.length ? (
              shownLog.map((ln, i) => (
                <text key={i} fg={T.dim} wrapMode="none">
                  {clip(ln || " ", innerWidth)}
                </text>
              ))
            ) : (
              <text fg={T.faint}>{clip("press enter on scan qr to start.", innerWidth)}</text>
            )}
          </box>
          <Msg text={clip(s.msg.t, innerWidth)} tone={s.msg.tone} />
          <text fg={T.faint}>{clip("tab move · enter scan/save · esc cancel/back", innerWidth)}</text>
        </Panel>
      </box>
    );
  }

  if (s.page === "log") {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={T.text} attributes={TextAttributes.BOLD}>
            log — {Comps.byName(s.logId)}
          </text>
          <text fg={T.faint}>last 200 lines</text>
        </box>
        <scrollbox flexGrow={1} width="100%" focused>
          {(s.logLines || ["(empty)"]).map((ln, i) => (
            <text key={i} fg={T.dim} wrapMode="char">
              {ln || " "}
            </text>
          ))}
        </scrollbox>
        <text fg={T.faint}>{clip("up/down scroll · esc back", width)}</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <Panel title="status">
        {sel ? (
          <>
            <box flexDirection="row" gap={1}>
              <text fg={T.text} attributes={TextAttributes.BOLD}>
                {clip(sel.name, Math.max(4, innerWidth - 14 - (active ? 15 : 0)))}
              </text>
              <text fg={T[s.statusBadge.tone]}>{`[${s.statusBadge.label}]`}</text>
              {active ? <text fg={T.faint}>· session active</text> : null}
            </box>
            {statusRow("address", sel.base)}
            {statusRow("version", s.statusLine || (s.detailBusy ? "loading..." : "--"))}
            {statusRow("watcher", watcher + " · store " + store)}
            {statusRow("today", today)}
            {statusRow("info", "uptime " + uptime + " · db " + db + " · last used " + fmtLastUsed(sel.last_used))}
          </>
        ) : (
          <text fg={T.faint}>no PC selected</text>
        )}
        {s.pendingAction ? (
          <box flexDirection="column" paddingTop={1}>
            <box flexDirection="row" gap={1}>
              <box width={12}>
                <text fg={s.pinFocus === "pin" ? T.text : T.dim}>{pendingLabel}</text>
              </box>
              <text fg={T.text}>{"•".repeat(s.pin.length) + (s.pinFocus === "pin" ? "█" : "")}</text>
            </box>
            {s.pendingAction === "wipe" ? (
              <box flexDirection="row" gap={1}>
                <box width={12}>
                  <text fg={s.pinFocus === "confirm" ? T.text : T.dim}>type WIPE</text>
                </box>
                <text fg={T.text}>{s.wipeConfirm + (s.pinFocus === "confirm" ? "█" : "")}</text>
              </box>
            ) : null}
            <text fg={T.faint}>
              {clip(s.pendingAction === "wipe" ? "type · enter next/send · esc cancel" : "type pin · enter send · esc cancel", innerWidth)}
            </text>
          </box>
        ) : null}
        <Msg text={clip(s.msg.t, innerWidth)} tone={s.msg.tone} />
      </Panel>
      <Panel title={"computers (" + s.list.length + ")"} grow>
        <box flexGrow={1} flexDirection="column">
          {s.list.length ? (
            visible.map((c, i) => {
              const idx = start + i;
              const on = idx === cursor;
              const b = badgeOf(Comps.st(c.id));
              const suffix = (s.active[c.id] ? " · session" : "") + (s.pendingDel === c.id ? " · delete? d" : "");
              const line = clip(`${c.name} [${b.label}] ${c.base}${suffix}`, innerWidth - 2);
              return (
                <box key={c.id} flexDirection="row">
                  <text fg={on ? T.accent : T.faint}>{on ? ">" : " "}</text>
                  <text fg={b.label === "down" ? T.bad : on ? T.text : T.dim} attributes={on ? TextAttributes.BOLD : undefined}>
                    {" " + line}
                  </text>
                </box>
              );
            })
          ) : (
            <text fg={T.faint}>no PCs yet — press a to add one.</text>
          )}
        </box>
        <Msg
          text={clip(s.loading ?? "", Math.max(0, innerWidth - (s.loading ? 2 : 0)))}
          tone="dim"
          lead={s.loading ? spinChar + " " : undefined}
        />
        <text fg={T.faint}>{clip("enter/r refresh · a add · e edit · d delete · w/m watcher · l log · x wipe · esc back", innerWidth)}</text>
      </Panel>
    </box>
  );
}
