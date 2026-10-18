# CNcli — User Flow / CLI Flow

> Bahasa sederhana. Sumber plan: 8 ronde grill-me yang sudah dikunci.
> Aturan global: data di `~/.cncli/`, PIN tidak pernah disimpan, password GAS tersimpan (chmod 600), output full English, `--json` di semua command, timeout LAN 10s / GAS 20s.

---

## A. Flow versi PLAN (18 commands, sesuai kunci)

Daftar kunci: `connect, status, start, live, stop, history, calculate, print, edit, fill, setoran, watcher, log, port, pin, wipe, shutdown, meta`.

### A1. Pertama kali (sekali saja)

```text
1. Install di Termux:
   pkg install python git
   git clone <repo-CNcli> && cd CNcli
   pip install -e .

2. Sambungkan ke PC kasir (satu WiFi):
   cncli connect http://192.168.1.5:8765
   -> simpan alamat + cek PC hidup atau tidak

3. Cek PC sehat:
   cncli status
   -> tampil: version, ip, port, watcher on/off, db_busy, count_today

4. Isi data toko sekali (disimpan, tidak perlu ketik lagi):
   cncli meta set --kasir Budi --id-kasir K01 --cabang TokoA --shift 1
   cncli meta show
   -> cek data sudah benar

5. Simpan login GAS sekali (untuk setoran otomatis):
   cncli setoran --save-login
   -> ketik email + password (password tidak terlihat)
```

### A2. Setiap hari jualan (pagi → malam)

```text
PAGI — buka sesi:
  cncli start
  -> buat sesi baru + langsung pantau transaksi (watch terus)
  -> Ctrl+C = berhenti lihat saja, sesi tetap buka
  -> interval pantau tiap 2 detik

SIANG — lihat-lihat:
  cncli live
  -> hanya daftar sesi yang masih buka
  cncli history
  -> daftar semua sesi (buka + tutup + tanda "belum lengkap")
  -> pilih nomor dari daftar untuk buka lagi (resume)

  Lanjutkan sesi kemarin:
  cncli start --resume 2026-10-15_1
  -> buka lagi sesi lama + pantau lagi

SORE — kalau ada salah catat, betulkan di HP saja (tidak kirim ke PC):
  cncli edit <id-transaksi> --tunai 50000 --nontunai 0
  -> betulkan nominal, ditandai EDITED
  cncli fill 2026-10-16|12 --tunai 30000 --nontunai 0
  -> isi nomor struk yang HILANG di PC (format hari|nomor)

TUTUP SORE — hitung uang laci:
  cncli calculate --pecahan 100k*5,50k*2,10k*10
  -> atau tanpa argumen = ditanya satu-satu (mode interaktif)
  -> bandingkan uang fisik vs total PC + non-tunai dari sesi aktif
  -> butuh sesi lain? tambah: --session 2026-10-15_1

  Kalau cocok, print struk rekap ke printer PC:
  cncli print
  -> pakai meta yang tersimpan + angka non-tunai dari sesi
  -> tanpa meta = ditolak sebelum dikirim

MALAM — tutup sesi + cek setoran:
  cncli stop
  -> tutup sesi aktif
  cncli setoran
  -> login otomatis + tampil dashboard 5 hari + total kurang/lebih
  -> kalau data HP vs GAS beda: ditanya pilih lokal / GAS
  -> untuk script: cncli setoran --prefer gas
```

### A3. Admin / sesekali (butuh `--pin`, tidak disimpan)

```text
  cncli watcher --on --pin 363636        # nyalakan pemantau PC
  cncli watcher --off --pin 363636       # matikan
  cncli log --tail 100 --pin 363636      # lihat log PC
  cncli port --set 8765 --pin 363636     # ganti port PC
  cncli pin --new 123456 --pin 363636    # ganti PIN (6 digit)
  cncli wipe --pin 363636 --confirm HAPUS # hapus total, tanpa ampun
  cncli shutdown --pin 363636 --yes      # matikan PC
```

