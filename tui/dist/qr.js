import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as Comps from "./comps.js";
const run = promisify(execFile);
const CAMERA_TIMEOUT_MS = 15000;
const ZBAR_TIMEOUT_MS = 10000;
export function isTermux() {
    return !!process.env.TERMUX_VERSION || String(process.env.PREFIX || "").includes("com.termux");
}
function shortError(e) {
    const err = e;
    const line = String(err.stderr || err.message || "").trim().split(/\r?\n/)[0];
    return line.length > 120 ? line.slice(0, 120) : line;
}
function isCode(e, code) {
    return String(e.code) === code;
}
export async function scanQr() {
    if (!isTermux())
        return { ok: false, error: "scan needs Termux:API + zbar" };
    const shared = path.join(os.homedir(), "storage", "shared");
    if (!fs.existsSync(shared))
        return { ok: false, error: "storage not set up: run termux-setup-storage" };
    const photo = path.join(shared, ".cncli-qr-" + process.pid + ".jpg");
    try {
        try {
            fs.unlinkSync(photo);
        }
        catch {
            /* ponytail: stale temp file is overwritten by the camera */
        }
        try {
            // ponytail: camera 0, one shot per Enter; add a picker/retry if needed.
            await run("termux-camera-photo", ["-c", "0", photo], { timeout: CAMERA_TIMEOUT_MS });
        }
        catch (e) {
            if (isCode(e, "ENOENT"))
                return { ok: false, error: "termux-api not installed: pkg install termux-api" };
            if (isCode(e, "EACCES") || isCode(e, "EPERM"))
                return { ok: false, error: "camera permission denied: allow camera for Termux:API" };
            return { ok: false, error: "camera failed: " + (shortError(e) || "unknown error") };
        }
        if (!fs.existsSync(photo) || fs.statSync(photo).size === 0) {
            return { ok: false, error: "camera failed: empty photo (allow camera for Termux:API)" };
        }
        try {
            const { stdout } = await run("zbarimg", ["--quiet", "--raw", photo], { timeout: ZBAR_TIMEOUT_MS });
            const raw = String(stdout || "").trim();
            if (!raw)
                return { ok: false, error: "no QR code found" };
            return { ok: true, value: raw };
        }
        catch (e) {
            if (isCode(e, "4"))
                return { ok: false, error: "no QR code found" };
            if (isCode(e, "ENOENT"))
                return { ok: false, error: "zbar not installed: pkg install zbar" };
            return { ok: false, error: "scan failed: " + (shortError(e) || "unknown error") };
        }
    }
    finally {
        try {
            if (fs.existsSync(photo))
                fs.unlinkSync(photo);
        }
        catch {
            /* ponytail: temp cleanup is best effort */
        }
    }
}
export function qrAddress(raw) {
    const s = String(raw || "").trim();
    if (!s || /\s/.test(s))
        return null;
    const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !/^https?$/i.test(scheme[1])) {
        const after = s.slice(scheme[0].length);
        if (!/^\d+(\/|$)/.test(after))
            return null;
    }
    const base = Comps.normBase(s);
    if (!base)
        return null;
    try {
        const u = new URL(base);
        if (u.protocol !== "http:" && u.protocol !== "https:")
            return null;
        if (!u.hostname)
            return null;
        return base;
    }
    catch {
        return null;
    }
}
