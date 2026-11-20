import test from "node:test";
import assert from "node:assert/strict";
import { planTrips } from "../lib/transit/raptor.js";
import { findJourney } from "../lib/transit/journey.js";

const now = 1000;
const ids = ["A", "B", "C", "D", "E", "F"];
const net = (transfers = [], complexes = {}) => ({
  stations: ids.map((id) => ({ id, complex: complexes[id] || id })),
  transfers,
});
const trip = (id, route, stops, feed = "bdfm") =>
  stops.map(([s, t, dep], i) => ({
    trip: id,
    route,
    stopId: s + "N",
    time: t,
    departure: dep ?? t,
    sequence: i + 1,
    startDate: "20261027",
  }));
const snap = (arrivals) => ({ feed: "bdfm", timestamp: now, arrivals });
const plan = (rows, from = "A", to = "C", n = net(), extra = {}) =>
  planTrips(n, [snap(rows)], {
    from,
    to,
    now,
    boardingSeconds: 60,
    ...extra,
  });

test("RAPTOR returns the faster express and a later direct option is dropped", () => {
  const r = plan([
    ...trip("local", "F", [
      ["A", 1100],
      ["B", 1300],
      ["C", 1700],
    ]),
    ...trip("express", "D", [
      ["A", 1200],
      ["C", 1500],
    ]),
  ]);
  assert.equal(r.arrival, 1500);
  assert.equal(r.legs[0].route, "D");
  assert.equal(r.options.length, 1);
});

test("Pareto options: one-seat ride kept when a transfer is faster", () => {
  const rows = [
    // Direct, slow
    ...trip("slow", "F", [
      ["A", 1100],
      ["B", 1400],
      ["C", 2400],
    ]),
    // Faster with a change at B
    ...trip("first", "D", [
      ["A", 1150],
      ["B", 1300],
    ]),
    ...trip("second", "Q", [
      ["B", 1600],
      ["C", 1800],
    ]),
  ];
  const r = plan(rows);
  assert.equal(r.arrival, 1800);
  assert.equal(r.transfers, 1);
  assert.equal(r.options.length, 2);
  assert.equal(r.options[1].transfers, 0);
  assert.equal(r.options[1].arrival, 2400);
  // The change leg uses the default three-minute transfer.
  assert.deepEqual(
    r.legs.map((l) => l.kind),
    ["ride", "transfer", "ride"],
  );
  assert.equal(r.stats.rounds >= 2, true);
});

test("complex scope treats every platform in a station as start and end", () => {
  // A and E are one complex; C and F are one complex.
  const n = net([], { E: "A", F: "C" });
  const rows = trip("only", "G", [
    ["E", 1200],
    ["F", 1500],
  ]);
  assert.equal(plan(rows, "A", "C", n).found, false);
  const r = plan(rows, "A", "C", n, { scope: "complex" });
  assert.equal(r.found, true);
  assert.equal(r.arrival, 1500);
  assert.deepEqual(r.legs.map((l) => l.kind), ["ride"]);
  assert.equal(plan([], "A", "E", n, { scope: "complex" }).sameStation, true);
});

test("step-free mode refuses to change trains at a station without access", () => {
  const rows = [
    ...trip("one", "F", [
      ["A", 1100],
      ["B", 1200],
    ]),
    ...trip("two", "D", [
      ["B", 1500],
      ["C", 1700],
    ]),
  ];
  assert.equal(plan(rows).arrival, 1700);
  const blocked = plan(rows, "A", "C", net(), { allowed: new Set(["A", "C"]) });
  assert.equal(blocked.found, false);
  const endpoints = plan(rows, "A", "C", net(), { allowed: new Set(["B", "C"]) });
  assert.equal(endpoints.reason, "not-step-free");
  // Riding straight through an inaccessible station is fine.
  const through = plan(
    trip("t", "F", [
      ["A", 1100],
      ["B", 1200],
      ["C", 1300],
    ]),
    "A",
    "C",
    net(),
    { allowed: new Set(["A", "C"]) },
  );
  assert.equal(through.arrival, 1300);
});

test("records search statistics for the explainer", () => {
  const r = plan(
    trip("t", "F", [
      ["A", 1100],
      ["B", 1200],
      ["C", 1300],
    ]),
  );
  assert.ok(r.stats.tripsScanned >= 1);
  assert.ok(r.stats.stopEventsScanned >= 2);
  assert.ok(Number.isFinite(r.stats.ms));
  assert.equal(r.legs[0].dest, "CN");
});

// Seeded pseudo-random generator so failures are reproducible.
function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
test("RAPTOR earliest arrival matches the independent search on 3,000 random networks", () => {
  let compared = 0,
    found = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const r = rng(seed),
      pick = (a) => a[Math.floor(r() * a.length)];
    const transfers = [];
    for (const id of ids) if (r() < 0.6) transfers.push({ from: id, to: id, seconds: 120 + Math.floor(r() * 4) * 60 });
    for (let i = 0; i < 3; i++) {
      const a = pick(ids),
        b = pick(ids);
      if (a !== b) transfers.push({ from: a, to: b, seconds: 120 + Math.floor(r() * 300) });
    }
    const rows = [];
    const tripCount = 2 + Math.floor(r() * 7);
    for (let t = 0; t < tripCount; t++) {
      const length = 2 + Math.floor(r() * 4);
      const route = pick(["A", "C", "E", "F"]);
      const stations = [...ids].sort(() => r() - 0.5).slice(0, length);
      let time = 1000 + Math.floor(r() * 1500);
      const stops = stations.map((s) => {
        const arrival = time;
        const dwell = r() < 0.3 ? Math.floor(r() * 60) : 0;
        time += dwell + 60 + Math.floor(r() * 500);
        return [s, arrival, arrival + dwell];
      });
      rows.push(...trip("t" + t, route, stops));
    }
    const from = pick(ids),
      to = pick(ids);
    const n = net(transfers);
    const boarding = 60 + Math.floor(r() * 4) * 60;
    const reference = findJourney(n, [snap(rows)], from, to, now, boarding);
    const fast = planTrips(n, [snap(rows)], {
      from,
      to,
      now,
      boardingSeconds: boarding,
      maxRounds: 12,
    });
    assert.equal(fast.found, reference.found, `seed ${seed}: found`);
    if (reference.found) {
      found++;
      assert.equal(fast.arrival, reference.arrival, `seed ${seed}: arrival`);
      // Every option must be internally consistent.
      for (const o of fast.options) {
        let clock = now;
        for (const leg of o.legs)
          if (leg.kind === "ride") {
            assert.ok(leg.departure >= clock, `seed ${seed}: departs before ready`);
            clock = leg.arrival;
          } else clock += leg.seconds;
      }
      for (let i = 1; i < fast.options.length; i++) {
        assert.ok(fast.options[i].arrival > fast.options[i - 1].arrival);
        const rides = (o) => o.legs.filter((l) => l.kind === "ride").length;
        assert.ok(rides(fast.options[i]) < rides(fast.options[i - 1]));
      }
    }
    compared++;
  }
  assert.equal(compared, 3000);
  assert.ok(found > 500, "enough journeys exist to make the comparison meaningful");
});
