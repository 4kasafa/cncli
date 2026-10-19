export function clip(text, w, marker = "...") {
    const s = text == null ? "" : String(text);
    if (w <= 0)
        return "";
    if (s.length <= w)
        return s;
    if (w <= marker.length)
        return marker.slice(0, w);
    return s.slice(0, w - marker.length) + marker;
}
export function alignLR(left, right, w, gap = 1) {
    if (w <= 0)
        return "";
    const r = clip(right, Math.max(0, w - Math.min(gap, w)));
    const l = clip(left, Math.max(0, w - r.length - gap));
    const pad = Math.max(gap, w - l.length - r.length);
    return l + " ".repeat(pad) + r;
}
export function planColumns(total, specs) {
    if (total <= 0)
        return specs.map(() => 0);
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
export function formatRow(width, specs, sep = " ") {
    if (width <= 0)
        return "";
    const gap = Math.max(0, specs.length - 1) * sep.length;
    const widths = planColumns(Math.max(0, width - gap), specs);
    const cells = specs.map((s, i) => {
        const w = widths[i];
        const c = clip(s.text ?? "", w);
        return s.align === "right" ? c.padStart(w) : c.padEnd(w);
    });
    return clip(cells.join(sep), width, "");
}
export function kpiCols(width) {
    return width < 72 ? 3 : 5;
}
// block wordmark measures 41 cols; >=46 leaves room for padding + centering slack
export function pickLogoFont(width) {
    if (width >= 46)
        return "block";
    if (width >= 32)
        return "slick";
    return "tiny";
}
export function capLines(list, max) {
    if (max <= 0)
        return [];
    if (list.length <= max)
        return list;
    return [...list.slice(0, max), `+${list.length - max} lagi`];
}
// contentRows = total baris isi 4 box; compact meruntuhkan tiap box ke 1 baris (4 baris total)
export function rootBudget(width, height, contentRows) {
    let font = pickLogoFont(width);
    let tagline = true;
    let gaps = 1;
    let compact = false;
    const logoRows = () => (font === null ? 0 : font === "tiny" ? 2 : 6);
    const needed = () => 2 + logoRows() + (tagline ? 1 : 0) + (gaps ? 4 : 0) + 8 + (compact ? 4 : Math.max(4, contentRows));
    for (let i = 0; i < 5 && needed() > height; i++) {
        if (gaps === 1)
            gaps = 0;
        else if (tagline)
            tagline = false;
        else if (!compact && contentRows > 4)
            compact = true;
        else if (font !== null && font !== "tiny")
            font = "tiny";
        else if (font === "tiny")
            font = null;
        else
            break;
    }
    return { font, tagline, gaps, compact };
}
