import { useEffect, useState } from "react";
import { TextAttributes, type CliRenderer } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "./theme.js";
import { Breadcrumb, Divider, Hints, ListRow } from "./ui.js";
import { HELP, ROOT_HINTS, VIEWS, VIEW_HINTS, viewKey, type ViewId } from "./keymap.js";
import { SetoranView } from "./views/setoran.js";
import { LiveView } from "./views/live.js";
import { PrintView } from "./views/print.js";
import { CompView } from "./views/comp.js";
import { clip } from "./layout.js";
import * as Store from "./store.js";
import * as Comps from "./comps.js";

interface Summary {
  live: string;
  print: string;
  comp: string;
  setoran: string;
}

export function App({ renderer }: { renderer: CliRenderer }) {
  const [view, setView] = useState<ViewId | null>(null);
  const [help, setHelp] = useState(false);
  const [sel, setSel] = useState(0);
  const [textMode, setTextMode] = useState(false);
  const [sum, setSum] = useState<Summary>({ live: "…", print: "…", comp: "…", setoran: "…" });
  const { width } = useTerminalDimensions();

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
      if (!live) return;
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
    if (key.eventType === "release") return;
    if (key.ctrl && key.name === "c") return quit();
    if (textMode) return;
    if (help) {
      if (key.name === "escape" || key.name === "q" || key.name === "?") setHelp(false);
      return;
    }
    if (key.name === "?" || (key.shift && key.name === "/")) {
      setHelp(true);
      return;
    }
    if (key.name === "q") return quit();
    if (view === null) {
      if (key.name === "up" || key.name === "k") return setSel((i) => Math.max(0, i - 1));
      if (key.name === "down" || key.name === "j") return setSel((i) => Math.min(VIEWS.length - 1, i + 1));
      if (key.name === "return" || key.name === "enter" || key.name === "l") return setView(VIEWS[sel].id);
    }
    const v = viewKey(key.name);
    if (v) setView(v);
  });

  const label = view === null ? null : VIEWS.find((x) => x.id === view)?.label.toLowerCase() ?? view;
  const crumbs = help ? ["help"] : label ? [label] : [];

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={T.bg}>
      <box height={1} paddingX={1} flexDirection="row" justifyContent="space-between">
        <Breadcrumb parts={crumbs} />
        <text fg={T.dim}>{width < 54 ? "" : "esc/h back · q quit"}</text>
      </box>
      <Divider />
      {help ? (
        <box flexGrow={1} flexDirection="column" paddingX={1}>
          {HELP.map(([k, l], i) =>
            k === "" ? (
              <text key={i}> </text>
            ) : (
              <box key={i} flexDirection="row" gap={1}>
                <box width={9}>
                  <text fg={T.accent}>{clip(k, 9)}</text>
                </box>
                <text fg={T.dim}>{clip(l, width - 12)}</text>
              </box>
            ),
          )}
        </box>
      ) : (
        <box flexGrow={1} flexDirection="column" paddingX={1}>
          {view === null ? (
            <>
              {VIEWS.map((v, i) => (
                <ListRow key={v.id} on={sel === i} width={width - 2} text={`${v.key}  ${v.label}`} right={sum[v.id]} />
              ))}
            </>
          ) : null}
          {view === "setoran" ? <SetoranView onBack={() => setView(null)} onTextMode={setTextMode} /> : null}
          {view === "live" ? <LiveView onBack={() => setView(null)} /> : null}
          {view === "print" ? <PrintView onBack={() => setView(null)} onTextMode={setTextMode} /> : null}
          {view === "comp" ? <CompView onBack={() => setView(null)} onTextMode={setTextMode} /> : null}
        </box>
      )}
      <Divider />
      <Hints items={help ? [["esc/q", "close"]] : view === null ? ROOT_HINTS : VIEW_HINTS[view]} />
    </box>
  );
}
