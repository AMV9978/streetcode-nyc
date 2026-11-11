import test from "node:test";
import assert from "node:assert/strict";
import { decodeFeed, fields, feedUrl } from "../lib/transit/feed.js";
const enc = new TextEncoder(),
  v = (n) => {
    let x = BigInt(n),
      a = [];
    do {
      let b = Number(x & 127n);
      x >>= 7n;
      if (x) b |= 128;
      a.push(b);
    } while (x);
    return a;
  };
const field = (id, value) =>
  typeof value === "number"
    ? [...v(id * 8), ...v(value)]
    : [...v(id * 8 + 2), ...v(value.length), ...value];
const msg = (...items) => Uint8Array.from(items.flat()),
  s = (id, text) => field(id, enc.encode(text));
function fixture({
  cancel = false,
  skip = false,
  deleted = false,
  time = 1100,
  incremental = false,
  departure = 1110,
} = {}) {
  const header = msg(
    s(1, "2.0"),
    field(2, incremental ? 1 : 0),
    field(3, 1000),
  );
  const desc = msg(
    s(1, "test-trip"),
    s(5, "L"),
    s(3, "20261027"),
    field(4, cancel ? 3 : 0),
  );
  const stop = msg(
    s(4, "L01N"),
    field(1, 17),
    field(3, msg(field(2, departure))),
    field(2, msg(field(2, time))),
    field(5, skip ? 1 : 0),
  );
  const update = msg(field(1, desc), field(2, stop));
  return msg(
    field(1, header),
    field(2, msg(s(1, "entity"), field(2, deleted ? 1 : 0), field(3, update))),
  );
}
test("decodes GTFS header and future stop prediction", () => {
  const f = decodeFeed(fixture(), 1000);
  assert.equal(f.version, "2.0");
  assert.equal(f.trips, 1);
  assert.equal(f.arrivals[0].stopId, "L01N");
  assert.equal(f.arrivals[0].time, 1100);
  assert.equal(f.arrivals[0].departure, 1110);
  assert.equal(f.arrivals[0].sequence, 17);
  assert.equal(f.arrivals[0].startDate, "20261027");
});
test("excludes cancelled, deleted, skipped and past predictions", () => {
  for (const opts of [
    { cancel: true },
    { deleted: true },
    { skip: true },
    { time: 900 },
  ])
    assert.equal(decodeFeed(fixture(opts), 1000).arrivals.length, 0);
});
test("rejects malformed, truncated, differential and oversized payloads", () => {
  assert.throws(() => fields(Uint8Array.of(10, 50, 1)));
  assert.throws(() => fields(Uint8Array.of(0)));
  assert.throws(() => decodeFeed(new Uint8Array(4_000_001)));
  assert.throws(() => decodeFeed(fixture({ incremental: true }), 1000));
  assert.throws(() => decodeFeed(enc.encode("<html>")));
});
test("feed URL constrained to known choices", () => {
  assert.ok(feedUrl("l").endsWith("gtfs-l"));
  assert.throws(() => feedUrl("https://example.com"));
});
