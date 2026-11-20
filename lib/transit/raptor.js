/**
 * Round-based public-transit search over live MTA predictions (RAPTOR style).
 *
 * Round k answers: "what is the earliest I can reach each station using at
 * most k trains?" Keeping every round's best arrival at the destination gives
 * a set of Pareto-optimal options: each extra train change must buy an
 * earlier arrival, or that option is dropped.
 *
 * Reference: Delling, Pajor & Werneck, "Round-Based Public Transit Routing"
 * (Transportation Science, 2015). This version scans individual reported
 * trips rather than grouped routes, because each MTA trip has its own stop
 * list in the realtime feed.
 *
 * It is cross-checked in tests against findJourney() in journey.js, an
 * independent label-setting search: both must agree on the earliest arrival.
 */
import { parentStop } from "./routes.js";

const HORIZON = 3600;

/** Group fresh predictions into trips. Same identity rules as journey.js. */
export function collectTrips(network, snapshots, now) {
  const known = new Set(network.stations.map((s) => s.id));
  const byTrip = new Map();
  for (const snapshot of snapshots) {
    if (
      snapshot.stale ||
      !Number.isFinite(snapshot.timestamp) ||
      now - snapshot.timestamp > 90 ||
      snapshot.timestamp - now > 30
    )
      continue;
    for (const p of snapshot.arrivals || []) {
      const parent = parentStop(p.stopId);
      if (
        !p.trip ||
        !known.has(parent) ||
        !Number.isFinite(p.time) ||
        (p.departure ?? p.time) < now ||
        p.time > now + HORIZON
      )
        continue;
      const key = [snapshot.feed, p.startDate || "", p.route, p.trip].join("|");
      if (!byTrip.has(key)) byTrip.set(key, []);
      byTrip.get(key).push({ ...p, parent, key });
    }
  }
  const trips = [];
  for (const [key, stops] of byTrip) {
    stops.sort((a, b) => (a.sequence ?? a.time) - (b.sequence ?? b.time));
    const unique = stops.filter(
      (s, i) =>
        !i ||
        s.stopId !== stops[i - 1].stopId ||
        s.sequence !== stops[i - 1].sequence,
    );
    if (unique.length < 2) continue;
    trips.push({
      key,
      route: unique[0].route,
      dest: unique[0].dest || unique[unique.length - 1].stopId,
      stops: unique,
    });
  }
  return trips;
}

/** Directed walking links from the GTFS transfer table, minimum two minutes. */
export function transferTables(network) {
  const known = new Set(network.stations.map((s) => s.id));
  const links = new Map(),
    selfTimes = new Map();
  for (const t of network.transfers || []) {
    if (!known.has(t.from) || !known.has(t.to)) continue;
    const seconds = Math.max(120, Number(t.seconds) || 180);
    if (t.from === t.to) {
      selfTimes.set(t.from, seconds);
      continue;
    }
    if (!links.has(t.from)) links.set(t.from, []);
    links.get(t.from).push({ to: t.to, seconds });
  }
  return { links, selfTimes };
}

/**
 * @param network   map-data.json shape: { stations, complexes, transfers }
 * @param snapshots decoded feeds ({ feed, timestamp, arrivals, stale })
 * @param query     {
 *   from, to        station IDs (platform groups)
 *   now             unix seconds
 *   boardingSeconds time to reach the first platform (60–1800)
 *   scope           "platform" (exact platform group) or "complex" (any
 *                   platform in the same station complex, for both ends)
 *   allowed         optional Set of station IDs usable for boarding,
 *                   changing trains and leaving (step-free mode)
 *   maxRounds       most trains in one journey (default 5)
 * }
 */
