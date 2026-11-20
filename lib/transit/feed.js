/** Small read-only protobuf inspector for the GTFS-RT fields used below.
 * This is not a full GTFS validator. Unknown length/varint/fixed fields are skipped.
 * Field numbers: official google/transit/gtfs-realtime.proto, version 2.
 */
export function fields(bytes) {
  const out = new Map();
  let p = 0;
  const varint = () => {
    let n = 0n,
      shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (p >= bytes.length) throw Error("Truncated varint");
      const b = bytes[p++];
      n |= BigInt(b & 127) << shift;
      if (!(b & 128)) return n;
      shift += 7n;
    }
    throw Error("Invalid varint");
  };
  while (p < bytes.length) {
    const tag = Number(varint()),
      id = tag >>> 3,
      wire = tag & 7;
    if (id === 0) throw Error("Invalid field");
    let value;
    if (wire === 0) {
      value = varint();
    } else if (wire === 2) {
      const length = Number(varint());
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > bytes.length - p
      )
        throw Error("Truncated message");
      value = bytes.subarray(p, p + length);
      p += length;
    } else if (wire === 1 || wire === 5) {
      p += wire === 1 ? 8 : 4;
      if (p > bytes.length) throw Error("Truncated fixed field");
      continue;
    } else throw Error("Unsupported protobuf wire type");
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(value);
  }
  return out;
}
const first = (m, id) => m.get(id)?.[0],
  nested = (m, id) => {
    const b = first(m, id);
    return b instanceof Uint8Array ? fields(b) : new Map();
  };
const str = (m, id) => {
  const b = first(m, id);
  return b instanceof Uint8Array ? new TextDecoder().decode(b) : "";
};
const num = (m, id) => {
  const b = first(m, id);
  return typeof b === "bigint" && b <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(b)
    : null;
};
export function decodeFeed(bytes, now = Math.floor(Date.now() / 1000)) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 4_000_000)
    throw Error("Invalid or oversized feed");
  const root = fields(bytes),
    header = nested(root, 1),
    version = str(header, 1),
    timestamp = num(header, 3);
  if (!["1.0", "2.0"].includes(version) || !timestamp)
    throw Error("Missing supported GTFS header");
  if (num(header, 2) === 1) throw Error("Differential feeds are not supported");
  let trips = 0;
  const arrivals = [];
  for (const raw of root.get(2) || []) {
    const entity = fields(raw);
    if (num(entity, 2) === 1) continue;
    const update = nested(entity, 3);
    if (!update.size) continue;
    const descriptor = nested(update, 1),
      relationship = num(descriptor, 4);
    if (relationship === 3 || relationship === 7) continue;
    trips++;
    const route = str(descriptor, 5) || "Unknown",
      trip = str(descriptor, 1),
      startDate = str(descriptor, 3);
    const stops = [];
    let order = 0;
    for (const rawStop of update.get(2) || []) {
      order++;
      const stop = fields(rawStop),
        relationship = num(stop, 5);
      if (relationship === 1 || relationship === 2) continue;
      const stopId = str(stop, 4);
      if (!stopId) continue;
      stops.push({
        stopId,
        arrival: num(nested(stop, 2), 2),
        departure: num(nested(stop, 3), 2),
        sequence: num(stop, 1) ?? order,
      });
    }
    // The terminal is read before the one-hour window is applied, so a long
    // trip still shows its real destination ("toward 8 Av"), not the last stop
    // that happens to fall inside the window.
    const dest = stops.length ? stops[stops.length - 1].stopId : "";
    for (const s of stops) {
      const time = s.arrival ?? s.departure;
      if (time === null) continue;
      const departure = s.departure ?? time;
      // Keep a train that is dwelling at the platform right now: it arrived a
      // moment ago but has not left yet, so it can still be boarded.
      if (departure >= now && time <= now + 3600)
        arrivals.push({
          route,
          trip,
          stopId: s.stopId,
          time,
          departure,
          sequence: s.sequence,
          startDate,
          dest,
        });
    }
  }
  arrivals.sort((a, b) => a.time - b.time || a.stopId.localeCompare(b.stopId));
  return { version, timestamp, trips, ageSeconds: now - timestamp, arrivals };
}
export const feeds = {
  si: { name: "Staten Island Railway", path: "gtfs-si" },
  numbered: { name: "1 / 2 / 3 / 4 / 5 / 6 / 7", path: "gtfs" },
  ace: { name: "A / C / E", path: "gtfs-ace" },
  bdfm: { name: "B / D / F / M", path: "gtfs-bdfm" },
  g: { name: "G", path: "gtfs-g" },
  jz: { name: "J / Z", path: "gtfs-jz" },
  l: { name: "L", path: "gtfs-l" },
  nqrw: { name: "N / Q / R / W", path: "gtfs-nqrw" },
};
/** Official MTA endpoint. MTA_FEED_BASE lets tests point at a local mock. */
export const MTA_BASE =
  globalThis.process?.env?.MTA_FEED_BASE ||
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";
export const feedUrl = (id) => {
  if (!Object.hasOwn(feeds, id)) throw Error("Unknown feed");
  return `${MTA_BASE}nyct%2F${feeds[id].path}`;
};
