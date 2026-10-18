export type ViewId = "setoran" | "live" | "print" | "comp";

export const VIEWS: { id: ViewId; key: string; label: string }[] = [
  { id: "setoran", key: "1", label: "setoran" },
  { id: "live", key: "2", label: "live" },
  { id: "print", key: "3", label: "print" },
  { id: "comp", key: "4", label: "comp" },
];

export function viewKey(name: string): ViewId | null {
  switch (name) {
    case "1":
    case "s":
      return "setoran";
    case "2":
    case "l":
      return "live";
    case "3":
    case "p":
      return "print";
    case "4":
    case "c":
      return "comp";
    default:
      return null;
  }
}

export const GLOBAL_KEYBAR: [string, string][] = [
  ["1-4", "view"],
  ["?", "help"],
  ["^c", "keluar"],
];

export const VIEW_KEYBAR: Record<ViewId, [string, string][]> = {
  setoran: [
    ["enter", "beda"],
    ["r", "sinkron"],
    ["g", "ganti akun"],
    ["x", "keluar"],
  ],
  live: [
    ["enter", "buka/lanjut"],
    ["x", "tutup sesi"],
    ["a", "+pc"],
    ["e", "koreksi/isi"],
    ["r", "retry"],
    ["d", "hapus sesi"],
  ],
  print: [
    ["p", "pratinjau"],
    ["k", "kirim"],
    ["v", "58/80"],
    ["e", "pengeluaran"],
    ["b", "bersih"],
  ],
  comp: [
    ["enter", "kontrol"],
    ["a", "+pc"],
    ["e", "ubah"],
    ["d", "hapus"],
    ["r", "cek ulang"],
  ],
};

export const HELP: [string, string][] = [
  ["1 / s", "view setoran (login GAS, arsip, konflik)"],
  ["2 / l", "view live (sesi tarik tx dari PC)"],
  ["3 / p", "view print (denominasi + struk)"],
  ["4 / c", "view comp (daftar PC + kontrol)"],
  ["", ""],
  ["setoran", "r sinkron · enter lihat beda · l/g pakai lokal/gas di sheet · g ganti akun · x keluar"],
  ["live", "enter buka/lanjut sesi · x tutup · a tambah pc · e koreksi/isi baris · d hapus sesi (2x) · r retry"],
  ["print", "p pratinjau · k kirim ke pc · v toggle 58/80 · e pengeluaran · b bersih · tab antar field"],
  ["comp", "enter kontrol · a tambah · e ubah · d hapus (2x) · r cek ulang"],
  ["kontrol", "w watcher nyala · m mati · l muat log · x wipe (pin + HAPUS) · tab antar field"],
  ["", ""],
  ["umum", "esc kembali/batal · ? bantuan · ^c keluar"],
];