### A4. Peta ingatan versi PLAN

```text
connect  = simpan alamat PC
status   = PC sehat?
start    = buka sesi BARU + pantau
live     = daftar sesi BUKA
history  = daftar SEMUA sesi
stop     = tutup sesi
calculate= hitung uang laci
print    = kirim struk ke PC
edit     = betulkan transaksi ada
fill     = isi nomor hilang
setoran  = cek uang di GAS
watcher/log/port/pin/wipe/shutdown = atur PC (pakai PIN)
meta     = data toko tersimpan
```

---

## B. Flow versi SAYA (8 perintah, menurut saya lebih baik)

Prinsip: perintah yang jarang dipakai gabungkan, yang mirip satukan, yang bisa otomatis jangan ditanya lagi.

```text
cncli connect | status | ses | watch | count | fix | setoran | pc
```

### B1. Pertama kali

```text
  cncli connect http://192.168.1.5:8765   # sama: simpan + cek
  cncli status                            # sama
  cncli count --setup                     # gabungan meta set: ditanya
                                          # kasir/id/cabang/shift + simpan
                                          # login GAS sekaligus (sekali saja)
```

Hilang: `meta set/show`, `setoran --save-login` → jadi satu wizard `count --setup`.

### B2. Harian (4 perintah saja)

```text
  cncli ses              # SATU daftar untuk semua sesi (buka + tutup)
                         # angka [1..n], tanda * = aktif, ! = belum lengkap
                         # pilih angka = buka/resume langsung + pantau
                         # --new = buat baru, --close = tutup aktif

  cncli watch            # pantau sesi aktif, sekali jalan + keluar = berhenti
                         # tidak ada "selalu watch" yang mengunci terminal
                         # --interval 2 (default), --once (lihat sekali saja)

  cncli fix 12 --tunai 50000             # gabungan edit + fill:
                         # kalau ID ada = edit, kalau nomor hilang = isi
                         # tidak perlu ingat beda edit vs fill + format hari|n
                         # otomatis ditebak dari konteks sesi aktif

  cncli count 100k*5,50k*2               # gabungan calculate + print:
                         # hitung dulu, tampil selisih
                         # --print = langsung kirim ke printer PC
                         # meta + non-tunai diambil otomatis dari sesi aktif
```

Contoh sore lengkap versi saya:

```text
  cncli ses            # pilih 1 (sesi hari ini)
  cncli count 100k*5,50k*2,10k*10
  -> "cash 620rb vs PC 600rb = +20rb, non-cash 150rb. print? [y/N]"
  y
  -> struk terkirim, selesai. Tidak ada perintah print terpisah.
```

### B3. Admin (satu pintu `pc`)

```text
  cncli pc status              # = status + watcher state (satu layar)
  cncli pc log --tail 100      # PIN ditanya interaktif (tidak di history shell)
  cncli pc watcher --on        # sama, PIN via prompt
  cncli pc port 8765           # PIN via prompt
  cncli pc pin --new 123456    # PIN lama via prompt
  cncli pc wipe                # ditanya PIN -> ketik HAPUS -> ketik YES
  cncli pc off                 # = shutdown, butuh --yes
```

Hilang: 7 perintah admin terpisah → tinggal `cncli pc <sub>`. PIN tidak pernah jadi argumen `--pin` (bocor di history shell + `ps`), selalu via prompt tersembunyi.

### B4. Peta ingatan versi SAYA

```text
connect = simpan alamat PC
status  = PC sehat?
ses     = semua sesi, pilih angka untuk buka
watch   = pantau (bisa sekali lihat)
count   = hitung + (opsional) print
fix     = betulkan apa pun
setoran = cek GAS (login otomatis)
pc      = semua urusan PC, PIN via prompt
```

---

## C. Perbandingan jujur

