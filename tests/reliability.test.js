import test from "node:test";
import assert from "node:assert/strict";
import { ReliabilityTracker } from "../lib/transit/reliability.js";

const snap = (timestamp, arrivals) => ({ timestamp, arrivals });
const a = (trip, time, route = "6X") => ({
  trip,
  route,
  stopId: "631N",
  time,
  startDate: "20261120",
});

test("scores earlier predictions against the final one, by line and lead time", () => {
  const t = new ReliabilityTracker();
  // Shown as arriving at 1600 when observed at 1000 (10 min ahead) ...
  t.observe("numbered", snap(1000, [a("x", 1600)]));
  t.observe("numbered", snap(1030, [a("x", 1630)]));
  // ... the train actually arrives at 1690.
  for (let at = 1060; at <= 1690; at += 30)
    t.observe("numbered", snap(at, [a("x", 1690)]));
  t.observe("numbered", snap(1720, [])); // left the stop
  const s = t.summary();
  assert.equal(s.trainsScored, 1);
  const line = s.lines["6"]; // express variant folded into its line
  assert.ok(line, "6X is reported as the 6");
  // 10 minutes out (at 1090) the screen showed 1690: exact.
  assert.equal(line["10"].meanAbsSeconds, 0);
  // We first saw the train 690 s out, so there is no 20-minute checkpoint.
  assert.equal(line["20"], undefined);
  // 3 minutes out the prediction was also right.
  assert.equal(line["3"].withinOneMinute, 1);
});

test("a late train shows up as negative bias at the checkpoint", () => {
  const t = new ReliabilityTracker();
  // Shown 1600 for a long time, but the train comes at 1720.
  for (let at = 900; at <= 1570; at += 30) t.observe("l", snap(at, [a("w", 1600, "L")]));
  for (let at = 1600; at <= 1720; at += 30) t.observe("l", snap(at, [a("w", 1720, "L")]));
  t.observe("l", snap(1750, []));
  const line = t.summary().lines.L;
  assert.equal(line["5"].biasSeconds, -120); // 5 min out it said 1600
  assert.equal(line["1"].biasSeconds, 0); // 1 min out it had caught up
});
test("ignores trains with observation gaps and repeated snapshots", () => {
  const t = new ReliabilityTracker();
  t.observe("l", snap(1000, [a("y", 1300, "L")]));
  t.observe("l", snap(1000, [a("y", 1300, "L")])); // same snapshot again
  t.observe("l", snap(1400, [])); // 400 s gap: not trustworthy
  assert.equal(t.summary().trainsScored, 0);
  assert.equal(t.summary().watching, 0);
});

test("a train that disappears long before it was due is not scored", () => {
  const t = new ReliabilityTracker();
  t.observe("l", snap(1000, [a("z", 2500, "L")]));
  t.observe("l", snap(1030, [])); // dropped 25 min early: cancelled or rerouted
  assert.equal(t.summary().trainsScored, 0);
});

test("memory stays bounded", () => {
  const t = new ReliabilityTracker({ maxWatched: 100 });
  const rows = Array.from({ length: 500 }, (_, i) => a("t" + i, 2000 + i, "L"));
  t.observe("l", snap(1000, rows));
  assert.equal(t.watching.size, 100);
});
