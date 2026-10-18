import { readFileSync } from "node:fs";
import { TextAttributes } from "@opentui/core";
import { T, type Tone } from "../theme.js";
import { VIEWS, type ViewId } from "../keymap.js";
import { clip, rootBudget } from "../layout.js";

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return String(pkg.version || "0.1.0");
  } catch {
    return "0.1.0";
  }
}

const VERSION = pkgVersion();
const TAGLINE = "termux-first cashier cli | v" + VERSION;

const EMPTY_STATUS = new Set(["no session", "no meta", "none paired", "not logged in", "…"]);

function statusTone(status: string): Tone {
  return EMPTY_STATUS.has(status) ? "dim" : "ok";
}

function Logo({ width, font }: { width: number; font: "block" | "slick" | "tiny" }) {
  const color = font === "tiny" ? T.accent : [T.accent, T.text];
  return (
    <box width="100%" flexDirection="row" justifyContent="center">
      <ascii-font text="CNCLI" font={font} color={color} backgroundColor={T.bg} />
    </box>
  );
}

function MenuBox({
  label,
  status,
  on,
  width,
}: {
  label: string;
  status: string;
  on: boolean;
  width: number;
}) {
  return (
    <box
      width="100%"
      border
      borderStyle="rounded"
      borderColor={on ? T.accent : T.line}
      title={label}
      titleAlignment="left"
      titleColor={on ? T.accent : T.faint}
      paddingX={1}
    >
      <text fg={on ? T.text : T[statusTone(status)]} attributes={on ? TextAttributes.BOLD : undefined}>
        {clip(status, Math.max(0, width - 6))}
      </text>
    </box>
  );
}

export function RootMenu({
  sum,
  sel,
  width,
  height,
}: {
  sum: Record<ViewId, string>;
  sel: number;
  width: number;
  height: number;
}) {
  const { font, tagline, gaps } = rootBudget(width, height);
  const rows: React.ReactNode[] = [];
  rows.push(
    tagline ? (
      <box key="tagline" width="100%" flexDirection="row" justifyContent="center">
        <text fg={T.dim}>{clip(TAGLINE, Math.max(0, width - 2))}</text>
      </box>
    ) : null,
  );
  if (gaps) rows.push(<text key="spacer"> </text>);
  VIEWS.forEach((v, i) => {
    if (i > 0 && gaps) rows.push(<text key={"gap" + i}> </text>);
    rows.push(<MenuBox key={v.id} label={v.label.toLowerCase()} status={sum[v.id]} on={sel === i} width={width} />);
  });
  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {font ? <Logo width={width} font={font} /> : null}
      {rows}
    </box>
  );
}