| Aspek | A. Plan (18 commands) | B. Versi saya (8 commands) |
|---|---|---|
| Hafalan | 18 nama + beda `live` vs `history`, `edit` vs `fill`, `calculate` vs `print` | 8 nama, satu pola `kata benda + aksi` |
| Skenario sore | 4 perintah: `calculate` → `print` → (salah?) `edit`/`fill` → `stop` | 2 perintah: `count` (+y) → `ses --close`; `fix` hanya bila salah |
| Salah pilih sesi | `--session ID` diketik manual, salah ketik = sesi salah | `ses` pilih angka dari daftar, tidak ketik ID |
| Jejak PIN | `--pin 363636` masuk history shell + `ps aux` terlihat | PIN selalu prompt tersembunyi, tidak tersimpan di mana pun |
| `live` selalu-watch | Terminal terkunci selama watch; Ctrl+C membingungkan (sesi masih open?) | `watch` default sekali lihat / `--watch` bila mau; keluar = selesai, jelas |
| `meta` terpisah | Lupa `meta set` → `print` gagal di kasir | `count --setup` sekali di awal; `count` tidak pernah gagal karena meta |
| Konflik GAS | Sudah bagus (`--prefer`) | Sama, dipertahankan |
| Kelemahan | — | Harus tulis ulang parser (grouped subcommands); migrasi dari 18 nama bila sudah terlanjur rilis |
| Kapan A menang | Operator sudah hafal + butuh scripting granular per perintah (`edit` vs `fill` beda exit code) | — |
| Kapan B menang | Operator kasir biasa di Termux kecil, satu tangan, ingin sedikit ketik | — |

### Rekomendasi saya

Bangun **B untuk manusia + pertahankan A sebagai alias tersembunyi**. Contoh: `start` = alias `ses --new --watch`, `live` = alias `ses --open`, `history` = alias `ses --all`, `calculate` = alias `count`, `print` = alias `count --print`, `edit`/`fill` = alias `fix`. Biaya: ~30 baris mapping alias. Untung: plan kunci tidak rusak (18 nama tetap jalan), tapi flow harian cukup ajarkan 4 perintah (`ses, watch, count, fix`).

```text
# contoh alias (di cli.py, tanpa file tambahan):
# ponytail: alias tipis untuk kompatibilitas plan, hapus bila B sudah baku
ALIASES = {
  "start": ["ses", "--new", "--watch"],
  "live": ["ses", "--open"],
  "history": ["ses", "--all"],
  "calculate": ["count"],
  "print": ["count", "--print"],
  "edit": ["fix"], "fill": ["fix"],
  "watcher": ["pc", "watcher"], "log": ["pc", "log"],
  "port": ["pc", "port"], "pin": ["pc", "pin"],
  "wipe": ["pc", "wipe"], "shutdown": ["pc", "off"],
  "meta": ["count", "--setup"],
}
```

---

## D. Contoh ujung-ke-ujung (kasir Budi, HP Termux)

Versi PLAN (7 baris ketik):

```text
cncli connect http://192.168.1.5:8765
cncli start
cncli calculate --pecahan 100k*5,50k*2,10k*10
cncli print
cncli edit 42 --tunai 50000 --nontunai 0
cncli stop
cncli setoran
```

Versi SAYA (4 baris ketik):

```text
cncli connect http://192.168.1.5:8765
cncli ses --new
cncli count 100k*5,50k*2,10k*10 --print
cncli setoran
# salah catat? sisipkan: cncli fix 42 50k
```

---

## E. Versi INTERACTIVE (banner + menu ala hacking tools)

Cara masuk: ketik `cncli` tanpa argumen (di Termux/TTY) atau `cncli menu`.
Flags tetap non-interactive (`cncli status --json` tidak membuka menu).
Bukan TTY (`echo | cncli`) = tampil help, tidak hang. Di dalam menu
output selalu teks manusia (--json dinonaktifkan).

