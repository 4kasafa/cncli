const TIMEOUT_MS = 8000;
function toInt(v) {
    const n = parseInt(String(v == null ? "" : v), 10);
    return isNaN(n) ? 0 : n;
}
export function base(b) {
    return String(b || "").trim().replace(/\/+$/, "");
}
function mapErr(status, bodyErr, isTimeout) {
    if (isTimeout)
        return "PC tak terjangkau, satu WiFi?";
    if (status === 400)
        return String(bodyErr || "permintaan ditolak PC");
    if (status === 403)
        return "PIN salah";
    if (status === 409)
        return "PC sibuk, coba lagi";
    if (status === 429)
        return "terkunci 5 menit";
    return String(bodyErr || "PC menolak (HTTP " + status + ")");
}
async function get(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), toInt(ms) > 0 ? toInt(ms) : TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok)
            return { ok: false, error: "HTTP " + res.status };
        return { ok: true, data: await res.json() };
    }
    catch (e) {
        const err = e;
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : String((err && err.message) || err) };
    }
    finally {
        clearTimeout(t);
    }
}
export async function health(baseUrl, ms) {
    const r = await get(base(baseUrl) + "/api/health", ms);
    if (!r.ok)
        return { ok: false, error: r.error };
    const d = r.data;
    return { ok: !!(d && (d.ok === true || d.ok === undefined)), raw: d };
}
function normRow(r) {
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
export async function fetchTx(baseUrl, since, limit) {
    const lim = limit || 50;
    const r = await get(base(baseUrl) + "/api/transactions?since=" + encodeURIComponent(toInt(since)) + "&limit=" + encodeURIComponent(lim));
    if (!r.ok)
        return { ok: false, error: r.error, rows: [] };
    const d = r.data;
    const arr = Array.isArray(d) ? d : d && Array.isArray(d.rows) ? d.rows : [];
    return { ok: true, rows: arr.map((x) => normRow(x)) };
}
export async function postJson(baseUrl, p, obj) {
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
            let body = null;
            try {
                body = (await res.json());
            }
            catch {
                /* empty */
            }
            return { ok: false, error: mapErr(res.status, body && body.error, false), status: res.status };
        }
        return { ok: true, data: await res.json(), status: res.status };
    }
    catch (e) {
        const err = e;
        if (err && err.name === "AbortError")
            return { ok: false, error: mapErr(0, null, true), status: 0 };
        return { ok: false, error: String((err && err.message) || err), status: 0 };
    }
    finally {
        clearTimeout(t);
    }
}
export async function print(baseUrl, payload) {
    const r = await postJson(baseUrl, "/api/print", payload);
    if (!r.ok)
        return { ok: false, error: r.error };
    return { ok: true, data: r.data };
}
export async function wipe(baseUrl, pin, confirm) {
    return postJson(baseUrl, "/api/wipe", { pin, confirm });
}
export async function watcherGet(baseUrl) {
    const r = await get(base(baseUrl) + "/api/watcher");
    if (!r.ok)
        return { ok: false, error: r.error === "timeout" ? mapErr(0, null, true) : r.error };
    return { ok: true, data: r.data };
}
export async function watcherSet(baseUrl, pin, enabled) {
    return postJson(baseUrl, "/api/watcher", { pin, enabled });
}
export async function statusGet(baseUrl, ms) {
    const r = await get(base(baseUrl) + "/api/status", ms);
    if (!r.ok)
        return { ok: false, error: r.error === "timeout" ? mapErr(0, null, true) : r.error, status: 0 };
    const d = r.data;
    if (!d || d.version == null)
        return { ok: false, error: "PC versi lama, update dulu", status: 200 };
    return { ok: true, data: d, status: 200 };
}
export async function logGet(baseUrl, pin, tail) {
    let t = toInt(tail) || 200;
    if (t < 1)
        t = 1;
    if (t > 1000)
        t = 1000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(base(baseUrl) + "/api/log?pin=" + encodeURIComponent(pin || "") + "&tail=" + encodeURIComponent(t), { signal: ctrl.signal });
        if (!res.ok) {
            let body = null;
            try {
                body = (await res.json());
            }
            catch {
                /* empty */
            }
            return { ok: false, error: mapErr(res.status, body && body.error, false), status: res.status };
        }
        return { ok: true, data: await res.json(), status: res.status };
    }
    catch (e) {
        const err = e;
        if (err && err.name === "AbortError")
            return { ok: false, error: mapErr(0, null, true), status: 0 };
        return { ok: false, error: String((err && err.message) || err), status: 0 };
    }
    finally {
        clearTimeout(timer);
    }
}
