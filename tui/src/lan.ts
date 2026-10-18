export interface LanResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
  status?: number;
}

export interface LanTxRow {
  server_id: number;
  no_transaksi: string;
  no_urut: string;
  total: number;
  tunai: number;
  nontunai: number;
  bank: string;
  kategori: string;
  created_at: string;
}

const TIMEOUT_MS = 8000;

export const ERR_LEGACY = "PC version too old: update firmware first";

function toInt(v: unknown): number {
  const n = parseInt(String(v == null ? "" : v), 10);
  return isNaN(n) ? 0 : n;
}

export function base(b: string | undefined): string {
  return String(b || "").trim().replace(/\/+$/, "");
}

function mapErr(status: number, bodyErr: unknown, isTimeout: boolean): string {
  if (isTimeout) return "PC unreachable — same wifi?";
  if (status === 400) return String(bodyErr || "request rejected by PC");
  if (status === 403) return "wrong PIN";
  if (status === 409) return "PC busy, try again";
  if (status === 429) return "locked for 5 minutes";
  return String(bodyErr || "PC rejected (HTTP " + status + ")");
}

async function get(url: string, ms?: number): Promise<LanResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), toInt(ms) > 0 ? toInt(ms) : TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    return { ok: true, data: await res.json() };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err && err.name === "AbortError" ? "timeout" : String((err && err.message) || err) };
  } finally {
    clearTimeout(t);
  }
}

export async function health(baseUrl: string, ms?: number): Promise<{ ok: boolean; error?: string; raw?: Record<string, unknown> }> {
  const r = await get(base(baseUrl) + "/api/health", ms);
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data as Record<string, unknown> | null;
  return { ok: !!(d && (d.ok === true || d.ok === undefined)), raw: d as Record<string, unknown> };
}

function normRow(r: Record<string, unknown> | null): LanTxRow {
  r = r || {};
  return {
    server_id: toInt(r.id),
    no_transaksi: String(r.no_transaksi == null ? "" : r.no_transaksi),
    no_urut: String(r.no_urut == null ? "" : r.no_urut),
    total: toInt(r.total),
    tunai: toInt(r.tunai),
    nontunai: toInt(r.nontunai),
    bank: String(r.bank || ""),
    kategori: String(r.kategori || ""),
    created_at: String(r.created_at || ""),
  };
}

export async function fetchTx(baseUrl: string, since: unknown, limit?: number): Promise<{ ok: boolean; error?: string; rows: LanTxRow[] }> {
  const lim = limit || 50;
  const r = await get(base(baseUrl) + "/api/transactions?since=" + encodeURIComponent(toInt(since)) + "&limit=" + encodeURIComponent(lim));
  if (!r.ok) return { ok: false, error: r.error, rows: [] };
  const d = r.data as unknown[] | { rows?: unknown[] } | null;
  const arr = Array.isArray(d) ? d : d && Array.isArray((d as { rows?: unknown[] }).rows) ? (d as { rows: unknown[] }).rows : [];
  return { ok: true, rows: arr.map((x) => normRow(x as Record<string, unknown>)) };
}

export async function postJson(baseUrl: string, p: string, obj: unknown): Promise<LanResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base(baseUrl) + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj || {}),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body: { error?: unknown } | null = null;
      try {
        body = (await res.json()) as { error?: unknown };
      } catch {
        /* empty */
      }
      return { ok: false, error: mapErr(res.status, body && body.error, false), status: res.status };
    }
    return { ok: true, data: await res.json(), status: res.status };
  } catch (e) {
    const err = e as Error;
    if (err && err.name === "AbortError") return { ok: false, error: mapErr(0, null, true), status: 0 };
    return { ok: false, error: String((err && err.message) || err), status: 0 };
  } finally {
    clearTimeout(t);
  }
}

export async function print(baseUrl: string, payload: unknown): Promise<LanResult> {
  const r = await postJson(baseUrl, "/api/print", payload);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: r.data };
}

export async function wipe(baseUrl: string, pin: string, confirm: string): Promise<LanResult> {
  return postJson(baseUrl, "/api/wipe", { pin, confirm });
}

export async function watcherGet(baseUrl: string): Promise<LanResult> {
  const r = await get(base(baseUrl) + "/api/watcher");
  if (!r.ok) return { ok: false, error: r.error === "timeout" ? mapErr(0, null, true) : r.error };
  return { ok: true, data: r.data };
}

export async function watcherSet(baseUrl: string, pin: string, enabled: boolean): Promise<LanResult> {
  return postJson(baseUrl, "/api/watcher", { pin, enabled });
}

export async function statusGet(baseUrl: string, ms?: number): Promise<LanResult> {
  const r = await get(base(baseUrl) + "/api/status", ms);
  if (!r.ok) return { ok: false, error: r.error === "timeout" ? mapErr(0, null, true) : r.error, status: 0 };
  const d = r.data as { version?: unknown } | null;
  if (!d || d.version == null) return { ok: false, error: ERR_LEGACY, status: 200 };
  return { ok: true, data: d, status: 200 };
}

export async function logGet(baseUrl: string, pin: string, tail?: number): Promise<LanResult> {
  let t = toInt(tail) || 200;
  if (t < 1) t = 1;
  if (t > 1000) t = 1000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base(baseUrl) + "/api/log?pin=" + encodeURIComponent(pin || "") + "&tail=" + encodeURIComponent(t), { signal: ctrl.signal });
    if (!res.ok) {
      let body: { error?: unknown } | null = null;
      try {
        body = (await res.json()) as { error?: unknown };
      } catch {
        /* empty */
      }
      return { ok: false, error: mapErr(res.status, body && body.error, false), status: res.status };
    }
    return { ok: true, data: await res.json(), status: res.status };
  } catch (e) {
    const err = e as Error;
    if (err && err.name === "AbortError") return { ok: false, error: mapErr(0, null, true), status: 0 };
    return { ok: false, error: String((err && err.message) || err), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
