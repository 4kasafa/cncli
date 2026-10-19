import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { TextAttributes } from "@opentui/core";
import { T } from "./theme.js";
import { alignLR, clip, kpiCols } from "./layout.js";
export function Divider() {
    return _jsx("box", { width: "100%", height: 1, border: ["top"], borderStyle: "single", borderColor: T.line });
}
export function Tag({ label, tone = "dim" }) {
    return (_jsx("text", { fg: T[tone], attributes: TextAttributes.BOLD, children: "[" + label.toUpperCase() + "]" }));
}
export function Sel({ on }) {
    return _jsx("text", { fg: on ? T.accent : T.faint, children: on ? "›" : " " });
}
export function Panel({ title, grow, children }) {
    return (_jsx("box", { width: "100%", flexDirection: "column", border: true, borderStyle: "rounded", borderColor: T.accent, title: title, titleAlignment: "left", titleColor: T.accent, paddingX: 1, flexGrow: grow ? 1 : 0, children: children }));
}
export function Kpi({ label, value, tone = "text" }) {
    return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: T.faint, children: label }), _jsx("text", { fg: T[tone], attributes: TextAttributes.BOLD, children: value })] }));
}
export function Msg({ text, tone = "dim" }) {
    if (!text)
        return _jsx("text", { children: " " });
    return _jsx("text", { fg: T[tone], children: text });
}
export function Keybar({ items }) {
    const parts = [];
    items.forEach(([k, l], i) => {
        if (i)
            parts.push(_jsx("text", { fg: T.faint, children: "  " }, "s" + i));
        parts.push(_jsx("text", { fg: T.accent, children: k }, "k" + i));
        parts.push(_jsx("text", { fg: T.faint, children: " " + l }, "l" + i));
    });
    return (_jsx("box", { height: 1, paddingX: 1, flexDirection: "row", children: parts }));
}
export const inputStyle = {
    backgroundColor: T.surface,
    textColor: T.text,
    focusedBackgroundColor: T.surface,
    placeholderColor: T.faint,
};
export function Field({ label, value, onInput, onSubmit, focus = false, placeholder = "", width = 24, }) {
    return (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: focus ? T.text : T.dim, children: label }), _jsx("input", { ...inputStyle, focused: focus, value: value, onInput: onInput, onSubmit: onSubmit ? () => onSubmit(value) : undefined, placeholder: placeholder, width: width })] }));
}
export function Secret({ label, value, focus = false, width = 24 }) {
    const shown = "•".repeat(value.length);
    return (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: focus ? T.text : T.dim, children: label }), _jsx("text", { fg: T.text, children: shown + (focus ? "▏" : "") || (focus ? "▏" : "") }), !focus && !shown ? _jsx("text", { fg: T.faint, children: " ".repeat(Math.max(width - 1, 0)) }) : null] }));
}
export function Modal({ title, hint, children, widthPct = 78, heightPct = 80 }) {
    return (_jsx("box", { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", justifyContent: "center", alignItems: "center", zIndex: 10, children: _jsxs("box", { width: `${widthPct}%`, height: `${heightPct}%`, backgroundColor: T.surface, border: true, borderStyle: "rounded", borderColor: T.line, flexDirection: "column", padding: 1, gap: 1, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: title }), hint ? _jsx("text", { fg: T.faint, children: hint }) : null] }), children] }) }));
}
export function Breadcrumb({ parts }) {
    return (_jsx("text", { fg: T.accent, attributes: TextAttributes.BOLD, children: ["cncli", ...parts].join(" > ") }));
}
export function Hints({ items, max = 4 }) {
    return _jsx(Keybar, { items: items.slice(0, max) });
}
export function KpiGrid({ items, width }) {
    const n = kpiCols(width);
    const cell = Math.max(6, Math.floor((width - (n - 1)) / n));
    const rows = [];
    for (let i = 0; i < items.length; i += n)
        rows.push(items.slice(i, i + n));
    return (_jsx("box", { flexDirection: "column", children: rows.map((r, ri) => (_jsx("box", { flexDirection: "row", gap: 1, children: r.map((it, ci) => (_jsxs("box", { flexDirection: "column", width: cell, children: [_jsx("text", { fg: T.faint, children: clip(it.label.toUpperCase(), cell) }), _jsx("text", { fg: T[it.tone || "text"], attributes: TextAttributes.BOLD, children: clip(it.value, cell) })] }, ci))) }, ri))) }));
}
export function ListRow({ on, text, right, width, tone, rightTone, }) {
    const line = right === undefined ? clip(text, width - 2) : alignLR(text, right, width - 2);
    return (_jsxs("box", { flexDirection: "row", children: [_jsx("text", { fg: on ? T.accent : T.faint, children: on ? ">" : " " }), _jsx("text", { fg: T[tone || (on ? "text" : "dim")], children: " " + line })] }));
}
export function Page({ title, hint, children, width }) {
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: width ? clip(title, width) : title }), hint ? _jsx("text", { fg: T.faint, children: width ? clip(hint, width) : hint }) : null, children] }));
}
