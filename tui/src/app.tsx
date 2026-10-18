import { useEffect, useState } from "react";
import { TextAttributes, type CliRenderer } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { T } from "./theme.js";
import { Divider, Keybar, Modal } from "./ui.js";
import { GLOBAL_KEYBAR, HELP, VIEW_KEYBAR, VIEWS, type ViewId } from "./keymap.js";
import { SetoranView } from "./views/setoran.js";
import { LiveView } from "./views/live.js";
import { PrintView } from "./views/print.js";
import { CompView } from "./views/comp.js";
import * as Store from "./store.js";

export function App({ renderer }: { renderer: CliRenderer }) {
  const [view, setView] = useState<ViewId>("setoran");
  const [help, setHelp] = useState(false);
  const [statusRight, setStatusRight] = useState("");
  const { width } = useTerminalDimensions();

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await Store.openSessionOf();
      if (!live) return;
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
    if (help && (key.name === "escape" || key.name === "q")) setHelp(false);
  });

  const label = VIEWS.find((x) => x.id === view)?.label ?? view;
  const bar: [string, string][] = [...GLOBAL_KEYBAR, ...VIEW_KEYBAR[view]];

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={T.bg}>
      <box height={1} paddingX={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={T.text} attributes={TextAttributes.BOLD}>
            cncli
          </text>
          <text fg={T.faint}>/</text>
          <text fg={T.accent}>{label}</text>
          <text fg={T.faint}>{"─".repeat(Math.max(0, Math.min(40, width - 30)))}</text>
        </box>
        <text fg={T.dim}>{statusRight}</text>
      </box>
      <Divider />
      <box flexGrow={1} flexDirection="column" paddingX={1}>
        {view === "setoran" ? <SetoranView onView={setView} /> : null}
        {view === "live" ? <LiveView onView={setView} /> : null}
        {view === "print" ? <PrintView onView={setView} /> : null}
        {view === "comp" ? <CompView onView={setView} /> : null}
      </box>
      <Divider />
      <Keybar items={bar} />
      {help ? (
        <Modal title="bantuan" hint="esc tutup" widthPct={82} heightPct={70}>
          <box flexDirection="column">
            {HELP.map(([k, l], i) =>
              k === "" ? (
                <text key={i}> </text>
              ) : (
                <box key={i} flexDirection="row" gap={1}>
                  <box width={10}>
                    <text fg={T.accent}>{k}</text>
                  </box>
                  <text fg={T.dim}>{l}</text>
                </box>
              ),
            )}
          </box>
        </Modal>
      ) : null}
    </box>
  );
}
