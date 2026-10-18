// gas_service.py:25 — deviceId "CNmobile" dipertahankan agar kontrak GAS tak berubah
const GAS_URL_KASIR = "https://script.google.com/macros/s/AKfycbw95Qnt8U-GQWt04AeG3sBpBfcBleNLfPMSr0arOXtGDH2iZiMDVoWHyBmNpW8Shejo/exec";
const TIMEOUT_MS = 20000;
export async function callApi(action, args) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(GAS_URL_KASIR, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action, args }),
            signal: ctrl.signal,
        });
        return (await res.json());
    }
    catch (e) {
        const err = e;
        return { success: false, message: "Koneksi gagal: " + ((err && err.message) || err) };
    }
    finally {
        clearTimeout(t);
    }
}
export async function login(email, password) {
    const res = await callApi("checkLogin", [{ email: String(email || "").trim(), password, deviceId: "CNmobile" }]);
    if (!res || !res.success) {
        return { success: false, message: (res && res.message) || "Email atau password salah!" };
    }
    const m = /token=([^&]+)/.exec(String(res.redirectUrl || ""));
    const token = m ? decodeURIComponent(m[1]) : "token_" + Date.now();
    return { success: true, token, user: res.user };
}
export async function getDashboardData(token, cashierName) {
    const res = await callApi("getDashboardData", [token, cashierName || ""]);
    if (!res || !res.success) {
        return { success: false, message: (res && (res.error || res.message)) || "Gagal memuat data transaksi", data: [] };
    }
    const data = res.data || [];
    let totalKurang = 0;
    let totalLebih = 0;
    for (const it of data) {
        const s = Number((it || {}).jumlahSelisih) || 0;
        if (s < 0)
            totalKurang += Math.abs(s);
        else if (s > 0)
            totalLebih += s;
    }
    return {
        success: true,
        total_transaksi: res.totalTransaksi != null ? res.totalTransaksi : data.length,
        total_kurang: totalKurang,
        total_lebih: totalLebih,
        data,
    };
}
export async function fetchKasirSummary(email, password, cashierName) {
    const l = await login(email, password);
    if (!l.success)
        return { success: false, stage: "login", message: l.message };
    const d = await getDashboardData(l.token, cashierName);
    if (!d.success)
        return { success: false, stage: "fetch", message: d.message };
    return { ...d, token: l.token, user: l.user };
}