Banner dibundel statis di `cncli/banner.py` (gaya figlet, tanpa dep,
maks 30 kolom agar muat di layar HP kecil):

```text
  ____ _   _ ____ _     ___
 / ___| \ | / ___| |   |_ _|
 | |   |  \| | |   | |    | |
 | |___| |\  | |___| |___ | |
  \____|_| \_|\____|_____|___|
  v0.1.0 | PC: 192.168.1.5:8765 OK | session: 2026-10-16_1*

  [01] SESSION   list/select/open/close/watch
  [02] CASH      count + print + fix
  [03] SETORAN   GAS dashboard (5 days)
  [04] PC ADMIN  status/log/watcher/port/pin/wipe/off
  [00] EXIT
  cncli >
```

Aturan: `00` = kembali satu level, `Ctrl+C` di menu utama = keluar,
`Ctrl+C` di dalam watch = kembali ke menu (sesi tetap open).
PIN selalu via prompt tersembunyi (tidak pernah argumen `--pin` agar
tidak bocor di history shell). `WIPE` minta ketik `HAPUS`,
shutdown minta ketik `YES`. Setiap aksi sukses mencetak padanan
non-interactive-nya, mis. `[= cncli count 100k*5 --print]`.

### E1. Transkrip sore kasir (4 ketik + 1 jawab)

```text
$ cncli
  (banner + status line)
  cncli > 02
  -- CASH count --
  denominations: 100k*5,50k*2,10k*10
  physical total: Rp 620000
  PC total: Rp 600000 (cash 450000, non-cash 150000)
  diff: Rp 20000
  print recap to PC printer? [y/N]: y
  [= cncli count '100k*5,50k*2,10k*10' --print]
  press Enter to continue:
  cncli > 00
  bye.
```

### E2. Transkrip admin wipe (batal + benar)

```text
  cncli > 04
  [1] status ... [6] WIPE (destructive) [7] shutdown PC [00] BACK
  pc > 6
  PIN (hidden):
  type HAPUS to confirm wipe: batal
  cancelled: HAPUS not typed.
  pc > 6
  PIN (hidden):
  type HAPUS to confirm wipe: HAPUS
  [= cncli wipe] (PIN prompted, never stored)
```

### E3. Alias menu (di `cncli/cli.py`, kompatibel plan 18-command)

```python
ALIASES = {
  "menu": ["menu"],  # cncli menu = buka interactive
  "start": ["ses", "--new", "--watch"],
  "live": ["ses", "--open"],
  "history": ["ses", "--all"],
  "calculate": ["count"],
  "print": ["count", "--print"],
  "edit": ["fix"], "fill": ["fix"],
  "watcher": ["pc", "watcher"], "log": ["pc", "log"],
  "port": ["pc", "port"], "pin": ["pc", "pin"],
  "wipe": ["pc", "wipe"], "shutdown": ["pc", "off"],
  "meta": ["count", "--setup"],
}
```

> Catatan v020: blok di atas sketsa awal sebelum implementasi.
> Yang berlaku adalah §F di bawah (18 command + alias pendek `st/conn/hist`).

---

## F. Command reference (v020, authoritative)

Global: `--json` di mana saja (sebelum/sesudah subcommand). `cncli -v|--version`
cetak versi + exit 0 di mana saja. ID sesi format
`YYYY-MM-DD_N`. Tanpa sesi open, command sesi menolak dengan
`no open session (use --session ID)`.

