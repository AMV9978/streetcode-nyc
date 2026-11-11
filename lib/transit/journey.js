/** Earliest arrival search over explicit, fresh MTA stop predictions.
 * A ride always stays on one reported trip. Transfers only use the supplied
 * GTFS links. No static timetable times or invented train services are used.
 */
class Queue {
  items = [];
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].ready <= value.ready) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items,
      first = a[0],
      last = a.pop();
    if (a.length && last) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1].ready < a[child].ready)
          child++;
        if (last.ready <= a[child].ready) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

export function findJourney(
  network,
  snapshots,
  from,
  to,
  now = Math.floor(Date.now() / 1000),
  boardingSeconds = 180,
) {
  boardingSeconds = Math.max(
    60,
    Math.min(1800, Number(boardingSeconds) || 180),
  );
  const origins = network.stations.find((s) => s.id === from);
  const destination = network.stations.find((s) => s.id === to);
  if (!origins || !destination) throw new Error("Choose two valid stations.");
  if (from === to)
    return {
      found: true,
      sameStation: true,
      legs: [],
      arrival: now,
      departure: now,
      transfers: 0,
    };
  const known = new Set(network.stations.map((s) => s.id));
  const parent = (id) => id.replace(/[NS]$/, "");
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
      if (
        !p.trip ||
        !known.has(parent(p.stopId)) ||
        !Number.isFinite(p.time) ||
        p.time < now ||
        p.time > now + 3600
      )
        continue;
      const key = [snapshot.feed, p.startDate || "", p.route, p.trip].join("|");
      if (!byTrip.has(key)) byTrip.set(key, []);
      byTrip.get(key).push({ ...p, parent: parent(p.stopId), key });
    }
  }
  const boarding = new Map();
  for (const stops of byTrip.values()) {
    // sequence is the source order, including ties in predicted arrival time.
    stops.sort((a, b) => (a.sequence ?? a.time) - (b.sequence ?? b.time));
    const unique = stops.filter(
      (s, i) =>
        !i ||
        s.stopId !== stops[i - 1].stopId ||
        s.sequence !== stops[i - 1].sequence,
    );
    for (let i = 0; i < unique.length - 1; i++) {
      const p = unique[i];
      if (!boarding.has(p.parent)) boarding.set(p.parent, []);
      boarding.get(p.parent).push({ stops: unique, index: i });
    }
  }
  const links = new Map(),
    selfTimes = new Map();
  for (const t of network.transfers) {
    if (!known.has(t.from) || !known.has(t.to)) continue;
    const seconds = Math.max(120, Number(t.seconds) || 180);
    if (t.from === t.to) {
      selfTimes.set(t.from, seconds);
      continue;
    }
    if (!links.has(t.from)) links.set(t.from, []);
    links.get(t.from).push({ to: t.to, seconds });
  }
  // Transfer complexes sometimes require multiple explicit passageways.
  const walkCache = new Map();
  function walks(start) {
    if (walkCache.has(start)) return walkCache.get(start);
    const best = new Map([[start, 0]]),
      q = new Queue();
    q.push({ id: start, ready: 0 });
    while (q.items.length) {
      const n = q.pop();
      if (n.ready !== best.get(n.id)) continue;
      for (const edge of links.get(n.id) || []) {
        const time = n.ready + edge.seconds;
        if (time < (best.get(edge.to) ?? Infinity)) {
          best.set(edge.to, time);
          q.push({ id: edge.to, ready: time });
        }
      }
    }
    walkCache.set(start, best);
    return best;
  }
  const best = new Map(),
    queue = new Queue();
  for (const [id, seconds] of walks(from)) {
    best.set(id, now + boardingSeconds + seconds);
    queue.push({
      id,
      ready: now + boardingSeconds + seconds,
      legs: id === from ? [] : [{ kind: "transfer", from, to: id, seconds }],
    });
  }
  const initialWalk = walks(from).get(to);
  let answer =
    initialWalk !== undefined
      ? {
          found: true,
          walkOnly: true,
          legs: [{ kind: "transfer", from, to, seconds: initialWalk }],
          arrival: now + initialWalk,
        }
      : null;
  while (queue.items.length) {
    const state = queue.pop();
    if (
      state.ready !== best.get(state.id) ||
      (answer && state.ready >= answer.arrival)
    )
      continue;
    for (const option of boarding.get(state.id) || []) {
      const first = option.stops[option.index],
        departure = first.departure ?? first.time;
      if (
        departure < state.ready ||
        departure < first.time ||
        departure > now + 3600
      )
        continue;
      let previous = first;
      for (let i = option.index + 1; i < option.stops.length; i++) {
        const last = option.stops[i];
        // Never turn malformed, decreasing predictions into a travel shortcut.
        if (
          last.time < (previous.departure ?? previous.time) ||
          last.time < departure
        )
          break;
        previous = last;
        const ride = {
          kind: "ride",
          route: first.route,
          trip: first.key,
          from: first.parent,
          to: last.parent,
          fromStop: first.stopId,
          toStop: last.stopId,
          departure,
          arrival: last.time,
          stops: option.stops.slice(option.index, i + 1).map((p) => p.parent),
        };
        const legs = [...state.legs, ride];
        for (const [target, walkSeconds] of walks(last.parent)) {
          if (
            target === to &&
            (!answer || last.time + walkSeconds < answer.arrival)
          ) {
            answer = {
              found: true,
              legs:
                target === last.parent
                  ? legs
                  : [
                      ...legs,
                      {
                        kind: "transfer",
                        from: last.parent,
                        to: target,
                        seconds: walkSeconds,
                      },
                    ],
              arrival: last.time + walkSeconds,
            };
          }
          const seconds =
            target === last.parent
              ? (selfTimes.get(target) ?? 180)
              : walkSeconds;
          const ready = last.time + seconds;
          if (ready >= (best.get(target) ?? Infinity) || ready > now + 3600)
            continue;
          best.set(target, ready);
          queue.push({
            id: target,
            ready,
            legs: [
              ...legs,
              { kind: "transfer", from: last.parent, to: target, seconds },
            ],
          });
        }
      }
    }
  }
  if (!answer) return { found: false, legs: [] };
  const rides = answer.legs.filter((l) => l.kind === "ride");
  return {
    ...answer,
    departure: rides[0]?.departure ?? now,
    transfers: Math.max(0, rides.length - 1),
  };
}