export function planTrips(network, snapshots, query) {
  const started = Date.now();
  const now = query.now ?? Math.floor(Date.now() / 1000);
  const boardingSeconds = Math.max(
    60,
    Math.min(1800, Number(query.boardingSeconds) || 180),
  );
  const maxRounds = Math.max(1, Math.min(12, query.maxRounds || 5));
  const scope = query.scope === "complex" ? "complex" : "platform";
  const stationById = new Map(network.stations.map((s) => [s.id, s]));
  const fromStation = stationById.get(query.from),
    toStation = stationById.get(query.to);
  if (!fromStation || !toStation) throw new Error("Choose two valid stations.");
  const members = (s) =>
    scope === "complex" && s.complex
      ? network.stations.filter((x) => x.complex === s.complex).map((x) => x.id)
      : [s.id];
  const origins = members(fromStation),
    destinations = new Set(members(toStation));
  const allowed = query.allowed || null;
  const ok = (id) => !allowed || allowed.has(id);
  const stats = {
    rounds: 0,
    tripsScanned: 0,
    stopEventsScanned: 0,
    stationsReached: 0,
    trips: 0,
  };
  const base = { stats, origins, destinations: [...destinations] };
  if (origins.some((id) => destinations.has(id)))
    return {
      ...base,
      found: true,
      sameStation: true,
      options: [],
      legs: [],
      arrival: now,
      departure: now,
      transfers: 0,
    };
  if (allowed && (!origins.some(ok) || ![...destinations].some(ok)))
    return { ...base, found: false, reason: "not-step-free", options: [], legs: [] };

  const trips = collectTrips(network, snapshots, now);
  stats.trips = trips.length;
  const boarding = new Map();
  trips.forEach((trip, t) => {
    for (let i = 0; i < trip.stops.length - 1; i++) {
      const p = trip.stops[i].parent;
      if (!boarding.has(p)) boarding.set(p, []);
      boarding.get(p).push({ t, i });
    }
  });
  const { links, selfTimes } = transferTables(network);
  // Shortest walks inside a station complex. Step-free mode only walks
  // through stations that are themselves usable.
  const walkCache = new Map();
  function walks(start) {
    if (walkCache.has(start)) return walkCache.get(start);
    const best = new Map([[start, 0]]),
      queue = [[0, start]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, id] = queue.shift();
      if (d !== best.get(id)) continue;
      for (const e of links.get(id) || []) {
        if (!ok(e.to)) continue;
        const nd = d + e.seconds;
        if (nd < (best.get(e.to) ?? Infinity)) {
          best.set(e.to, nd);
          queue.push([nd, e.to]);
        }
      }
    }
    walkCache.set(start, best);
    return best;
  }

  // ready[k]: when you can board at a station having used k trains.
  // arrive[k]: when train k drops you at a station.
  const ready = [new Map()],
    readyFrom = [new Map()],
    arrive = [new Map()],
    arriveFrom = [new Map()];
  const bestReady = new Map(),
    bestArrive = new Map();
  let marked = new Set();
  for (const o of origins) {
    if (!ok(o)) continue;
    for (const [id, seconds] of walks(o)) {
      const t = now + boardingSeconds + seconds;
      if (t < (ready[0].get(id) ?? Infinity)) {
        ready[0].set(id, t);
        readyFrom[0].set(id, { origin: o, seconds });
        bestReady.set(id, t);
        marked.add(id);
      }
    }
  }
  // How many trains could be boarded at all from the starting platforms?
  // Zero explains a "no trip" answer better than a generic message.
  stats.originDepartures = 0;
  for (const [id, at] of ready[0])
    for (const { t, i } of boarding.get(id) || []) {
      const first = trips[t].stops[i];
      if ((first.departure ?? first.time) >= at) stats.originDepartures++;
    }
  // Walking from one platform group to the destination's needs no train.
  const destBest = [Infinity],
    destFrom = [null];
  for (const o of origins) {
    if (!ok(o)) continue;
    for (const [id, seconds] of walks(o))
      if (destinations.has(id) && now + seconds < destBest[0]) {
        destBest[0] = now + seconds;
        destFrom[0] = { walkOnly: true, origin: o, to: id, seconds };
      }
  }

  for (let k = 1; k <= maxRounds && marked.size; k++) {
    stats.rounds = k;
    ready[k] = new Map();
    readyFrom[k] = new Map();
    arrive[k] = new Map();
    arriveFrom[k] = new Map();
    destBest[k] = destBest[k - 1];
    destFrom[k] = destFrom[k - 1];
    const target = () => destBest[k];
    // Phase 1: which trips can be boarded, and from which stop indexes?
    const candidates = new Map();
    for (const s of marked) {
      const at = ready[k - 1].get(s);
      if (at === undefined) continue;
      for (const { t, i } of boarding.get(s) || []) {
        const first = trips[t].stops[i],
          departure = first.departure ?? first.time;
        if (
          departure < at ||
          departure < first.time ||
          departure > now + HORIZON ||
          departure >= target()
        )
          continue;
        if (!candidates.has(t)) candidates.set(t, []);
        candidates.get(t).push(i);
      }
    }
    // Phase 2: ride each trip forward once per contiguous valid run.
    const improved = new Set();
    for (const [t, indexes] of candidates) {
      const trip = trips[t];
      indexes.sort((a, b) => a - b);
      let reach = -1;
      for (const i of indexes) {
        if (i < reach) continue;
        stats.tripsScanned++;
        const first = trip.stops[i],
          departure = first.departure ?? first.time;
        let previous = first,
          j = i + 1;
        for (; j < trip.stops.length; j++) {
          const stop = trip.stops[j];
          stats.stopEventsScanned++;
          // Never turn malformed, decreasing predictions into a shortcut.
          if (
            stop.time < (previous.departure ?? previous.time) ||
            stop.time < departure
          )
            break;
          previous = stop;
          if (stop.time >= target()) continue;
          if (stop.time < (bestArrive.get(stop.parent) ?? Infinity)) {
            bestArrive.set(stop.parent, stop.time);
            arrive[k].set(stop.parent, stop.time);
            arriveFrom[k].set(stop.parent, { t, i, j });
            improved.add(stop.parent);
          }
        }
        reach = j;
      }
    }
    // Phase 3: leave the train, reach the destination or a new platform.
    const next = new Set();
    for (const s of improved) {
      const at = arrive[k].get(s);
      if (destinations.has(s) && ok(s) && at < destBest[k]) {
        destBest[k] = at;
        destFrom[k] = { station: s, round: k, seconds: 0, to: s };
      }
      if (!ok(s)) continue;
      for (const [id, seconds] of walks(s)) {
        if (destinations.has(id) && id !== s && at + seconds < destBest[k]) {
          destBest[k] = at + seconds;
          destFrom[k] = { station: s, round: k, seconds, to: id };
        }
        const change = id === s ? (selfTimes.get(s) ?? 180) : seconds;
        const t = at + change;
        if (t >= (bestReady.get(id) ?? Infinity) || t > now + HORIZON) continue;
        bestReady.set(id, t);
        ready[k].set(id, t);
        readyFrom[k].set(id, { station: s, seconds: change });
        next.add(id);
      }
    }
    marked = next;
  }
  stats.stationsReached = bestArrive.size;
  stats.ms = Date.now() - started;

  function rebuild(k) {
    const end = destFrom[k];
    if (!end) return null;
    if (end.walkOnly)
      return {
        found: true,
        walkOnly: true,
        legs: [{ kind: "transfer", from: end.origin, to: end.to, seconds: end.seconds }],
        arrival: now + end.seconds,
        departure: now,
        transfers: 0,
      };
    const legs = [];
    if (end.to !== end.station)
      legs.push({ kind: "transfer", from: end.station, to: end.to, seconds: end.seconds });
    let round = end.round,
      station = end.station;
    while (round > 0) {
      const ptr = arriveFrom[round].get(station);
      const trip = trips[ptr.t],
        first = trip.stops[ptr.i],
        last = trip.stops[ptr.j];
      legs.push({
        kind: "ride",
        route: trip.route,
        trip: trip.key,
        from: first.parent,
        to: last.parent,
        fromStop: first.stopId,
        toStop: last.stopId,
        dest: trip.dest,
        departure: first.departure ?? first.time,
        arrival: last.time,
        stops: trip.stops.slice(ptr.i, ptr.j + 1).map((p) => p.parent),
      });
      const board = first.parent,
        prev = readyFrom[round - 1].get(board);
      if (round - 1 === 0) {
        if (prev.origin !== board)
          legs.push({ kind: "transfer", from: prev.origin, to: board, seconds: prev.seconds });
        break;
      }
      legs.push({ kind: "transfer", from: prev.station, to: board, seconds: prev.seconds });
      station = prev.station;
      round--;
    }
    legs.reverse();
    const rides = legs.filter((l) => l.kind === "ride");
    return {
      found: true,
      legs,
      arrival: destBest[k],
      departure: rides[0]?.departure ?? now,
      transfers: Math.max(0, rides.length - 1),
    };
  }

  // Pareto set: keep a round only if it arrives strictly earlier.
  const options = [];
  let previous = Infinity;
  for (let k = 0; k < destBest.length; k++) {
    if (destBest[k] < previous) {
      const option = rebuild(k);
      if (option) {
        options.push(option);
        previous = destBest[k];
      }
    }
  }
  if (!options.length)
    return { ...base, found: false, options: [], legs: [] };
  // Fastest first; the others trade a later arrival for fewer changes.
  options.reverse();
  return { ...base, ...options[0], options };
}
