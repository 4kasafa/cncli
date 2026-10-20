import test from "node:test";
import assert from "node:assert/strict";

const Qr = await import("../dist/qr.js");

test("qrAddress accepts http and https bases", () => {
  assert.equal(Qr.qrAddress("http://192.168.1.5:8765"), "http://192.168.1.5:8765");
  assert.equal(Qr.qrAddress("https://pc.local:8765"), "https://pc.local:8765");
});

test("qrAddress normalizes bare host and trailing slash", () => {
  assert.equal(Qr.qrAddress("192.168.1.5"), "http://192.168.1.5:8765");
  assert.equal(Qr.qrAddress("pc.local:8765"), "http://pc.local:8765");
  assert.equal(Qr.qrAddress("http://192.168.1.5:8765/"), "http://192.168.1.5:8765");
});

test("qrAddress rejects empty, whitespace, and non-http schemes", () => {
  assert.equal(Qr.qrAddress(""), null);
  assert.equal(Qr.qrAddress("   "), null);
  assert.equal(Qr.qrAddress("file:///etc/passwd"), null);
  assert.equal(Qr.qrAddress("ftp://192.168.1.5"), null);
  assert.equal(Qr.qrAddress("javascript:alert(1)"), null);
});
