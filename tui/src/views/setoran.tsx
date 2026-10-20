import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { T, type Tone } from "../theme.js";
import { Field, KpiGrid, Msg, Panel } from "../ui.js";
import { clip, planColumns, type ColSpec } from "../layout.js";
import { reportAmountText, reportBranchLabel, reportDateLabel, reportStatusLine } from "../rootinfo.js";
import * as Gas from "../gas.js";
import * as Store from "../store.js";
import * as Conflict from "../conflict.js";
import { rupiah, nowStamp } from "../fmt.js";

type FocusId = "email" | "pass" | "remember" | null;

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface St {
  email: string;
  pass: string;
  remember: boolean;
  token: string | null;
  cashier: string;
  cache: Conflict.GasItem[];
  lastSync: string | null;
  lastError: string | null;
  syncing: boolean;
  loggingIn: boolean;
  syncSeq: number;
  page: "main" | "login";
  autoLogin: boolean;
  cursor: number;
  focus: FocusId;
  offline: string | null;
  detailOpen: boolean;
  msg: { t: string; tone: "dim" | "ok" | "bad" };
}

export function SetoranView({ onBack, onTextMode }: { onBack: () => void; onTextMode?: (b: boolean) => void }) {
  const st = useRef<St>({
    email: "",
    pass: "",
    remember: false,
    token: null,
    cashier: "",
    cache: [],
    lastSync: null,
    lastError: null,
    syncing: false,
    loggingIn: false,
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
  const [spinFrame, setSpinFrame] = useState(0);
  const busy = Boolean(st.current.loggingIn || st.current.syncing);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setSpinFrame((n) => (n + 1) % SPIN.length), 90);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    onTextMode?.(st.current.page === "login");
  });

  function say(t: string, tone: "dim" | "ok" | "bad") {
    st.current.msg = { t, tone };
  }

  function loadCache(em: string, cash: string) {
    const s = st.current;
    const b = Store.loadArchiveBucket(em, cash);
    s.cache = b.data;
    s.lastSync = b.last_sync || null;
    s.cashier = b.cashier || cash;
  }

  function saveCache() {
    const s = st.current;
    if (!s.email) return;
    Store.saveArchiveBucket(s.email, { cashier: s.cashier, last_sync: s.lastSync, data: s.cache });
  }

  function openLogin() {
    const s = st.current;
    s.page = "login";
    s.autoLogin = false;
    s.loggingIn = false;
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
    s.loggingIn = true;
    say("contacting GAS...", "dim");
    rerender();
    const my = ++s.syncSeq;
    const res = await Gas.login(em, pw);
    const s2 = st.current;
    if (my !== s2.syncSeq) return;
    s2.loggingIn = false;
    s2.autoLogin = false;
    if (!res.success) {
      say("failed: " + (res.message || "no response"), "bad");
      s2.page = "login";
      s2.focus = "pass";
      rerender();
      return;
    }
    if (s2.remember) Store.saveCreds(em, pw);
    else Store.clearCreds();
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
    if (!s.token || s.syncing) return;
    s.syncing = true;
    s.lastError = null;
    const seq = ++s.syncSeq;
    rerender();
    const res = await Gas.fetchKasirSummary(s.email, s.pass, s.cashier);
    const s2 = st.current;
    if (seq !== s2.syncSeq) return;
    s2.syncing = false;
    if (!res.success) {
      s2.lastError = res.message || "no response";
      if (!s2.cache.length) say("failed: " + s2.lastError + " — check connection, then r.", "bad");
      else s2.offline = "sync failed: " + s2.lastError;
      rerender();
      return;
    }
    s2.offline = null;
    Conflict.mergeGasData(s2.cache, res.data);
    s2.lastSync = nowStamp();
    if (res.user) s2.cashier = typeof res.user === "object" ? res.user.name || s2.cashier : String(res.user);
    saveCache();
    rerender();
  }

  function doLogout() {
    const s = st.current;
    s.token = null;
    s.pass = "";
    s.autoLogin = false;
    s.syncing = false;
    s.loggingIn = false;
    s.syncSeq++;
    s.lastError = null;
    s.cache = [];
    s.lastSync = null;
    s.offline = null;
    openLogin();
  }

  function resolveDetail(row: Conflict.GasItem | undefined, useGas: boolean) {
    const s = st.current;
    if (!row || !row._conflict) return;
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
    } else {
      st.current.page = "login";
      st.current.focus = "email";
      rerender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = st.current;
  const spinChar = SPIN[spinFrame % SPIN.length];
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
    if (v < 0) kurang += Math.abs(v);
    else if (v > 0) lebih += v;
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
  const syncTone: Tone = s.syncing ? "dim" : s.lastError ? "bad" : s.lastSync ? "ok" : s.token ? "text" : "faint";

  useKeyboard((key) => {
    if (key.eventType === "release") return;
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
        if (sx.detailOpen) resolveDetail(rows[cursor], false);
        break;
      case "r":
        if (!sx.token) {
          say("sign in first.", "bad");
          openLogin();
        } else {
          loadCache(sx.email, sx.cashier);
          rerender();
          void syncGas();
        }
        break;
      case "g":
        if (sx.detailOpen) {
          const row = rows[cursor];
          if (row && row._conflict) resolveDetail(row, true);
        } else {
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
        } else {
          onBack();
        }
        break;
    }
  });

  if (s.page === "login") {
    return (
      <box flexDirection="column" flexGrow={1}>
        <text fg={T.text} attributes={TextAttributes.BOLD}>
          sign in — GAS
        </text>
        <box flexDirection="column" paddingTop={1} gap={1}>
          <Field
            label="email"
            value={s.email}
            focus={s.focus === "email"}
            placeholder="name@email.com"
            width={Math.max(12, Math.min(34, width - 12))}
            onInput={(v) => {
              st.current.email = v;
              rerender();
            }}
            onSubmit={() => {
              st.current.focus = "pass";
              rerender();
            }}
          />
          <box flexDirection="row" gap={1}>
            <box width={8}>
              <text fg={s.focus === "pass" ? T.text : T.dim}>pass</text>
            </box>
            <text fg={T.text}>{"•".repeat(s.pass.length) + (s.focus === "pass" ? "█" : "")}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <box width={8}>
              <text fg={T.faint}>remember</text>
            </box>
            <text fg={s.focus === "remember" ? T.text : T.dim}>{`[${s.remember ? "x" : " "}] on this device (creds.json 600)`}</text>
          </box>
        </box>
        <box paddingTop={1}>
          <text fg={T.faint}>{clip("tab move · enter sign in · esc back", width)}</text>
        </box>
        <box flexGrow={1} />
        <Msg
          text={s.loggingIn ? clip(s.msg.t, Math.max(0, innerWidth - 2)) : s.msg.t}
          tone={s.msg.tone}
          lead={s.loggingIn ? spinChar + " " : undefined}
        />
      </box>
    );
  }

  const kpis = [
    { label: "period", value: cur },
    { label: "tx", value: String(rows.length) },
    { label: "over", value: rupiah(lebih), tone: (lebih ? "ok" : "faint") as Tone },
    { label: "short", value: rupiah(kurang), tone: (kurang ? "bad" : "faint") as Tone },
  ];

  const amountMin = Math.max(11, ...rows.map((it) => reportAmountText(it).length));

  function rowSpec(it: Conflict.GasItem): ColSpec[] {
    return [
      { key: "when", min: 12, text: reportDateLabel(it.tanggal, it.shift) },
      { key: "amount", min: amountMin, text: reportAmountText(it) },
      { key: "branch", min: 8, flex: 1, text: reportBranchLabel(it.cabang) },
    ];
  }

  function renderRow(it: Conflict.GasItem, on: boolean, i: number) {
    const specs = rowSpec(it);
    const widths = planColumns(Math.max(0, innerWidth - 6), specs);
    const cells = specs.map((sp, ci) => clip(sp.text ?? "", widths[ci]).padEnd(widths[ci]));
    const st = reportStatusLine(it);
    const tone: Tone = st.label === "SHORT" ? "bad" : st.label === "OVER" ? "ok" : "dim";
    return (
      <box key={(it.tanggal || "") + i} flexDirection="column">
        <box flexDirection="row">
          <text fg={on ? T.accent : T.faint}>{on ? ">" : " "}</text>
          <text fg={on ? T.text : T[tone]} attributes={on ? TextAttributes.BOLD : undefined}>
            {" " + cells[0]}
          </text>
          <text fg={on ? T.text : T[tone]} attributes={on ? TextAttributes.BOLD : undefined}>
            {" " + cells[1]}
          </text>
          <text fg={on ? T.text : T[tone]} attributes={on ? TextAttributes.BOLD : undefined}>
            {"   " + cells[2]}
          </text>
        </box>
        {on && s.detailOpen ? (
          <box flexDirection="column" paddingLeft={2}>
            {it._conflict ? (
              <>
                <text fg={T.dim}>{clip("local " + fmt3(it._conflict.lokal), innerWidth - 2)}</text>
                <text fg={T.dim}>{clip("GAS   " + fmt3(it._conflict.gas), innerWidth - 2)}</text>
                <text fg={T.faint}>{clip("l use local · g use GAS · enter close", innerWidth - 2)}</text>
              </>
            ) : (
              <text fg={T.dim}>
                {clip(
                  fmt3({
                    totalKomputer: Conflict.toInt(it.totalKomputer),
                    uangFisik: Conflict.toInt(it.uangFisik),
                    jumlahSelisih: Conflict.toInt(it.jumlahSelisih),
                  }),
                  innerWidth - 2,
                )}
              </text>
            )}
          </box>
        ) : null}
      </box>
    );
  }

  const note = s.loggingIn
    ? s.msg.t
    : s.syncing
      ? "syncing..."
      : [s.msg.t, s.offline ? s.offline + " — r to retry" : ""].filter(Boolean).join(" · ");
  const noteTone: Tone = busy ? "dim" : s.offline ? "warn" : s.msg.tone;
  const emailRoom = Math.max(0, innerWidth - syncText.length - 1);
  const hint =
    s.detailOpen && detailRow?._conflict
      ? "enter close · l local · g GAS · esc back"
      : "enter diff · r sync · g account · x sign out · esc back";

  return (
    <box flexDirection="column" flexGrow={1}>
      <Panel title="summary">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={T.accent} attributes={TextAttributes.BOLD}>
            {clip(s.email || "--", emailRoom)}
          </text>
          <text fg={T[syncTone]} attributes={TextAttributes.BOLD}>
            {clip(syncText, innerWidth)}
          </text>
        </box>
        <KpiGrid items={kpis} width={innerWidth} cols={2} />
      </Panel>
      <Panel title="transactions" grow>
        <box flexGrow={1} flexDirection="column">
          {!rows.length ? (
            <text fg={T.faint}>no transactions this period.</text>
          ) : (
            visible.map((it, i) => renderRow(it, start + i === cursor, start + i))
          )}
          {rows.length > visible.length ? (
            <text fg={T.faint}>{clip(`... ${rows.length} rows (scroll up/down)`, innerWidth)}</text>
          ) : null}
        </box>
        <Msg
          text={clip(note, Math.max(0, innerWidth - (busy ? 2 : 0)))}
          tone={noteTone}
          lead={busy ? spinChar + " " : undefined}
        />
        <text fg={T.faint}>{clip(hint, innerWidth)}</text>
      </Panel>
    </box>
  );
}

function fmt3(o: { totalKomputer: number; uangFisik: number; jumlahSelisih: number }): string {
  return `K: ${rupiah(o.totalKomputer)} · F: ${rupiah(o.uangFisik)} · S: ${rupiah(o.jumlahSelisih)}`;
}
