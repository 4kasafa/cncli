import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { readFileSync } from "node:fs";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { VIEWS } from "../keymap.js";
import { clip, rootBudget } from "../layout.js";
function pkgVersion() {
    try {
        const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
        return String(pkg.version || "0.1.0");
    }
    catch {
        return "0.1.0";
    }
}
const VERSION = pkgVersion();
const TAGLINE = "termux-first cashier cli | v" + VERSION;
const EMPTY_STATUS = new Set(["no session", "no meta", "none paired", "not logged in", "…"]);
function statusTone(status) {
    return EMPTY_STATUS.has(status) ? "dim" : "ok";
}
function Logo({ width, font }) {
    const color = font === "tiny" ? T.accent : [T.accent, T.text];
    return (_jsx("box", { width: "100%", flexDirection: "row", justifyContent: "center", children: _jsx("ascii-font", { text: "CNCLI", font: font, color: color, backgroundColor: T.bg }) }));
}
function MenuBox({ label, status, on, width, }) {
    return (_jsx("box", { width: "100%", border: true, borderStyle: "rounded", borderColor: on ? T.accent : T.line, title: label, titleAlignment: "left", titleColor: on ? T.accent : T.faint, paddingX: 1, children: _jsx("text", { fg: on ? T.text : T[statusTone(status)], attributes: on ? TextAttributes.BOLD : undefined, children: clip(status, Math.max(0, width - 6)) }) }));
}
export function RootMenu({ sum, sel, width, height, }) {
    const { font, tagline, gaps } = rootBudget(width, height);
    const rows = [];
    rows.push(tagline ? (_jsx("box", { width: "100%", flexDirection: "row", justifyContent: "center", children: _jsx("text", { fg: T.dim, children: clip(TAGLINE, Math.max(0, width - 2)) }) }, "tagline")) : null);
    if (gaps)
        rows.push(_jsx("text", { children: " " }, "spacer"));
    VIEWS.forEach((v, i) => {
        if (i > 0 && gaps)
            rows.push(_jsx("text", { children: " " }, "gap" + i));
        rows.push(_jsx(MenuBox, { label: v.label.toLowerCase(), status: sum[v.id], on: sel === i, width: width }, v.id));
    });
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, width: "100%", children: [font ? _jsx(Logo, { width: width, font: font }) : null, rows] }));
}
