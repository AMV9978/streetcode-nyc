/**
 * A weighted graph of the whole subway, learned from the trains running now,
 * plus four classic shortest-path algorithms that can be compared on it.
 *
 * Edges come from consecutive stops of live MTA trips. Each edge's weight is
 * the median ride time currently predicted between those two stops on that
 * line, and each edge also carries an expected wait: half the median gap
 * between trains on that line and direction at the boarding stop.
 *
 * This file runs in Node (API routes, tests) and in the browser (/algorithms).
 */
import { MinHeap } from "./heap.js";
import { collectTrips, transferTables } from "./raptor.js";
import { distanceMeters } from "./nearby.js";

const median = (values) => {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

/** Build the compact graph sent to the browser by /api/graph. */
export function buildGraph(network, snapshots, now) {
  const trips = collectTrips(network, snapshots, now);
  const rides = new Map(),
    passes = new Map();
  for (const trip of trips) {
    for (let i = 0; i < trip.stops.length; i++) {
      const a = trip.stops[i],
        dir = a.stopId.slice(-1);
      const passKey = `${a.parent}|${trip.route}|${dir}`;
      if (!passes.has(passKey)) passes.set(passKey, []);
      passes.get(passKey).push(a.time);
      const b = trip.stops[i + 1];
      if (!b) continue;
      const seconds = b.time - (a.departure ?? a.time);
      // Ignore malformed or implausible segments (negative, or > 30 min).
      if (!(seconds >= 0 && seconds <= 1800) || a.parent === b.parent) continue;
      const key = `${a.parent}|${b.parent}|${trip.route}|${dir}`;
      if (!rides.has(key)) rides.set(key, []);
      rides.get(key).push(seconds);
    }
  }
  const waitAt = (station, route, dir) => {
    const times = [...new Set(passes.get(`${station}|${route}|${dir}`) || [])].sort(
      (x, y) => x - y,
    );
    if (times.length < 2) return 600; // one train in the next hour: assume a long wait
    const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0);
    return Math.max(60, Math.min(1800, Math.round(median(gaps) / 2) || 600));
  };
  const edges = [];
  for (const [key, samples] of rides) {
    const [from, to, route, dir] = key.split("|");
    edges.push({
      from,
      to,
      route,
      seconds: Math.max(30, median(samples)),
      wait: waitAt(from, route, dir),
      samples: samples.length,
    });
  }
  const transfers = (network.transfers || []).map((t) => ({
    from: t.from,
    to: t.to,
    seconds: Math.max(120, Number(t.seconds) || 180),
  }));
  return {
    builtAt: now,
    tripsUsed: trips.length,
    edges,
    transfers,
  };
}

/** Adjacency lists plus the lookups every algorithm needs. */
export function prepare(graph, stations) {
  const station = new Map(stations.map((s) => [s.id, s]));
  const out = new Map();
  for (const e of graph.edges) {
    if (!station.has(e.from) || !station.has(e.to)) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push({ ...e, kind: "ride" });
  }
  const { links, selfTimes } = transferTables({
    stations,
    transfers: graph.transfers,
  });
  // Fastest straight-line speed of any single hop, used by A*. Because track
  // and passageways are never shorter than a straight line, this bound never
  // overestimates the remaining time (the heuristic is admissible).
  let speed = 1;
  for (const e of graph.edges) {
    const a = station.get(e.from),
      b = station.get(e.to);
    if (a && b) speed = Math.max(speed, distanceMeters(a, b) / e.seconds);
  }
  for (const [from, list] of links)
    for (const w of list) {
      const a = station.get(from),
        b = station.get(w.to);
      if (a && b) speed = Math.max(speed, distanceMeters(a, b) / w.seconds);
    }
  return { station, out, links, selfTimes, speed };
}

const stateKey = (id, route) => id + "|" + route;

/**
 * Generic best-first search over (station, current line) states.
 * The line is part of the state because arriving on the 4 and continuing on
 * the 4 is free, while switching to the 6 costs a transfer and a wait.
 *
 * mode:
 *   "dijkstra"  minimise expected minutes
 *   "astar"     same answer as Dijkstra, guided by a distance heuristic
 *   "transfers" minimise train changes first, then minutes (lexicographic)
 *   "bfs"       fewest hops, ignoring time entirely (a plain queue)
 */
