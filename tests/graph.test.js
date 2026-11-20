import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, prepare, search, compareAll } from "../lib/transit/graph.js";
import { MinHeap } from "../lib/transit/heap.js";
import network from "../lib/transit/map-data.json" with { type: "json" };

const now = 1000;
// Five stations on a line, west to east, roughly 1 km apart.
const stations = ["A", "B", "C", "D", "E"].map((id, i) => ({
  id,
  name: id,
  lat: 40.75,
  lon: -74 + i * 0.012,
  complex: id,
}));

const row = (trip, route, stopId, time, sequence) => ({
  trip,
  route,
  stopId,
  time,
  departure: time,
  sequence,
  startDate: "20261120",
});

test("min-heap pops in priority order with duplicates", () => {
  const h = new MinHeap((x) => x);
  for (const n of [5, 1, 4, 1, 3, 9, 2]) h.push(n);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, [1, 1, 2, 3, 4, 5, 9]);
  assert.equal(h.pop(), undefined);
});

test("graph edges use median ride times and half the gap between trains", () => {
  const arrivals = [];
  // Three local trains, 6 minutes apart; ride A→B takes 100, 120, 500 s.
  [0, 360, 720].forEach((offset, i) => {
    arrivals.push(row("t" + i, "1", "AN", 1100 + offset, 1));
    arrivals.push(row("t" + i, "1", "BN", 1100 + offset + [100, 120, 500][i], 2));
  });
  const g = buildGraph(
    { stations, transfers: [] },
    [{ feed: "numbered", timestamp: now, arrivals }],
    now,
  );
  const edge = g.edges.find((e) => e.from === "A" && e.to === "B");
  assert.equal(edge.seconds, 120); // median, not the 500 s outlier
  assert.equal(edge.wait, 180); // half of the 360 s gap
  assert.equal(edge.samples, 3);
  assert.equal(g.tripsUsed, 3);
});

function lineGraph() {
  // Local "1" stops everywhere (90 s per hop, 120 s wait).
  // Express "2" goes A→C→E (150 s per hop, 300 s wait).
  // Line "L" goes A→E directly but takes 900 s.
  const edges = [];
  const add = (from, to, route, seconds, wait) =>
    edges.push({ from, to, route, seconds, wait });
  add("A", "B", "1", 90, 120);
  add("B", "C", "1", 90, 120);
  add("C", "D", "1", 90, 120);
  add("D", "E", "1", 90, 120);
  add("A", "C", "2", 150, 300);
  add("C", "E", "2", 150, 300);
  add("A", "E", "L", 900, 60);
  return prepare({ edges, transfers: [] }, stations);
}

test("Dijkstra and A* agree; BFS minimises hops; transfer mode minimises changes", () => {
  const p = lineGraph();
  const [bfs, dijkstra, astar, transfers] = compareAll(p, ["A"], ["E"]);
  // Local: 120 wait + 4 × 90 = 480 s. Express: 300 + 300 = 600 s. L: 960 s.
  assert.equal(dijkstra.seconds, 480);
  assert.equal(astar.seconds, 480);
  assert.equal(dijkstra.legs[0].route, "1");
  assert.equal(bfs.hops, 1); // the one-hop L edge
  assert.equal(bfs.legs[0].route, "L");
  assert.equal(transfers.transfers, 0);
  assert.ok(astar.expanded <= dijkstra.expanded, "A* never explores more here");
  assert.deepEqual(dijkstra.legs[0].stops, ["A", "B", "C", "D", "E"]);
});

test("step-free mode blocks boarding at an inaccessible station", () => {
  const p = lineGraph();
  const blocked = search(p, ["A"], ["E"], "dijkstra", {
    allowed: new Set(["B", "E"]),
  });
  assert.equal(blocked.found, false);
});

// Seeded random graphs: A* must always match Dijkstra's optimum.
function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
test("A* matches Dijkstra on 500 random weighted graphs", () => {
  const ids = Array.from({ length: 12 }, (_, i) => "S" + i);
  for (let seed = 1; seed <= 500; seed++) {
    const r = rng(seed);
    const st = ids.map((id) => ({
      id,
      name: id,
      lat: 40.6 + r() * 0.2,
      lon: -74 + r() * 0.2,
      complex: id,
    }));
    const edges = [];
    for (let k = 0; k < 30; k++) {
      const a = ids[Math.floor(r() * ids.length)],
        b = ids[Math.floor(r() * ids.length)];
      if (a !== b)
        edges.push({
          from: a,
          to: b,
          route: ["1", "2", "3"][Math.floor(r() * 3)],
          seconds: 60 + Math.floor(r() * 600),
          wait: 60 + Math.floor(r() * 300),
        });
    }
    const p = prepare({ edges, transfers: [] }, st);
    const d = search(p, ["S0"], ["S11"], "dijkstra"),
      a = search(p, ["S0"], ["S11"], "astar");
    assert.equal(a.found, d.found, `seed ${seed}`);
    if (d.found) assert.equal(a.seconds, d.seconds, `seed ${seed}`);
  }
});

test("the bundled map's transfers load into the graph without errors", () => {
  const p = prepare({ edges: [], transfers: network.transfers }, network.stations);
  assert.ok(p.links.size > 50);
  const r = search(p, ["127"], ["725"], "dijkstra");
  // Times Sq 1/2/3 to Times Sq 7 by passageway only.
  assert.equal(r.found, true);
  assert.equal(r.legs[0].kind, "walk");
});
