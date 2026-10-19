import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { readFileSync } from "node:fs";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { VIEWS } from "../keymap.js";
import { clip, rootBudget } from "../layout.js";
import { contentRows, rootLines } from "../rootinfo.js";
function pkgVersion() {
    try {
        const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
        return String(pkg.version || "0.4.1");
    }
    catch {
        return "0.4.1";
    }
}
const VERSION = pkgVersion();
const TAGLINE = "cash note cli | v" + VERSION;
const BOX_OF = { live: "live", print: "print", comp: "pcs", setoran: "reports" };
function Logo({ font }) {
    const color = font === "tiny" ? T.accent : [T.accent, T.text];
    return (_jsx("box", { width: "100%", flexDirection: "row", justifyContent: "center", children: _jsx("ascii-font", { text: "CNCLI", font: font, color: color, backgroundColor: T.bg }) }));
}
function MenuBox({ label, lines, on, width, onPress, }) {
    return (_jsx("box", { width: "100%", border: true, borderStyle: "rounded", borderColor: on ? T.accent : T.line, title: label, titleAlignment: "left", titleColor: on ? T.accent : T.text, paddingX: 1, paddingTop: 1, onMouseDown: (e) => {
            if (e.button === 0)
                onPress();
        }, children: lines.map((ln, i) => (_jsx("text", { fg: on ? T.text : T.dim, attributes: on ? TextAttributes.BOLD : undefined, children: clip(ln, Math.max(0, width - 6)) }, i))) }));
}
export function RootMenu({ data, sel, width, height, onPick, }) {
    const view = rootLines(data);
    const { font, tagline, gaps, compact } = rootBudget(width, height, contentRows(view));
    const rows = [];
    rows.push(tagline ? (_jsx("box", { width: "100%", flexDirection: "row", justifyContent: "center", children: _jsx("text", { fg: T.dim, children: clip(TAGLINE, Math.max(0, width - 2)) }) }, "tagline")) : null);
    if (gaps)
        rows.push(_jsx("text", { children: " " }, "spacer"));
    VIEWS.forEach((v, i) => {
        const key = BOX_OF[v.id];
        const all = view.lines[key];
        rows.push(_jsx(MenuBox, { label: v.label.toLowerCase(), lines: compact ? all.slice(0, 1) : all, on: sel === i, width: width, onPress: () => onPick(i) }, v.id));
    });
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, width: "100%", children: [font ? _jsx("text", { children: " " }, "topgap") : null, font ? _jsx(Logo, { font: font }) : null, rows] }));
}
