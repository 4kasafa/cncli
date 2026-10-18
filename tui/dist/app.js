import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/react/jsx-runtime";
import { useEffect, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "./theme.js";
import { Breadcrumb, Divider, Hints } from "./ui.js";
import { HELP, ROOT_HINTS, VIEWS, VIEW_HINTS, viewKey } from "./keymap.js";
import { RootMenu } from "./views/root.js";
import { SetoranView } from "./views/setoran.js";
import { LiveView } from "./views/live.js";
import { PrintView } from "./views/print.js";
import { CompView } from "./views/comp.js";
import { clip } from "./layout.js";
import * as Store from "./store.js";
import * as Comps from "./comps.js";
export function App({ renderer }) {
    const [view, setView] = useState(null);
    const [help, setHelp] = useState(false);
    const [sel, setSel] = useState(0);
    const [textMode, setTextMode] = useState(false);
    const [sum, setSum] = useState({ live: "…", print: "…", comp: "…", setoran: "…" });
    const { width, height } = useTerminalDimensions();
    useEffect(() => {
        setTextMode(false);
    }, [view]);
    useEffect(() => {
        let live = true;
        const tick = async () => {
            const s = await Store.openSessionOf();
            const cred = Store.loadCreds();
            const comps = Comps.list();
            const m = Store.loadPrintMeta();
            if (!live)
                return;
            setSum({
                live: s ? `${(s.pcs || []).length} pc · ${s.count || 0} tx` : "no session",
                print: m.kasir ? `${m.kasir} · shift ${m.shift || "-"}` : "no meta",
                comp: comps.length ? `${comps.length} paired` : "none paired",
                setoran: cred ? cred.email : "not logged in",
            });
        };
        void tick();
        const t = setInterval(() => void tick(), 5000);
        return () => {
            live = false;
            clearInterval(t);
        };
    }, [view]);
    const quit = () => {
        renderer.destroy();
        process.exit(0);
    };
    useKeyboard((key) => {
        if (key.eventType === "release")
            return;
        if (key.ctrl && key.name === "c")
            return quit();
        if (textMode)
            return;
        if (help) {
            if (key.name === "escape" || key.name === "q" || key.name === "?")
                setHelp(false);
            return;
        }
        if (key.name === "?" || (key.shift && key.name === "/")) {
            setHelp(true);
            return;
        }
        if (key.name === "q")
            return quit();
        if (view === null) {
            if (key.name === "up" || key.name === "k")
                return setSel((i) => Math.max(0, i - 1));
            if (key.name === "down" || key.name === "j")
                return setSel((i) => Math.min(VIEWS.length - 1, i + 1));
            if (key.name === "return" || key.name === "enter" || key.name === "l")
                return setView(VIEWS[sel].id);
        }
        const v = viewKey(key.name);
        if (v)
            setView(v);
    });
    const label = view === null ? null : VIEWS.find((x) => x.id === view)?.label.toLowerCase() ?? view;
    const crumbs = help ? ["help"] : label ? [label] : [];
    return (_jsxs("box", { width: "100%", height: "100%", flexDirection: "column", backgroundColor: T.bg, children: [view === null && !help ? null : (_jsxs(_Fragment, { children: [_jsxs("box", { height: 1, paddingX: 1, flexDirection: "row", justifyContent: "space-between", children: [_jsx(Breadcrumb, { parts: crumbs }), _jsx("text", { fg: T.dim, children: width < 54 ? "" : "esc/h back · q quit" })] }), _jsx(Divider, {})] })), help ? (_jsx("box", { flexGrow: 1, flexDirection: "column", paddingX: 1, children: HELP.map(([k, l], i) => k === "" ? (_jsx("text", { children: " " }, i)) : (_jsxs("box", { flexDirection: "row", gap: 1, children: [_jsx("box", { width: 9, children: _jsx("text", { fg: T.accent, children: clip(k, 9) }) }), _jsx("text", { fg: T.dim, children: clip(l, width - 12) })] }, i))) })) : (_jsxs("box", { flexGrow: 1, flexDirection: "column", paddingX: 1, children: [view === null ? _jsx(RootMenu, { sum: sum, sel: sel, width: width, height: height }) : null, view === "setoran" ? _jsx(SetoranView, { onBack: () => setView(null), onTextMode: setTextMode }) : null, view === "live" ? _jsx(LiveView, { onBack: () => setView(null) }) : null, view === "print" ? _jsx(PrintView, { onBack: () => setView(null), onTextMode: setTextMode }) : null, view === "comp" ? _jsx(CompView, { onBack: () => setView(null), onTextMode: setTextMode }) : null] })), _jsx(Divider, {}), _jsx(Hints, { items: help ? [["esc/q", "close"]] : view === null ? ROOT_HINTS : VIEW_HINTS[view] })] }));
}
