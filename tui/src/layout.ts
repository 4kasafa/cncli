export function clip(text: string, w: number, marker = "..."): string {
  const s = text == null ? "" : String(text);
  if (w <= 0) return "";
  if (s.length <= w) return s;
  if (w <= marker.length) return marker.slice(0, w);
  return s.slice(0, w - marker.length) + marker;
}

export function alignLR(left: string, right: string, w: number, gap = 1): string {
  if (w <= 0) return "";
  const r = clip(right, Math.max(0, w - Math.min(gap, w)));
  const l = clip(left, Math.max(0, w - r.length - gap));
  const pad = Math.max(gap, w - l.length - r.length);
  return l + " ".repeat(pad) + r;
}

export interface ColSpec {
  key: string;
  min: number;
  flex?: number;
  align?: "left" | "right";
  text?: string;
}

export function planColumns(total: number, specs: ColSpec[]): number[] {
  if (total <= 0) return specs.map(() => 0);
  const out = specs.map((s) => Math.max(0, s.min));
  let used = out.reduce((a, b) => a + b, 0);
  const flex = specs.map((s, i) => ({ i, f: s.flex || 0 })).filter((x) => x.f > 0);
  if (used < total && flex.length) {
    const rest = total - used;
    const totalF = flex.reduce((a, x) => a + x.f, 0);
    let given = 0;
    for (const x of flex) {
      const add = Math.floor(rest * (x.f / totalF));
      out[x.i] += add;
      given += add;
    }
    out[flex[0].i] += rest - given;
  }
  let over = out.reduce((a, b) => a + b, 0) - total;
  for (let i = out.length - 1; i >= 0 && over > 0; i--) {
    const cut = Math.min(out[i], over);
    out[i] -= cut;
    over -= cut;
  }
  return out;
}

export function formatRow(width: number, specs: ColSpec[], sep = " "): string {
  if (width <= 0) return "";
  const gap = Math.max(0, specs.length - 1) * sep.length;
  const widths = planColumns(Math.max(0, width - gap), specs);
  const cells = specs.map((s, i) => {
    const w = widths[i];
    const c = clip(s.text ?? "", w);
    return s.align === "right" ? c.padStart(w) : c.padEnd(w);
  });
  return clip(cells.join(sep), width, "");
}

export function kpiCols(width: number): number {
  return width < 72 ? 3 : 5;
}

// block wordmark measures 41 cols; >=46 leaves room for padding + centering slack
export function pickLogoFont(width: number): "block" | "slick" | "tiny" {
  if (width >= 46) return "block";
  if (width >= 32) return "slick";
  return "tiny";
}

export function rootBudget(
  width: number,
  height: number,
): { font: "block" | "slick" | "tiny" | null; tagline: boolean; gaps: 0 | 1 } {
  let font: "block" | "slick" | "tiny" | null = pickLogoFont(width);
  let tagline = true;
  let gaps: 0 | 1 = 1;
  const needed = () => 2 + (font === null ? 0 : font === "tiny" ? 2 : 6) + (tagline ? 1 : 0) + (gaps ? 4 : 0) + 12;
  while (needed() > height && !(font === null && !tagline && gaps === 0)) {
    if (gaps === 1) gaps = 0;
    else if (tagline) tagline = false;
    else if (font !== null && font !== "tiny") font = "tiny";
    else if (font === "tiny") font = null;
  }
  return { font, tagline, gaps };
}
