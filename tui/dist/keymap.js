export const VIEWS = [
    { id: "live", key: "1", label: "Live" },
    { id: "print", key: "2", label: "Print" },
    { id: "comp", key: "3", label: "PCs" },
    { id: "setoran", key: "4", label: "Deposits" },
];
export function viewKey(name) {
    switch (name) {
        case "1":
        case "s":
            return "live";
        case "2":
        case "p":
            return "print";
        case "3":
        case "c":
            return "comp";
        case "4":
        case "d":
            return "setoran";
        default:
            return null;
    }
}
export const ROOT_HINTS = [
    ["enter/l", "open"],
    ["1-4", "jump"],
    ["?", "help"],
    ["q", "quit"],
];
export const VIEW_HINTS = {
    live: [
        ["enter", "open"],
        ["e", "edit"],
        ["esc", "back"],
        ["?", "help"],
    ],
    print: [
        ["m", "meta"],
        ["p", "preview"],
        ["k", "send"],
        ["esc", "back"],
    ],
    comp: [
        ["enter", "open"],
        ["a", "add"],
        ["e", "edit"],
        ["esc", "back"],
    ],
    setoran: [
        ["r", "sync"],
        ["enter", "diff"],
        ["esc", "back"],
        ["?", "help"],
    ],
};
export const HELP = [
    ["nav", "enter / l open · esc / h back · up/down or j/k move"],
    ["jump", "1/s Live · 2/p Print · 3/c PCs · 4/d Deposits"],
    ["live", "enter session · e edit row · a add pc · r retry · d delete · x close"],
    ["print", "m meta · p preview · k send · v 58/80 · e expense · b clear"],
    ["comp", "enter control · a add · e edit · d delete · r check"],
    ["deposits", "r sync · enter diff · l local · g gas · x sign out"],
    ["", ""],
    ["keys", "? help · q quit · ^c quit"],
    ["note", "designed for 40-60 cols; lines clip, never wrap"],
];
