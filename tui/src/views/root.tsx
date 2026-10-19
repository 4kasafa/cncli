import { readFileSync } from "node:fs";
import { TextAttributes } from "@opentui/core";
import { T } from "../theme.js";
import { VIEWS, type ViewId } from "../keymap.js";
import { clip, rootBudget } from "../layout.js";
import { contentRows, rootLines, type RootBox, type RootData } from "../rootinfo.js";

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return String(pkg.version || "0.4.1");
  } catch {
    return "0.4.1";
  }
}

const VERSION = pkgVersion();
const TAGLINE = "cash note cli | v" + VERSION;

const BOX_OF: Record<ViewId, RootBox> = { live: "live", print: "print", comp: "pcs", setoran: "reports" };

function Logo({ font }: { font: "block" | "slick" | "tiny" }) {
  const color = font === "tiny" ? T.accent : [T.accent, T.text];
  return (
    <box width="100%" flexDirection="row" justifyContent="center">
      <ascii-font text="CNCLI" font={font} color={color} backgroundColor={T.bg} />
    </box>
  );
}

function MenuBox({
  label,
  lines,
  on,
  width,
}: {
  label: string;
  lines: string[];
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
      titleColor={on ? T.accent : T.text}
      paddingX={1}
      paddingTop={1}
    >
      {lines.map((ln, i) => (
        <text
          key={i}
          fg={on ? T.text : T.dim}
          attributes={on ? TextAttributes.BOLD : undefined}
        >
          {clip(ln, Math.max(0, width - 6))}
        </text>
      ))}
    </box>
  );
}

export function RootMenu({
  data,
  sel,
  width,
  height,
}: {
  data: RootData;
  sel: number;
  width: number;
  height: number;
}) {
  const view = rootLines(data);
  const { font, tagline, gaps, compact } = rootBudget(width, height, contentRows(view));
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
    const key = BOX_OF[v.id];
    const all = view.lines[key];
    rows.push(
      <MenuBox
        key={v.id}
        label={v.label.toLowerCase()}
        lines={compact ? all.slice(0, 1) : all}
        on={sel === i}
        width={width}
      />,
    );
  });
  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {font ? <text key="topgap"> </text> : null}
      {font ? <Logo font={font} /> : null}
      {rows}
    </box>
  );
}
