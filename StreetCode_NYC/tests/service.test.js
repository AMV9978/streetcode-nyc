import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAlerts,
  cached,
  decodeAlerts,
} from "../lib/transit/service.js";
import { feeds, feedUrl } from "../lib/transit/feed.js";
const alert = (id, period, agency = "MTASBWY") => ({
  id,
  alert: {
    active_period: period,
    informed_entity: [{ agency_id: agency, route_id: "L" }],
    header_text: {
      translation: [
        { text: "<b>Not selected</b>", language: "en-html" },
        { text: "Real advisory", language: "en" },
      ],
    },
  },
});
test("alerts separate active, future, expired and non-subway modes", () => {
  const r = normalizeAlerts(
    {
      header: { timestamp: 100 },
      entity: [
        alert("active", [{ start: 90, end: 110 }]),
        alert("future", [{ start: 200 }]),
        alert("expired", [{ end: 99 }]),
        alert("bus", [], "MTABC"),
      ],
    },
    100,
  );
  assert.equal(r.alerts.length, 2);
  assert.equal(r.alerts[0].active, true);
  assert.equal(r.alerts[1].active, false);
  assert.equal(r.alerts[0].title, "Real advisory");
});
test("cache coalesces simultaneous callers and reuses a fresh result", async () => {
  let count = 0;
  const loader = async () => {
    count++;
    await new Promise((r) => setTimeout(r, 10));
    return { value: 42 };
  };
  const result = await Promise.all([
    cached("test", loader),
    cached("test", loader),
  ]);
  assert.equal(count, 1);
  assert.equal(result[0].value, 42);
  await cached("test", loader);
  assert.equal(count, 1);
});
test("cache preserves last successful response on failure then expires it", async () => {
  await cached("stale", async () => ({ value: 9 }));
  const fail = async () => {
    throw Error("offline");
  };
  assert.equal((await cached("stale", fail, Date.now() + 30000)).stale, true);
  await assert.rejects(cached("stale", fail, Date.now() + 400000));
});
test("all eight train feeds are allowlisted including Staten Island", () => {
  assert.equal(Object.keys(feeds).length, 8);
  assert.match(feedUrl("si"), /gtfs-si$/);
  assert.throws(() => feedUrl("https://example.com"));
});
test("invalid alerts are rejected", () =>
  assert.throws(() => normalizeAlerts({ entity: [] })));
test("protobuf alert decoder handles English text and route selector", () => {
  const enc = new TextEncoder();
  const v = (n) => {
    const b = [];
    do {
      let x = n & 127;
      n = Math.floor(n / 128);
      b.push(x | (n ? 128 : 0));
    } while (n);
    return b;
  };
  const msg = (id, b) => [...v(id * 8 + 2), ...v(b.length), ...b];
  const str = (id, s) => msg(id, [...enc.encode(s)]);
  const num = (id, n) => [...v(id * 8), ...v(n)];
  const a = [
    ...msg(5, [...str(1, "MTASBWY"), ...str(2, "L")]),
    ...msg(10, msg(1, [...str(1, "Delay"), ...str(2, "en")])),
  ];
  const bytes = new Uint8Array([
    ...msg(1, num(3, 100)),
    ...msg(2, [...str(1, "test"), ...msg(5, a)]),
  ]);
  const result = normalizeAlerts(decodeAlerts(bytes), 100, true);
  assert.equal(result.alerts[0].title, "Delay");
  assert.deepEqual(result.alerts[0].routes, ["L"]);
});
