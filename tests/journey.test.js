import test from "node:test";
import assert from "node:assert/strict";
import { findJourney } from "../lib/transit/journey.js";
import { nearbyStations, distanceMeters } from "../lib/transit/nearby.js";
import network from "../lib/transit/map-data.json" with { type: "json" };
const now = 1000;
const net = (transfers = []) => ({
  stations: ["A", "B", "C", "D"].map((id) => ({ id })),
  transfers,
});
const trip = (id, route, stops) =>
  stops.map(([s, t, dep], i) => ({
    trip: id,
    route,
    stopId: s + "N",
    time: t,
    departure: dep ?? t,
    sequence: i + 1,
    startDate: "20261027",
  }));
const snap = (arrivals, more = {}) => ({
  feed: "bdfm",
  timestamp: now,
  arrivals,
  ...more,
});
const search = (rows, from = "A", to = "C", n = net(), buffer = 60) =>
  findJourney(n, [snap(rows)], from, to, now, buffer);
test("chooses later-departing express when it arrives first", () => {
  const r = search([
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
  assert.equal(r.transfers, 0);
});
test("allows dwell time at origin and remains on one trip through intermediate stops", () => {
  const r = search(
    trip("through", "D", [
      ["A", 1020, 1080],
      ["B", 1100],
      ["C", 1120],
    ]),
  );
  assert.equal(r.arrival, 1120);
  assert.equal(r.legs.length, 1);
  assert.equal(r.departure, 1080);
});
test("a user boarding buffer excludes a train they cannot reach", () => {
  const rows = [
    ...trip("early", "D", [
      ["A", 1100],
      ["C", 1300],
    ]),
    ...trip("later", "F", [
      ["A", 1400],
      ["C", 1600],
    ]),
  ];
  assert.equal(search(rows, "A", "C", net(), 300).arrival, 1600);
});
test("respects transfer time before another train", () => {
  const rows = [
    ...trip("one", "F", [
      ["A", 1100],
      ["B", 1200],
    ]),
    ...trip("miss", "D", [
      ["B", 1300],
      ["C", 1400],
    ]),
    ...trip("catch", "D", [
      ["B", 1390],
      ["C", 1550],
    ]),
  ];
  const r = search(rows);
  assert.equal(r.arrival, 1550);
  assert.equal(r.transfers, 1);
  assert.equal(r.legs[1].seconds, 180);
});
test("explicit directed transfers permit changing platform groups", () => {
  const n = net([{ from: "B", to: "D", seconds: 240 }]);
  const rows = [
    ...trip("one", "B", [
      ["A", 1100],
      ["B", 1200],
    ]),
    ...trip("two", "D", [
      ["D", 1500],
      ["C", 1700],
    ]),
  ];
  assert.equal(search(rows, "A", "C", n).arrival, 1700);
  assert.equal(search(rows, "D", "B", n).found, false);
});
test("initial and final passageways take real transfer time", () => {
  const rows = trip("one", "D", [
      ["B", 1350],
      ["D", 1500],
    ]),
    n = net([
      { from: "A", to: "B", seconds: 240 },
      { from: "D", to: "C", seconds: 180 },
    ]);
  const r = search(rows, "A", "C", n);
  assert.equal(r.arrival, 1680);
  assert.equal(r.legs[0].kind, "transfer");
  assert.equal(r.legs.at(-1).seconds, 180);
});
test("does not splice different train, service-day, or feed identities", () => {
  const a = trip("one", "D", [["A", 1100]]),
    c = trip("two", "D", [["C", 1400]]);
  assert.equal(search([...a, ...c]).found, false);
  const changed = trip("one", "D", [["C", 1400]]).map((x) => ({
    ...x,
    startDate: "20261028",
  }));
  assert.equal(search([...a, ...changed]).found, false);
  const r = findJourney(
    net(),
    [snap(a), snap(trip("one", "D", [["C", 1400]]), { feed: "ace" })],
    "A",
    "C",
    now,
    60,
  );
  assert.equal(r.found, false);
});
test("rejects stale, future-dated and failed cached feeds", () => {
  for (const more of [
    { timestamp: now - 91 },
    { timestamp: now + 31 },
    { stale: true },
  ])
    assert.equal(
      findJourney(
        net(),
        [
          snap(
            trip("one", "D", [
              ["A", 1100],
              ["C", 1400],
            ]),
            more,
          ),
        ],
        "A",
        "C",
        now,
      ).found,
      false,
    );
});
test("rejects decreasing predictions and beyond-horizon destinations", () => {
  assert.equal(
    search(
      trip("one", "D", [
        ["A", 1200],
        ["B", 1100],
        ["C", 1400],
      ]),
    ).found,
    false,
  );
  assert.equal(
    search(
      trip("one", "D", [
        ["A", 1100],
        ["C", 5000],
      ]),
    ).found,
    false,
  );
});
test("same station, walking-only, and impossible routes have distinct results", () => {
  assert.equal(search([], "A", "A").sameStation, true);
  assert.equal(
    search([], "A", "C", net([{ from: "A", to: "C", seconds: 300 }])).walkOnly,
    true,
  );
  assert.equal(search([]).found, false);
  assert.throws(() => search([], "bad"));
});
test("map transfer references and station IDs are consistent", () => {
  const ids = new Set(network.stations.map((s) => s.id));
  assert.equal(ids.size, 496);
  for (const t of network.transfers) {
    assert.ok(ids.has(t.from) && ids.has(t.to));
    assert.ok(t.seconds >= 0);
  }
  for (const c of network.complexes)
    for (const id of c.stations) assert.ok(ids.has(id));
  assert.ok(
    network.stations.some(
      (s) => s.name.includes("Bryant") && s.routes.includes("D"),
    ),
  );
});
test("nearby search includes Bryant Park from Times Square and deduplicates complexes", () => {
  const times = network.stations.find((s) => s.id === "127");
  const nearby = nearbyStations(network.stations, times, {
    excludeComplex: times.complex,
  });
  assert.ok(nearby.some((s) => s.name.includes("Bryant")));
  assert.equal(new Set(nearby.map((s) => s.complex)).size, nearby.length);
  assert.ok(nearby.every((s, i) => !i || s.meters >= nearby[i - 1].meters));
  assert.equal(distanceMeters(times, times), 0);
  assert.deepEqual(nearbyStations(network.stations, { lat: 0, lon: 0 }), []);
});
