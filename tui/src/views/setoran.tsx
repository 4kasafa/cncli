import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "../theme.js";
import { Field, Kpi, Modal, Msg, Sel, Secret, Tag } from "../ui.js";
import { viewKey, type ViewId } from "../keymap.js";
import * as Gas from "../gas.js";
import * as Store from "../store.js";
import * as Conflict from "../conflict.js";
import { rupiah, nowStamp } from "../fmt.js";

type FocusId = "email" | "pass" | "remember" | null;

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
  syncSeq: number;
  showLogin: boolean;
  autoLogin: boolean;
  cursor: number;
  focus: FocusId;
  offline: string | null;
  sheetKey: string | null;
  msg: { t: string; tone: "dim" | "ok" | "bad" };
}

const TONE = { dim: "dim", ok: "ok", bad: "bad" } as const;

export function SetoranView({ onView }: { onView: (v: ViewId) => void }) {
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
    syncSeq: 0,
    showLogin: false,
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

  async function doLogin() {
    const s = st.current;
    const em = s.email.trim().toLowerCase();
    const pw = s.pass;
    if (!em || !pw) {
      say("isi email + pass dulu.", "bad");
      rerender();
      return;
    }
    say("menghubungi GAS...", "dim");
    rerender();
    const my = ++s.syncSeq;
    const res = await Gas.login(em, pw);
    const s2 = st.current;
    if (my !== s2.syncSeq) return;
    s2.autoLogin = false;
    if (!res.success) {
      say("gagal: " + (res.message || "tanpa respon"), "bad");
      s2.showLogin = true;
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
    say("login ok.", "ok");
    s2.showLogin = false;
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
      s2.lastError = res.message || "Tidak ada respon";
      if (!s2.cache.length) say("gagal: " + s2.lastError + " — cek koneksi lalu r.", "bad");
      else s2.offline = "gagal sinkron: " + s2.lastError;
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

  function openLogin() {
    const s = st.current;
    s.showLogin = true;
    s.autoLogin = false;
    s.syncSeq++;
    s.focus = "email";
    rerender();
  }

  function doLogout() {
    const s = st.current;
    s.token = null;
    s.pass = "";
    s.showLogin = true;
    s.autoLogin = false;
    s.syncing = false;
    s.syncSeq++;
    s.lastError = null;
    s.cache = [];
    s.lastSync = null;
    s.offline = null;
    s.focus = "email";
    rerender();
  }

  function resolveSheet(useGas: boolean) {
    const s = st.current;
    if (!s.sheetKey) return;
    Conflict.resolve(s.cache, s.sheetKey, useGas);
    saveCache();
    s.sheetKey = null;
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
      st.current.showLogin = true;
      st.current.focus = "email";
      rerender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = st.current;
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
  const rowLines = Math.max(1, Math.floor((dims.height - 11) / 2));
  const start = Math.max(0, Math.min(cursor - Math.floor(rowLines / 2), rows.length - rowLines));
  const visible = rows.slice(start, start + rowLines);
  const status = s.syncing
    ? ["SYNC", "dim"] as const
    : Conflict.countConflicts(s.cache)
      ? [`CONF ${Conflict.countConflicts(s.cache)}`, "warn"] as const
      : s.lastError
        ? ["ERR", "bad"] as const
        : s.lastSync
          ? [`OK ${s.lastSync}`, "ok"] as const
          : [s.token ? "LOGIN" : "--", "faint"] as const;

  function statusOf(it: Conflict.GasItem): { label: string; tone: "bad" | "ok" | "faint" } {
    const stv = String(it.statusSelisih || "").toUpperCase();
    const v = Conflict.toInt(it.jumlahSelisih);
    if (stv === "KURANG" || v < 0) return { label: "KURANG", tone: "bad" };
    if (stv === "LEBIH" || v > 0) return { label: "LEBIH", tone: "ok" };
    return { label: "PAS", tone: "faint" };
  }

  useKeyboard((key) => {
    if (key.eventType === "release") return;
    const sx = st.current;
    if (sx.focus) {
      if (key.name === "escape") {
        sx.focus = null;
        rerender();
        return;
      }
      if (key.name === "tab") {
        sx.focus = sx.focus === "email" ? "pass" : sx.focus === "pass" ? "remember" : "email";
        rerender();
        return;
      }
      if (sx.focus === "remember" && key.name === "space") {
        sx.remember = !sx.remember;
        rerender();
        return;
      }
      if (sx.focus === "pass") {
        if (key.name === "return") {
          void doLogin();
          return;
        }
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
      if (key.name === "l") resolveSheet(false);
      else if (key.name === "g") resolveSheet(true);
      else if (key.name === "escape") {
        sx.sheetKey = null;
        rerender();
      }
      return;
    }
    const v = viewKey(key.name);
    if (v) {
      if (v !== "setoran") onView(v);
      return;
    }
    switch (key.name) {
      case "up":
        sx.cursor = Math.max(0, cursor - 1);
        rerender();
        break;
      case "down":
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
          say("login dulu.", "bad");
          openLogin();
        } else {
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
    }
  });

  const logged = !!s.token;
  const showForm = s.showLogin || (!logged && !s.autoLogin && !s.cache.length);
  const conflictRow = s.sheetKey ? s.cache.find((it) => Conflict.txKey(it) === s.sheetKey) : null;

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={4}>
        <Kpi label="periode" value={cur} tone="accent" />
        <Kpi label="tx" value={String(rows.length)} />
        <Kpi label="arsip" value={String(s.cache.length)} />
        <Kpi label="kurang" value={rupiah(kurang)} tone={kurang ? "bad" : "faint"} />
        <Kpi label="lebih" value={rupiah(lebih)} tone={lebih ? "ok" : "faint"} />
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={T.dim}>
          {logged
            ? `login sebagai ${s.email} · kasir: ${s.cashier || "-"}`
            : s.autoLogin
              ? "menghubungi GAS..."
              : s.cache.length
                ? `${s.email} (cache, belum login)`
                : "belum login"}
        </text>
        <text fg={T[status[1]] as string}>{`[${status[0]}]`}</text>
      </box>
      {s.offline ? (
        <text fg={T.warn}>{`offline: ${s.offline} — r coba lagi`}</text>
      ) : null}
      {showForm ? (
        <box flexDirection="column" paddingTop={1}>
          <Field
            label="email "
            value={s.email}
            focus={s.focus === "email"}
            placeholder="nama@email.com"
            width={30}
            onInput={(v) => {
              st.current.email = v;
              rerender();
            }}
            onSubmit={() => {
              st.current.focus = "pass";
              rerender();
            }}
          />
          <Secret label="pass  " value={s.pass} focus={s.focus === "pass"} />
          <box flexDirection="row" gap={1}>
            <text fg={s.focus === "remember" ? T.text : T.dim}>{`[${s.remember ? "x" : " "}]`}</text>
            <text fg={T.dim}>ingat di perangkat (creds.json 600)</text>
          </box>
          <text fg={T.faint}>{logged ? "tab antar field · enter masuk · esc tutup" : "tab antar field · enter masuk"}</text>
          <Msg text={s.msg.t} tone={TONE[s.msg.tone]} />
        </box>
      ) : (
        <box flexGrow={1} flexDirection="column" paddingTop={1}>
          {!rows.length ? (
            <text fg={T.faint}>└─ tidak ada transaksi periode ini.</text>
          ) : (
            visible.map((it, i) => {
              const idx = start + i;
              const on = idx === cursor;
              const stv = statusOf(it);
              return (
                <box key={(it.tanggal || "") + i} flexDirection="column">
                  <box flexDirection="row" gap={1}>
                    <Sel on={on} />
                    <text fg={on ? T.text : T.dim}>{`#${idx + 1}`}</text>
                    <text fg={T.dim}>{it.tanggal || "--"}</text>
                    <Tag label={String(it.shift || "--")} tone="dim" />
                    <text fg={T.faint}>{it.cabang || "--"}</text>
                    <Tag label={stv.label} tone={stv.tone} />
                    {it._conflict ? <Tag label="beda" tone="warn" /> : null}
                  </box>
                  <box flexDirection="row" gap={1}>
                    <text>{" "}</text>
                    <text fg={T.faint}>{`kasir: ${it.kasir || "--"}`}</text>
                    <text fg={T.dim}>{`K: ${rupiah(it.totalKomputer)} · F: ${rupiah(it.uangFisik)} · selisih: ${rupiah(it.jumlahSelisih)}`}</text>
                  </box>
                </box>
              );
            })
          )}
          {rows.length > visible.length ? (
            <text fg={T.faint}>{`… ${rows.length} baris (geser dengan ↑↓)`}</text>
          ) : null}
        </box>
      )}
      <Msg text={s.msg.t} tone={TONE[s.msg.tone]} />
      {conflictRow && conflictRow._conflict ? (
        <Modal title={`konflik: ${conflictRow.tanggal || "--"} / ${conflictRow.shift || "--"} / ${conflictRow.cabang || "--"}`} hint="l lokal · g gas · esc" widthPct={70} heightPct={40}>
          <box flexDirection="column" gap={1}>
            <text fg={T.dim}>{"lokal  " + fmt3(conflictRow._conflict.lokal)}</text>
            <text fg={T.dim}>{"gas    " + fmt3(conflictRow._conflict.gas)}</text>
          </box>
        </Modal>
      ) : null}
    </box>
  );
}

function fmt3(o: { totalKomputer: number; uangFisik: number; jumlahSelisih: number }): string {
  return `K: ${rupiah(o.totalKomputer)} | F: ${rupiah(o.uangFisik)} | S: ${rupiah(o.jumlahSelisih)}`;
}