export function search(prepared, sources, targets, mode = "dijkstra", options = {}) {
  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const { station, out, links, selfTimes, speed } = prepared;
  const targetSet = new Set(targets);
  const allowed = options.allowed || null;
  const ok = (id) => !allowed || allowed.has(id);
  const targetPoints = targets.map((t) => station.get(t)).filter(Boolean);
  const h =
    mode === "astar"
      ? (id) => {
          const s = station.get(id);
          if (!s || !targetPoints.length) return 0;
          let d = Infinity;
          for (const t of targetPoints) d = Math.min(d, distanceMeters(s, t));
          return d / speed;
        }
      : () => 0;
  const BIG = 1e7; // one train change outweighs any number of seconds
  const dist = new Map(),
    time = new Map(),
    changes = new Map(),
    parent = new Map(),
    order = [];
  const queue = [];
  let head = 0;
  const heap = new MinHeap((x) => x.priority);
  const push = (key, id, route, seconds, rides, via) => {
    const score =
      mode === "bfs" ? via.hops : mode === "transfers" ? rides * BIG + seconds : seconds;
    if (score >= (dist.get(key) ?? Infinity)) return false;
    dist.set(key, score);
    time.set(key, seconds);
    changes.set(key, rides);
    parent.set(key, via);
    if (mode === "bfs") queue.push({ key, id, route, hops: via.hops });
    else heap.push({ key, id, route, score, priority: score + h(id) });
    return true;
  };
  for (const s of sources)
    if (station.has(s) && ok(s)) push(stateKey(s, ""), s, "", 0, 0, { hops: 0 });
  let expanded = 0,
    relaxed = 0,
    goal = null;
  const seen = new Set();
  while (mode === "bfs" ? head < queue.length : heap.size) {
    const cur = mode === "bfs" ? queue[head++] : heap.pop();
    if (mode !== "bfs") {
      if (cur.score !== dist.get(cur.key)) continue; // stale heap entry
    } else if (cur.hops !== dist.get(cur.key)) continue;
    expanded++;
    if (!seen.has(cur.id)) {
      seen.add(cur.id);
      order.push(cur.id);
    }
    if (targetSet.has(cur.id) && ok(cur.id)) {
      goal = cur.key;
      break;
    }
    const t0 = time.get(cur.key),
      r0 = changes.get(cur.key),
      hops = (parent.get(cur.key)?.hops ?? 0) + 1;
    // Ride: stay on the same line for free, or board a new one.
    for (const e of out.get(cur.id) || []) {
      const same = cur.route && e.route === cur.route;
      if (!same && !ok(cur.id)) continue; // can't board or change trains here
      const change = same ? 0 : (cur.route ? (selfTimes.get(cur.id) ?? 180) : 0) + e.wait;
      const rides = r0 + (same ? 0 : 1);
      relaxed++;
      push(stateKey(e.to, e.route), e.to, e.route, t0 + change + e.seconds, rides, {
        from: cur.key,
        edge: e,
        boarded: !same,
        waited: same ? 0 : e.wait,
        hops,
      });
    }
    // Walk to another platform group in the same complex.
    if (ok(cur.id))
      for (const w of links.get(cur.id) || []) {
        if (!ok(w.to)) continue;
        relaxed++;
        push(stateKey(w.to, ""), w.to, "", t0 + w.seconds, r0, {
          from: cur.key,
          walk: { from: cur.id, to: w.to, seconds: w.seconds },
          hops,
        });
      }
  }
  const ms =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  const base = {
    mode,
    expanded,
    relaxed,
    order,
    ms: Math.round(ms * 100) / 100,
  };
  if (!goal) return { ...base, found: false };
  // Rebuild the path, merging consecutive hops on one line into one leg.
  const steps = [];
  for (let k = goal; parent.get(k)?.from; k = parent.get(k).from)
    steps.push(parent.get(k));
  steps.reverse();
  const legs = [];
  for (const s of steps) {
    if (s.walk) {
      legs.push({ kind: "walk", ...s.walk });
      continue;
    }
    const last = legs[legs.length - 1];
    if (!s.boarded && last?.kind === "ride" && last.route === s.edge.route) {
      last.to = s.edge.to;
      last.stops.push(s.edge.to);
      last.seconds += s.edge.seconds;
    } else
      legs.push({
        kind: "ride",
        route: s.edge.route,
        from: s.edge.from,
        to: s.edge.to,
        stops: [s.edge.from, s.edge.to],
        seconds: s.edge.seconds,
        wait: s.waited,
      });
  }
  const rideCount = legs.filter((l) => l.kind === "ride").length;
  return {
    ...base,
    found: true,
    seconds: time.get(goal),
    transfers: Math.max(0, rideCount - 1),
    hops: steps.length,
    legs,
  };
}

/** Run all four algorithms on the same query for the comparison table. */
export function compareAll(prepared, sources, targets, options = {}) {
  return ["bfs", "dijkstra", "astar", "transfers"].map((mode) =>
    search(prepared, sources, targets, mode, options),
  );
}
