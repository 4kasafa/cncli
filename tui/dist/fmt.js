export function toInt(v) {
    const n = parseInt(String(v == null ? "" : v), 10);
    return isNaN(n) ? 0 : n;
}
export function rupiah(v) {
    const n = toInt(v);
    const f = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return n < 0 ? "Rp -" + f : "Rp " + f;
}
export function dots(v) {
    return String(Math.abs(toInt(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function p2(n) {
    return (n < 10 ? "0" : "") + n;
}
export function nowStamp(d = new Date()) {
    return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}
export function todayStamp(d = new Date()) {
    return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear();
}
export function padU(n, w) {
    let s = String(n);
    while (s.length < w)
        s = "0" + s;
    return s;
}
// print.js-style number: strip non-digits, empty -> 0; "-" rejected (null)
export function cleanNum(v) {
    const s = String(v == null ? "" : v);
    if (/-/.test(s))
        return null;
    const d = s.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    return d === "" ? 0 : parseInt(d, 10);
}
