import { MinHeap } from "./heap.js";
export const TRANSFER_MINUTES = 4;
/** State must include incoming line: a cheaper arrival on one line need not
 * be the cheapest way to continue on another. All costs must be nonnegative.
 * A preference penalty changes ranking, not the displayed journey duration.
 */
export function route(network, origin, destination, options = {}) {
  const { stations, edges } = network;
  const { scenario = {}, stepFree = false, transferPenalty = 0 } = options;
  if (!Number.isFinite(transferPenalty) || transferPenalty < 0)
    throw new Error("Invalid transfer penalty");
  const stationMap = new Map(stations.map((s) => [s.id, s]));
  if (!stationMap.has(origin) || !stationMap.has(destination))
    throw new Error("Unknown station");
  const closed = new Set(scenario.closedStations || []),
    inaccessible = new Set(scenario.inaccessible || []);
  const permitted = (id) =>
    !closed.has(id) &&
    (!stepFree || (stationMap.get(id).stepFree && !inaccessible.has(id)));
  const trace = [];
  const unavailable = () => ({
    found: false,
    reason:
      "No route satisfies the selected conditions in this reduced network.",
    trace,
  });
  if (!permitted(origin) || !permitted(destination)) return unavailable();
  const adj = new Map(stations.map((s) => [s.id, []]));
  for (const e of edges) {
    if (!stationMap.has(e.from) || !stationMap.has(e.to))
      throw new Error("Invalid edge endpoint");
    const delay = scenario.delays?.[e.line] ?? 0;
    if (
      !Number.isFinite(e.minutes) ||
      e.minutes < 0 ||
      !Number.isFinite(delay) ||
      delay < 0
    )
      throw new Error("Invalid edge cost");
    if (
      (scenario.closedLines || []).includes(e.line) ||
      !permitted(e.from) ||
      !permitted(e.to)
    )
      continue;
    adj.get(e.from).push({ ...e, to: e.to, delay });
    adj.get(e.to).push({ ...e, from: e.to, to: e.from, delay });
  }
  const key = (id, line) => JSON.stringify([id, line]);
  const start = key(origin, ""),
    distance = new Map([[start, 0]]),
    parents = new Map(),
    heap = new MinHeap();
  heap.push({ id: origin, line: "", cost: 0, key: start });
  let final;
  while (heap.size) {
    const current = heap.pop();
    if (current.cost !== distance.get(current.key)) continue;
    const event = {
      station: current.id,
      line: current.line || "Start",
      cost: current.cost,
      relaxed: [],
    };
    trace.push(event);
    if (current.id === destination) {
      final = current;
      break;
    }
    for (const e of adj.get(current.id)) {
      const transfer = Boolean(current.line && current.line !== e.line);
      const travel = e.minutes + e.delay + (transfer ? TRANSFER_MINUTES : 0);
      const cost = current.cost + travel + (transfer ? transferPenalty : 0),
        next = key(e.to, e.line);
      if (cost < (distance.get(next) ?? Infinity)) {
        distance.set(next, cost);
        parents.set(next, { previous: current.key, edge: e, transfer, travel });
        heap.push({ id: e.to, line: e.line, cost, key: next });
        event.relaxed.push({ station: e.to, line: e.line, cost });
      }
    }
  }
  if (!final) return unavailable();
  const legs = [];
  let cursor = final.key;
  while (cursor !== start) {
    const p = parents.get(cursor);
    legs.push({ ...p.edge, transfer: p.transfer, travel: p.travel });
    cursor = p.previous;
  }
  legs.reverse();
  return {
    found: true,
    score: final.cost,
    minutes: legs.reduce((n, e) => n + e.travel, 0),
    transfers: legs.filter((e) => e.transfer).length,
    delay: legs.reduce((n, e) => n + e.delay, 0),
    path: [origin, ...legs.map((e) => e.to)],
    legs,
    trace,
  };
}
/** Reprice an already-selected itinerary without searching for a new path. */
export function reprice(
  network,
  journey,
  { scenario = {}, stepFree = false, transferPenalty = 0 } = {},
) {
  if (!journey.found) return null;
  const byId = new Map(network.stations.map((s) => [s.id, s]));
  if (
    journey.path.some(
      (id) =>
        (scenario.closedStations || []).includes(id) ||
        (stepFree &&
          (!byId.get(id).stepFree ||
            (scenario.inaccessible || []).includes(id))),
    )
  )
    return null;
  if (journey.legs.some((e) => (scenario.closedLines || []).includes(e.line)))
    return null;
  const minutes = journey.legs.reduce(
    (n, e) =>
      n +
      e.minutes +
      (scenario.delays?.[e.line] || 0) +
      (e.transfer ? TRANSFER_MINUTES : 0),
    0,
  );
  return { minutes, score: minutes + journey.transfers * transferPenalty };
}
