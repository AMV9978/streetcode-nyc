import test from "node:test";
import assert from "node:assert/strict";
import { stations, edges, scenarios } from "../public/lab/network.js";
import { route } from "../public/lab/router.js";
import { MinHeap } from "../public/lab/heap.js";
const network = { stations, edges };
test("heap orders duplicates and empty queue", () => {
  const h = new MinHeap();
  [9, 1, 4, 1, 0, 8].forEach((cost) => h.push({ cost }));
  assert.deepEqual(
    Array.from({ length: 6 }, () => h.pop().cost),
    [0, 1, 1, 4, 8, 9],
  );
  assert.equal(h.pop(), undefined);
});
test("known direct journey and cost accounting", () => {
  const r = route(network, "penn", "atlantic");
  assert.equal(r.minutes, 25);
  assert.equal(r.transfers, 0);
  assert.equal(r.score, 25);
});
test("same endpoint and isolated endpoint", () => {
  assert.equal(route(network, "times", "times").minutes, 0);
  assert.equal(
    route(network, "hudson", "grand", { scenario: scenarios.crosstownClosed })
      .found,
    false,
  );
});
test("closure removes traversal and accessibility rejects endpoints", () => {
  const r = route(network, "grand", "canal", {
    scenario: scenarios.unionClosed,
  });
  assert.ok(r.found);
  assert.ok(!r.path.includes("union"));
  assert.equal(
    route(network, "union", "times", { stepFree: true }).found,
    false,
  );
  assert.equal(
    route(network, "grand", "times", {
      stepFree: true,
      scenario: scenarios.elevator,
    }).found,
    false,
  );
});
test("input costs and station IDs validated", () => {
  assert.throws(() => route(network, "bad", "times"));
  assert.throws(() =>
    route(network, "times", "grand", { transferPenalty: -1 }),
  );
  assert.throws(() =>
    route(
      {
        ...network,
        edges: [{ from: "times", to: "grand", line: "7", minutes: -3 }],
      },
      "times",
      "grand",
    ),
  );
});
test("incoming line must remain part of state", () => {
  const n = {
    stations: ["a", "b", "c"].map((id) => ({ id, stepFree: true })),
    edges: [
      { id: "a", from: "a", to: "b", line: "X", minutes: 1 },
      { id: "b", from: "a", to: "b", line: "Y", minutes: 2 },
      { id: "c", from: "b", to: "c", line: "Y", minutes: 1 },
    ],
  };
  const r = route(n, "a", "c");
  assert.equal(r.minutes, 3);
  assert.equal(r.transfers, 0);
});
// Independent Bellman-Ford relaxation oracle. No heap or production adjacency code.
function oracle(origin, destination, scenario, stepFree, penalty) {
  const blocked = (id) =>
    (scenario.closedStations || []).includes(id) ||
    (stepFree &&
      (!stations.find((s) => s.id === id).stepFree ||
        (scenario.inaccessible || []).includes(id)));
  if (blocked(origin) || blocked(destination)) return Infinity;
  const states = stations.flatMap((s) =>
    ["", ...new Set(edges.map((e) => e.line))].map((l) => [s.id, l]),
  );
  const key = (s, l) => s + "|" + l,
    dist = new Map(states.map(([s, l]) => [key(s, l), Infinity]));
  dist.set(key(origin, ""), 0);
  for (let i = 0; i < states.length - 1; i++) {
    let changed = false;
    for (const [s, l] of states) {
      if (blocked(s)) continue;
      for (const e of edges) {
        if ((scenario.closedLines || []).includes(e.line)) continue;
        const to = e.from === s ? e.to : e.to === s ? e.from : null;
        if (!to || blocked(to)) continue;
        const cost =
          dist.get(key(s, l)) +
          e.minutes +
          (scenario.delays?.[e.line] || 0) +
          (l && l !== e.line ? 4 + penalty : 0);
        if (cost < dist.get(key(to, e.line))) {
          dist.set(key(to, e.line), cost);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return Math.min(
    ...states
      .filter(([s]) => s === destination)
      .map(([s, l]) => dist.get(key(s, l))),
  );
}
test("all 8670 scenario queries match independent shortest path oracle", () => {
  let count = 0;
  for (const scenario of Object.values(scenarios))
    for (const stepFree of [false, true])
      for (const penalty of [0, 8, 20])
        for (const a of stations)
          for (const b of stations) {
            const r = route(network, a.id, b.id, {
              scenario,
              stepFree,
              transferPenalty: penalty,
            });
            assert.equal(
              r.found ? r.score : Infinity,
              oracle(a.id, b.id, scenario, stepFree, penalty),
            );
            if (r.found) {
              assert.equal(r.score, r.minutes + r.transfers * penalty);
              assert.equal(r.path[0], a.id);
              assert.equal(r.path.at(-1), b.id);
            }
            count++;
          }
  assert.equal(count, 8670);
});
test("rerouting avoids 30 simulated minutes versus keeping the old itinerary", async () => {
  const { reprice } = await import("../public/lab/router.js");
  const before = route(network, "times", "atlantic");
  const after = route(network, "times", "atlantic", {
    scenario: scenarios.westDelay,
  });
  assert.equal(
    reprice(network, before, { scenario: scenarios.westDelay }).minutes,
    58,
  );
  assert.equal(after.minutes, 28);
  assert.notDeepEqual(before.path, after.path);
  assert.equal(
    reprice(network, route(network, "grand", "canal"), {
      scenario: scenarios.unionClosed,
    }),
    null,
  );
});
