import test from "node:test";
import assert from "node:assert/strict";
import { limit, clientId } from "../lib/http/limit.js";

const req = (ip) => new Request("http://x/api", { headers: { "x-forwarded-for": ip + ", 10.0.0.1" } });

test("allows a burst, then returns 429 with Retry-After, then refills", () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(limit(req("1.1.1.1"), "t", { perMinute: 60, burst: 5 }, t), null);
  const blocked = limit(req("1.1.1.1"), "t", { perMinute: 60, burst: 5 }, t);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "1");
  assert.equal(limit(req("2.2.2.2"), "t", { perMinute: 60, burst: 5 }, t), null, "other clients unaffected");
  assert.equal(limit(req("1.1.1.1"), "t", { perMinute: 60, burst: 5 }, t + 1000), null, "one token per second");
});

test("uses the first forwarded address", () => {
  assert.equal(clientId(req("3.3.3.3")), "3.3.3.3");
});
