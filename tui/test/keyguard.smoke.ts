import { testRender } from "@opentui/react/test-utils";
import { createElement as h } from "react";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { App } from "../dist/app.js";

const dir = path.join(process.env.TEMP || process.env.TMP || ".", "cncli-tui-keyguard-smoke");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
process.env.CNCLI_TUI_DIR = dir;
writeFileSync(
  dir + "/print-meta.json",
  JSON.stringify({ kasir: "A", kasir_id: "1", cabang: "C", shift: "1", size: "58", qty: {}, expense: 0, note: "" }),
);

const stub = { destroy() {} };
const t = await testRender(h(App, { renderer: stub as never }), { width: 100, height: 30 });
await t.flush();

const f = () => t.captureCharFrame();
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log("ok: " + msg);
  else {
    failed++;
    console.log("FAIL: " + msg);
    console.log("--- frame ---");
    console.log(f());
    console.log("-------------");
  }
}

check(f().includes("live") && f().includes("computers"), "root menu rendered");

t.mockInput.pressKey("2");
await t.renderOnce();
check(f().includes("PHYSICAL"), "print view open");

t.mockInput.pressKey("3");
await t.renderOnce();
check(!f().includes("PCs ("), "digit 3 did not jump to computers");
check(f().includes("x3"), "digit 3 entered as qty");

t.mockInput.pressKey("4");
await t.renderOnce();
check(!f().includes("deposits"), "digit 4 did not jump to reports");
check(f().includes("x34"), "digits entered as 34");

t.mockInput.pressKey("1");
await t.renderOnce();
check(!f().includes("session history"), "digit 1 did not jump to live");
check(f().includes("x341"), "digits entered as 341");

t.mockInput.pressKey("?");
await t.renderOnce();
check(f().includes("help"), "help open");
t.mockInput.pressKey("q");
await t.renderOnce();
check(!f().includes("cncli > help"), "help closed with q");
check(f().includes("PHYSICAL"), "back on print after help");
t.mockInput.pressKey("3");
await t.renderOnce();
check(!f().includes("PCs ("), "digit 3 after help+reopen did not jump");
check(f().includes("341.300.000"), "digit appended after help+reopen");

t.mockInput.pressKey("s");
await t.renderOnce();
check(f().includes("session history"), "'s' still jumps to live");

t.mockInput.pressKey("d");
await t.renderOnce();
check(!f().includes("deposits"), "d in live history did not jump to reports");

t.mockInput.pressKey("c");
await t.renderOnce();
check(f().includes("PCs ("), "computers view open");
t.mockInput.pressKey("d");
await t.renderOnce();
check(!f().includes("deposits"), "d in computers list did not jump to reports");
check(f().includes("PCs ("), "still on computers");

t.mockInput.pressKey("1");
await t.renderOnce();
check(f().includes("session history"), "digit jump key still works from computers");

console.log(failed ? "RESULT: " + failed + " FAILURES" : "RESULT: ALL SMOKE CHECKS PASSED");
await t.dispose();
process.exit(failed ? 1 : 0);
