import { toInt, dots, todayStamp, nowStamp } from "./fmt.js";
import { currentPeriode, periodeOf, parseDate, type GasItem } from "./conflict.js";
import { loadArchiveBucket, type PrintMeta } from "./store.js";

export const DENOMS = [100000, 75000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];
export const ARABIC_LINE = '"شكراً جزيلاً"';

export function width(size: "58" | "80"): number {
  return size === "80" ? 48 : 32;
}

export function fisikTotal(qty: Record<string, number>): number {
  let t = 0;
  for (const d of DENOMS) t += (qty[d] || 0) * d;
  return t;
}

export function normShift(s: string): string {
  if (/malam/i.test(s || "")) return "Malam";
  if (/pagi/i.test(s || "")) return "Pagi";
  return "";
}

function kvLine(label: unknown, value: unknown, w: number): string {
  const l = String(label);
  const v = String(value);
  const sp = w - l.length - v.length;
  if (sp < 1) return l + " " + v;
  return l + " ".repeat(sp) + v;
}

export function amountLine(label: string, amount: unknown, w: number): string[] {
  const right = "Rp " + dots(amount);
  const sp = w - label.length - right.length;
  if (sp >= 2) return [label + " ".repeat(sp) + right];
  const parts = label.split(" ", 2);
  if (parts.length === 2) {
    const sp1 = w - parts[0].length - right.length;
    if (sp1 >= 1) return [parts[0] + " ".repeat(sp1) + right, parts[1]];
  }
  return [label + " " + right];
}

function wrapText(t: string, w: number): string[] {
  const words = String(t).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const wd of words) {
    if (!cur) cur = wd;
    else if ((cur + " " + wd).length <= w) cur += " " + wd;
    else {
      out.push(cur);
      cur = wd;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function center(s: string, w: number): string {
  s = String(s);
  if (s.length >= w) return s.slice(0, w);
  const pad = w - s.length;
  const l = Math.floor(pad / 2);
  return " ".repeat(l) + s + " ".repeat(pad - l);
}

function withMargin(lines: string[], w: number, margin?: number): string[] {
  const m = margin == null ? 2 : margin;
  const inner = Math.max(w - m * 2, 10);
  const pad = " ".repeat(m);
  return lines.map((ln) => {
    if (!ln) return "";
    const c = String(ln).slice(0, inner);
    return pad + c + " ".repeat(inner - c.length) + pad;
  });
}

export interface ReceiptOpts {
  kasir: string;
  kasir_id: string;
  cabang: string;
  shift: string;
  noncash: number;
  expense: number;
  note: string;
}

export function generateReceipt(w: number, qty: Record<string, number>, o: ReceiptOpts): string {
  const inner = Math.max(w - 4, 10);
  const fisik = fisikTotal(qty);
  const lines: string[] = [];
  lines.push(center("TOKO LAY", inner));
  lines.push(center("Laporan Penjualan", inner));
  lines.push("-".repeat(inner));
  lines.push(kvLine("Tanggal", todayStamp(), inner));
  lines.push(kvLine("Cabang", o.cabang || "-", inner));
  lines.push(kvLine("Shift", o.shift || "-", inner));
  lines.push(kvLine("Kasir", o.kasir || "-", inner));
  lines.push(kvLine("User ID", o.kasir_id || "-", inner));
  lines.push("-".repeat(inner));
  const phys: string[] = [];
  for (const d of DENOMS) {
    const q = qty[d] || 0;
    if (q > 0) {
      const left = dots(d) + " x " + q;
      const right = "Rp " + dots(q * d);
      const sp = inner - left.length - right.length;
      phys.push(sp < 1 ? left + "\n" + right : left + " ".repeat(sp) + right);
    }
  }
  for (const l of amountLine("Total Penjualan", fisik + o.noncash + o.expense, inner)) lines.push(l);
  lines.push(amountLine("Non Tunai", o.noncash, inner)[0]);
  lines.push(amountLine("Pengeluaran", o.expense, inner)[0]);
  lines.push("-".repeat(inner));
  lines.push(center("-- Rincian Uang Fisik --", inner));
  for (const l of phys) lines.push(l);
  lines.push("-".repeat(inner));
  lines.push(amountLine("TOTAL FISIK", fisik, inner)[0]);
  lines.push("-".repeat(inner));
  if (o.note.trim()) {
    let first = true;
    for (const raw of o.note.trim().split("\n")) {
      for (const wl of wrapText((first ? "Ket: " : "") + raw.trim(), inner)) lines.push(center(wl, inner));
      first = false;
    }
  }
  lines.push(center(nowStamp(), inner));
  lines.push(center(ARABIC_LINE, inner));
  return withMargin(lines, w, 2).join("\n");
}

export interface PrintPayload {
  kasir: string;
  branch: string;
  shift: string;
  user_id: string;
  qty: Record<string, number>;
  expense_amount: number;
  expense_note: string;
  nontunai_amount: number;
  size: "58" | "80";
}

export function buildPayload(meta: Pick<PrintMeta, "kasir" | "cabang" | "shift" | "kasir_id" | "size">, qty: Record<string, number>, expense: number, note: string, noncash: number): PrintPayload {
  const q: Record<string, number> = {};
  for (const d of DENOMS) if ((qty[d] || 0) > 0) q[String(d)] = qty[d];
  return {
    kasir: meta.kasir.trim(),
    branch: meta.cabang.trim(),
    shift: meta.shift,
    user_id: meta.kasir_id.trim() || "-",
    qty: q,
    expense_amount: expense,
    expense_note: note,
    nontunai_amount: noncash,
    size: meta.size,
  };
}

export function validateForSend(meta: Pick<PrintMeta, "kasir" | "kasir_id">, qty: Record<string, number>): string | null {
  if (!meta.kasir.trim()) return "pick/fill cashier first.";
  if (!meta.kasir_id.trim()) return "fill cashier id first.";
  if (fisikTotal(qty) === 0) return "physical total zero, fill denominations first.";
  return null;
}

// latest Setoran entry of the current period from the active email's archive bucket
export function latestSetoran(email: string): (GasItem & { kasir?: string }) | null {
  if (!email) return null;
  try {
    const b = loadArchiveBucket(email, "");
    const arr = (Array.isArray(b.data) ? b.data : []).slice();
    const cur = currentPeriode();
    const filtered = arr.filter((it) => {
      const p = periodeOf(it && it.tanggal);
      return p === null || p === cur;
    });
    filtered.sort((a, b2) => {
      const da = parseDate(a && a.tanggal);
      const db = parseDate(b2 && b2.tanggal);
      return (db ? db.getTime() : -1) - (da ? da.getTime() : -1);
    });
    for (const it of filtered) {
      const row = it || {};
      if (row.kasir || row.cabang || row.shift) return row;
    }
    if (b.cashier) return { kasir: b.cashier };
  } catch {
    /* empty */
  }
  return null;
}
