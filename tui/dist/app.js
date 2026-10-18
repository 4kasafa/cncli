import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "./theme.js";
import { Divider, Keybar, Modal } from "./ui.js";
import { GLOBAL_KEYBAR, HELP, VIEW_KEYBAR, VIEWS } from "./keymap.js";
import { SetoranView } from "./views/setoran.js";
import { LiveView } from "./views/live.js";
import { PrintView } from "./views/print.js";
import { CompView } from "./views/comp.js";
import * as Store from "./store.js";
export function App({ renderer }) {
    const [view, setView] = useState("setoran");
    const [help, setHelp] = useState(false);
    const [statusRight, setStatusRight] = useState("");
    const { width } = useTerminalDimensions();
    useEffect(() => {
        let live = true;
        const tick = async () => {
            const s = await Store.openSessionOf();
            if (!live)
                return;
            setStatusRight(s ? `${(s.pcs || []).length} pc · ${s.count || 0} tx` : "tanpa sesi");
        };
        void tick();
        const t = setInterval(() => void tick(), 5000);
        return () => {
            live = false;
            clearInterval(t);
        };
    }, [view]);
    useKeyboard((key) => {
        if (key.ctrl && key.name === "c") {
            renderer.destroy();
            process.exit(0);
        }
        if (key.name === "?" || (key.shift && key.name === "/")) {
            setHelp((h) => !h);
            return;
        }
        if (help && (key.name === "escape" || key.name === "q"))
            setHelp(false);
    });
    const label = VIEWS.find((x) => x.id === view)?.label ?? view;
    const bar = [...GLOBAL_KEYBAR, ...VIEW_KEYBAR[view]];
    return (_jsxs("box", { width: "100%", height: "100%", flexDirection: "column", backgroundColor: T.bg, children: [_jsxs("box", { height: 1, paddingX: 1, flexDirection: "row", justifyContent: "space-between", children: [_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("text", { fg: T.text, attributes: TextAttributes.BOLD, children: "cncli" }), _jsx("text", { fg: T.faint, children: "/" }), _jsx("text", { fg: T.accent, children: label }), _jsx("text", { fg: T.faint, children: "─".repeat(Math.max(0, Math.min(40, width - 30))) })] }), _jsx("text", { fg: T.dim, children: statusRight })] }), _jsx(Divider, {}), _jsxs("box", { flexGrow: 1, flexDirection: "column", paddingX: 1, children: [view === "setoran" ? _jsx(SetoranView, { onView: setView }) : null, view === "live" ? _jsx(LiveView, { onView: setView }) : null, view === "print" ? _jsx(PrintView, { onView: setView }) : null, view === "comp" ? _jsx(CompView, { onView: setView }) : null] }), _jsx(Divider, {}), _jsx(Keybar, { items: bar }), help ? (_jsx(Modal, { title: "bantuan", hint: "esc tutup", widthPct: 82, heightPct: 70, children: _jsx("box", { flexDirection: "column", children: HELP.map(([k, l], i) => k === "" ? (_jsx("text", { children: " " }, i)) : (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 10, children: _jsx("text", { fg: T.accent, children: k }) }), _jsx("text", { fg: T.dim, children: l })] }, i))) }) })) : null] }));
}
