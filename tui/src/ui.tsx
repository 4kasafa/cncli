import type { ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import { T, type Tone } from "./theme.js";
import { alignLR, clip, kpiCols } from "./layout.js";

export function Divider() {
  return <box width="100%" height={1} border={["top"]} borderStyle="single" borderColor={T.line} />;
}

export function Tag({ label, tone = "dim" }: { label: string; tone?: Tone }) {
  return (
    <text fg={T[tone]} attributes={TextAttributes.BOLD}>
      {"[" + label.toUpperCase() + "]"}
    </text>
  );
}

export function Sel({ on }: { on: boolean }) {
  return <text fg={on ? T.accent : T.faint}>{on ? "›" : " "}</text>;
}

export function Panel({ title, grow, children }: { title: string; grow?: boolean; children: ReactNode }) {
  return (
    <box
      width="100%"
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={T.accent}
      title={title}
      titleAlignment="left"
      titleColor={T.accent}
      paddingX={1}
      flexGrow={grow ? 1 : 0}
    >
      {children}
    </box>
  );
}

export function Kpi({ label, value, tone = "text" }: { label: string; value: string; tone?: Tone }) {
  return (
    <box flexDirection="column">
      <text fg={T.faint}>{label}</text>
      <text fg={T[tone]} attributes={TextAttributes.BOLD}>
        {value}
      </text>
    </box>
  );
}

export function Msg({ text, tone = "dim" }: { text: string | null | undefined; tone?: Tone }) {
  if (!text) return <text> </text>;
  return <text fg={T[tone]}>{text}</text>;
}

export function Keybar({ items }: { items: [string, string][] }) {
  const parts: ReactNode[] = [];
  items.forEach(([k, l], i) => {
    if (i) parts.push(<text key={"s" + i} fg={T.faint}>{"  "}</text>);
    parts.push(<text key={"k" + i} fg={T.accent}>{k}</text>);
    parts.push(<text key={"l" + i} fg={T.faint}>{" " + l}</text>);
  });
  return (
    <box height={1} paddingX={1} flexDirection="row">
      {parts}
    </box>
  );
}

export const inputStyle = {
  backgroundColor: T.surface,
  textColor: T.text,
  focusedBackgroundColor: T.surface,
  placeholderColor: T.faint,
} as const;

export function Field({
  label,
  value,
  onInput,
  onSubmit,
  focus = false,
  placeholder = "",
  width = 24,
}: {
  label: string;
  value: string;
  onInput?: (v: string) => void;
  onSubmit?: (v: string) => void;
  focus?: boolean;
  placeholder?: string;
  width?: number;
}) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={focus ? T.text : T.dim}>{label}</text>
      <input {...inputStyle} focused={focus} value={value} onInput={onInput} onSubmit={onSubmit ? () => onSubmit(value) : undefined} placeholder={placeholder} width={width} />
    </box>
  );
}

export function Secret({ label, value, focus = false, width = 24 }: { label: string; value: string; focus?: boolean; width?: number }) {
  const shown = "•".repeat(value.length);
  return (
    <box flexDirection="row" gap={1}>
      <text fg={focus ? T.text : T.dim}>{label}</text>
      <text fg={T.text}>{shown + (focus ? "▏" : "") || (focus ? "▏" : "")}</text>
      {!focus && !shown ? <text fg={T.faint}>{" ".repeat(Math.max(width - 1, 0))}</text> : null}
    </box>
  );
}

export function Modal({ title, hint, children, widthPct = 78, heightPct = 80 }: { title: string; hint?: string; children: ReactNode; widthPct?: number; heightPct?: number }) {
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" justifyContent="center" alignItems="center" zIndex={10}>
      <box width={`${widthPct}%`} height={`${heightPct}%`} backgroundColor={T.surface} border borderStyle="rounded" borderColor={T.line} flexDirection="column" padding={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={T.text} attributes={TextAttributes.BOLD}>
            {title}
          </text>
          {hint ? <text fg={T.faint}>{hint}</text> : null}
        </box>
        {children}
      </box>
    </box>
  );
}

export function Breadcrumb({ parts }: { parts: string[] }) {
  return (
    <text fg={T.accent} attributes={TextAttributes.BOLD}>
      {["cncli", ...parts].join(" > ")}
    </text>
  );
}

export function Hints({ items, max = 4 }: { items: [string, string][]; max?: number }) {
  return <Keybar items={items.slice(0, max)} />;
}

export function KpiGrid({ items, width }: { items: { label: string; value: string; tone?: Tone }[]; width: number }) {
  const n = kpiCols(width);
  const cell = Math.max(6, Math.floor((width - (n - 1)) / n));
  const rows: { label: string; value: string; tone?: Tone }[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return (
    <box flexDirection="column">
      {rows.map((r, ri) => (
        <box key={ri} flexDirection="row" gap={1}>
          {r.map((it, ci) => (
            <box key={ci} flexDirection="column" width={cell}>
              <text fg={T.faint}>{clip(it.label.toUpperCase(), cell)}</text>
              <text fg={T[it.tone || "text"]} attributes={TextAttributes.BOLD}>
                {clip(it.value, cell)}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  );
}

export function ListRow({
  on,
  text,
  right,
  width,
  tone,
  rightTone,
}: {
  on: boolean;
  text: string;
  right?: string;
  width: number;
  tone?: Tone;
  rightTone?: Tone;
}) {
  const line = right === undefined ? clip(text, width - 2) : alignLR(text, right, width - 2);
  return (
    <box flexDirection="row">
      <text fg={on ? T.accent : T.faint}>{on ? ">" : " "}</text>
      <text fg={T[tone || (on ? "text" : "dim")]}>{" " + line}</text>
    </box>
  );
}

export function Page({ title, hint, children, width }: { title: string; hint?: string; children: ReactNode; width?: number }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg={T.text} attributes={TextAttributes.BOLD}>
        {width ? clip(title, width) : title}
      </text>
      {hint ? <text fg={T.faint}>{width ? clip(hint, width) : hint}</text> : null}
      {children}
    </box>
  );
}