```text
cncli [--json] menu
cncli connect <base_url>                      # simpan, mis. http://192.168.1.5:8765
cncli status
cncli start [--resume ID] [--interval 2]      # drain lalu watch; Ctrl+C = sesi tetap open
cncli live                                    # sesi open saja
cncli stop [--session ID]
cncli history [--delete ID]                 # hapus sesi closed; open ditolak
cncli calculate [spec] [--session ID] [--expense N] [--note T] [--preview|--no-preview]
                                            # preview default tampil; --no-preview skip
cncli print [spec] [--session ID] [--expense N] [--note T]   # = calculate + kirim
cncli edit <server_id> --tunai N --nontunai M [--session ID]
cncli fill <DAY|N> --tunai N --nontunai M [--session ID]    # mis. 2026-10-16|12
cncli setoran [--prefer local|gas] [--save-login] [--forget]
cncli watcher [--on|--off] [--pin P]          # tanpa flag = tampilkan state
cncli log [--tail 200] [--pin P]
cncli port --set PORT [--pin P]
cncli pin --new NEW_PIN [--pin P]
cncli wipe --confirm HAPUS [--pin P]           # tanpa HAPUS persis = batal
cncli shutdown --yes [--pin P]                 # tanpa --yes = batal
cncli meta [--show] [--kasir K] [--id-kasir I] [--cabang C] [--shift S]
```

PIN: flag `--pin` (sekali warning stderr: terlihat di history, prompt lebih aman)
atau prompt tersembunyi di TTY (tidak pernah disimpan).
Destruktif butuh konfirmasi ganda. Semua pesan full English, timeout
LAN 10s / GAS 20s. Alias pendek: `st`→`status`, `conn`→`connect`,
`hist`→`ses --all`.

---

## G. Full-TUI v040 (8 commands + React OpenTUI, authoritative)

Core harian: `connect, status, ses, watch, count, fix, setoran, pc`.
18 nama lama tetap jalan sebagai alias tersembunyi
(`start/live/history/calculate/print/edit/fill/watcher/log/port/pin/wipe/shutdown`
+ `st/conn/hist`). `meta` + `setoran --save-login` tetap pisah.

```text
cncli ses [--open|--all|--new|--close|--watch|--resume ID|--delete ID|--session ID]
cncli watch [--session ID] [--interval 2] [--once]   # q berhenti, sesi tetap open
cncli count [spec] [--session ID] [--expense N] [--note T] [--print] [--preview|--no-preview]
cncli fix <id|DAY|N> --tunai N --nontunai M [--session ID]  # ada=edit, hilang=fill hari ini
cncli pc <status|log|watcher|port|pin|wipe|off> [value] [--on|--off] [--tail N]
       [--set PORT] [--new PIN] [--confirm HAPUS] [--yes] [--pin P]
```

TUI (`cncli` / `cncli menu`, TTY only): app React OpenTUI di `tui/`
(TypeScript + @opentui/react, dipin ke alias `@androidtui` 0.6.6 supaya
binary Termux ikut terpasang). Launcher `cncli/tui.py` mencoba
`node --experimental-ffi tui/dist/index.js` lalu `bun tui/src/index.tsx`;
runtime/build hilang atau keluar non-nol -> fallback wizard plain
(tidak pernah traceback). Runtime: node >= 26.4 ATAU bun >= 1.3.14.
Setup sekali: `cd tui && npm install`; jalur node juga `npm run build`.

Empat view (gaya noir, tanpa blink):
- 1/s setoran  login GAS auto dari creds tersimpan, arsip cache dulu,
  sheet konflik lokal/gas, login/logout akun.
- 2/l live     sesi buka/tutup/lanjut, tarik tx tiap 2 detik dari semua PC,
  baris HILANG bisa diisi manual, koreksi baris, riwayat sesi.
- 3/p print    11 denominasi, pengeluaran + catatan, pratinjau struk 58/80,
  kirim ke printer PC (pilih PC tersambung).
- 4/c comp     daftar PC + badge hidup, tambah/ubah/hapus (blok saat sesi
  aktif), kontrol: watcher on/off, log, wipe (PIN + ketik HAPUS).

Keys: `1-4` / `s l p c` pindah view, `?` help, `esc` batal, `Ctrl+C` keluar.
State JSON di `~/.cncli/tui/` (sesi/tx/fills/creds/comps/arsip/print-meta);
Python CLI + SQLite tetap utuh untuk jalur skrip dan wizard plain.
