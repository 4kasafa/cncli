export interface GasItem {
  tanggal?: string;
  shift?: string;
  cabang?: string;
  kasir?: string;
  totalKomputer?: number | string;
  uangFisik?: number | string;
  jumlahSelisih?: number | string;
  statusSelisih?: string;
  _conflict?: { lokal: Trio; gas: Trio; gas_item: GasItem };
  _dismissed_gas?: GasItem;
}

interface Trio {
  totalKomputer: number;
  uangFisik: number;
  jumlahSelisih: number;
}

const BULAN: Record<string, number> = {
  januari: 1, jan: 1, january: 1, februari: 2, feb: 2, february: 2, peb: 2,
  maret: 3, mar: 3, march: 3, april: 4, apr: 4, mei: 5, may: 5,
  juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, agst: 8, ags: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nov: 11, desember: 12, des: 12, dec: 12, december: 12,
};

export function parseDate(tgl: unknown): Date | null {
  if (tgl == null) return null;
  if (tgl instanceof Date) return isNaN(tgl.getTime()) ? null : new Date(tgl.getFullYear(), tgl.getMonth(), tgl.getDate());
  const s = String(tgl).trim();
  if (!s) return null;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    const d0 = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d0.getTime()) ? null : d0;
  }
  m = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d1 = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d1.getTime()) ? null : d1;
  }
  m = /(\d{1,2})\s+([a-z]+)\s+(\d{2,4})/.exec(s.toLowerCase());
  if (m && BULAN[m[2]]) {
    let y2 = +m[3];
    if (y2 < 100) y2 += 2000;
    const d2 = new Date(y2, BULAN[m[2]] - 1, +m[1]);
    return isNaN(d2.getTime()) ? null : d2;
  }
  return null;
}

export function periodeOf(tgl: unknown): string | null {
  const d = parseDate(tgl);
  if (!d) return null;
  let y = d.getFullYear();
  let mo = d.getMonth() + 1;
  if (d.getDate() >= 28) {
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return y + "-" + String(mo).padStart(2, "0");
}

export function currentPeriode(): string {
  return periodeOf(new Date()) as string;
}

function norm(v: unknown): string {
  return String(v == null ? "" : v).trim().toLowerCase();
}

export function txKey(item: GasItem | null | undefined): string {
  const it = item || {};
  return norm(it.tanggal) + "|" + norm(it.shift) + "|" + norm(it.cabang);
}

export function toInt(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? Math.trunc(v) : 0;
  const s = String(v == null ? "" : v).trim();
  const neg = s.charAt(0) === "-";
  const digits = s.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return neg ? -n : n;
}

export function isConflict(a: GasItem, b: GasItem): boolean {
  a = a || {};
  b = b || {};
  return (["totalKomputer", "uangFisik", "jumlahSelisih"] as const).some((k) => toInt(a[k]) !== toInt(b[k]));
}

export function stripConflict(g: GasItem): GasItem {
  const c: GasItem = {};
  for (const k of Object.keys(g) as (keyof GasItem)[]) {
    if (k !== "_conflict") (c as Record<string, unknown>)[k] = g[k];
  }
  return c;
}

export function mergeGasData(cache: GasItem[], gasData: GasItem[] | null | undefined): { n_new: number; n_conflict: number } {
  const idx: Record<string, number> = {};
  cache.forEach((it, j) => (idx[txKey(it)] = j));
  let nNew = 0;
  for (const g of gasData || []) {
    if (!g || typeof g !== "object") continue;
    const key = txKey(g);
    if (!(key in idx)) {
      cache.push(stripConflict(g));
      idx[key] = cache.length - 1;
      nNew++;
    } else {
      const curIt = cache[idx[key]];
      if (isConflict(curIt, g)) {
        const prevGas = curIt._conflict?.gas_item;
        const seen = curIt._dismissed_gas;
        if (seen && !isConflict(seen, g)) {
          // ponytail: user already picked local for this GAS version — stay quiet until GAS changes
        } else if (prevGas == null || isConflict(prevGas, g)) {
          curIt._conflict = {
            lokal: { totalKomputer: toInt(curIt.totalKomputer), uangFisik: toInt(curIt.uangFisik), jumlahSelisih: toInt(curIt.jumlahSelisih) },
            gas: { totalKomputer: toInt(g.totalKomputer), uangFisik: toInt(g.uangFisik), jumlahSelisih: toInt(g.jumlahSelisih) },
            gas_item: stripConflict(g),
          };
          delete curIt._dismissed_gas;
        }
      } else if (curIt._dismissed_gas) {
        delete curIt._dismissed_gas;
      }
    }
  }
  return { n_new: nNew, n_conflict: countConflicts(cache) };
}

export function countConflicts(cache: GasItem[]): number {
  return cache.filter((it) => it && it._conflict).length;
}

export function resolve(cache: GasItem[], key: string, useGas: boolean): GasItem | null {
  for (let i = 0; i < cache.length; i++) {
    if (txKey(cache[i]) === key) {
      if (useGas) {
        cache[i] = stripConflict(cache[i]._conflict?.gas_item || {});
      } else {
        // ponytail: remember the rejected GAS version; re-flag only when GAS changes
        const seenGas = cache[i]._conflict?.gas_item || null;
        delete cache[i]._conflict;
        if (seenGas) cache[i]._dismissed_gas = stripConflict(seenGas);
      }
      return cache[i];
    }
  }
  return null;
}
