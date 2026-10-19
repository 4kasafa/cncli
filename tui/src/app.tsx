import { useEffect, useState } from "react";
import { TextAttributes, type CliRenderer } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "./theme.js";
import { Breadcrumb, Divider, Hints } from "./ui.js";
import { HELP, ROOT_HINTS, VIEWS, VIEW_HINTS, viewKey, type ViewId } from "./keymap.js";
import { RootMenu } from "./views/root.js";
import { SetoranView } from "./views/setoran.js";
import { LiveView } from "./views/live.js";
import { PrintView } from "./views/print.js";
import { CompView } from "./views/comp.js";
import { clip } from "./layout.js";
import { pickLastRow, type RootData } from "./rootinfo.js";
import * as Store from "./store.js";
import * as Comps from "./comps.js";

function JumpKeys({
  textMode,
  help,
  onJump,
}: {
  textMode: boolean;
  help: boolean;
  onJump: (v: ViewId) => void;
}) {
  useKeyboard((key) => {
    if (key.eventType === "release") return;
    if (key.ctrl || key.meta) return;
    if (textMode || help) return;
    if (key.defaultPrevented) return;
    const v = viewKey(key.name);
    if (v) onJump(v);
  });
  return null;
}

export function App({ renderer }: { renderer: CliRenderer }) {
  const [view, setView] = useState<ViewId | null>(null);
  const [help, setHelp] = useState(false);
  const [sel, setSel] = useState(0);
  const [textMode, setTextMode] = useState(false);
  const [data, setData] = useState<RootData>({ session: null, print: null, paired: 0, report: null, sync: null });
  const { width, height } = useTerminalDimensions();

  useEffect(() => {
    setTextMode(false);
  }, [view]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await Store.openSessionOf();
      let session: RootData["session"] = null;
      if (s) {
        const rows = await Store.listTx(s.id);
        const fills = await Store.getFills(s.id);
        let total = 0;
        for (const r of rows) total += Store.toInt(r.total);
        let fillCount = 0;
        for (const k of Object.keys(fills)) {
          total += Store.toInt(fills[k].total);
          fillCount++;
        }
        const lt = rows[0];
        session = {
          pcs: (s.pcs || []).map((p) => ({ name: p.name || p.comp_id, base: p.base, alive: Store.toInt(p.alive) })),
          tx: rows.length + fillCount,
          total,
          last: lt
            ? { no: lt.no_transaksi || `id-${lt.server_id}`, total: Store.toInt(lt.total), time: String(lt.created_at || "").slice(11, 16) }
            : null,
        };
      }
      const cred = Store.loadCreds();
      const bucket = cred ? Store.loadArchiveBucket(cred.email, "") : null;
      const report = bucket ? pickLastRow(bucket.data) : null;
      const sync = bucket?.last_sync ?? null;
      if (!live) return;
      setData({ session, print: Store.loadPrintMeta(), paired: Comps.list().length, report, sync });
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
  });

  const label = view === null ? null : VIEWS.find((x) => x.id === view)?.label.toLowerCase() ?? view;
  const crumbs = help ? ["help"] : label ? [label] : [];

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={T.bg}>
      {view === null && !help ? null : (
        <>
          <box height={1} paddingX={1} flexDirection="row" justifyContent="space-between">
            <Breadcrumb parts={crumbs} />
            <text fg={T.dim}>{width < 54 ? "" : "esc/h back · q quit"}</text>
          </box>
          <Divider />
        </>
      )}
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
          {view === null ? <RootMenu data={data} sel={sel} width={width} height={height} /> : null}
          {view === "setoran" ? <SetoranView onBack={() => setView(null)} onTextMode={setTextMode} /> : null}
          {view === "live" ? <LiveView onBack={() => setView(null)} /> : null}
          {view === "print" ? <PrintView onBack={() => setView(null)} onTextMode={setTextMode} /> : null}
          {view === "comp" ? <CompView onBack={() => setView(null)} onTextMode={setTextMode} /> : null}
        </box>
      )}
      <JumpKeys key={(view ?? "root") + (help ? "-help" : "")} textMode={textMode} help={help} onJump={setView} />
      <Divider />
      <Hints items={help ? [["esc/q", "close"]] : view === null ? ROOT_HINTS : VIEW_HINTS[view]} />
    </box>
  );
}
