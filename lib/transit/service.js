import { decodeFeed, feedUrl, feeds, fields, MTA_BASE } from "./feed.js";
import { tracker } from "./reliability.js";
import { buildGraph } from "./graph.js";
import {
  indexEquipment,
  normalizeOutages,
  stepFreeStations,
} from "./elevators.js";
// Stored on globalThis so every separately bundled API route in one Node
// process shares one cache (and one upstream request per feed).
const store = (globalThis.__streetcodeCache ??= {
    cache: new Map(),
    pending: new Map(),
  }),
  cache = store.cache,
  pending = store.pending;
const BASE = MTA_BASE;
export const alertUrls = {
  json: BASE + "camsys%2Fall-alerts.json",
  protobuf: BASE + "camsys%2Fsubway-alerts",
};
export const elevatorUrls = {
  equipment: BASE + "nyct%2Fnyct_ene_equipments.json",
  outages: BASE + "nyct%2Fnyct_ene.json",
};
/**
 * Serve a fresh value for `ttl` ms, coalesce concurrent callers, and fall
 * back to the last good value (marked stale) for `staleFor` ms if the
 * upstream request fails.
 */
export async function cached(
  key,
  loader,
  now = Date.now(),
  ttl = 25000,
  staleFor = 300000,
) {
  const old = cache.get(key);
  if (old && now - old.fetchedAt < ttl) return { ...old, stale: false };
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    try {
      const data = await loader();
      const value = { ...data, fetchedAt: Date.now() };
      cache.set(key, value);
      return { ...value, stale: false };
    } catch (e) {
      if (old && now - old.fetchedAt < staleFor)
        return {
          ...old,
          stale: true,
          error: "MTA refresh failed. Showing the last successful response.",
        };
      throw e;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, promise);
  return promise;
}
async function read(url, binary = false) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: binary ? "application/x-protobuf" : "application/json" },
  });
  if (!response.ok) throw Error("MTA HTTP " + response.status);
  const declared = Number(response.headers.get("content-length"));
  if (declared > 8000000) throw Error("Feed too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 8000000) throw Error("Feed too large");
  return binary ? bytes : JSON.parse(new TextDecoder().decode(bytes));
}
/** Raw protobuf bytes, shared by the decoder below and the lab inspector. */
export async function rawFeed(id) {
  if (!Object.hasOwn(feeds, id)) throw Error("Unknown feed");
  return cached("raw:" + id, async () => ({
    bytes: await read(feedUrl(id), true),
  }));
}
export async function arrivals(id) {
  if (!Object.hasOwn(feeds, id)) throw Error("Unknown feed");
  return cached("train:" + id, async () => {
    const raw = await rawFeed(id);
    if (raw.stale) throw Error("MTA refresh failed");
    const decoded = decodeFeed(raw.bytes);
    try {
      tracker.observe(id, decoded);
    } catch {
      /* Accuracy tracking must never break arrivals. */
    }
    return { ...decoded, source: feedUrl(id), feed: id };
  });
}
/** Every feed at once, keeping only the ones that are fresh. */
export async function allArrivals(now = Math.floor(Date.now() / 1000)) {
  const ids = Object.keys(feeds);
  const outcomes = await Promise.allSettled(ids.map((id) => arrivals(id)));
  const available = [],
    missing = [];
  outcomes.forEach((outcome, i) => {
    if (
      outcome.status === "fulfilled" &&
      !outcome.value.stale &&
      now - outcome.value.timestamp <= 90 &&
      outcome.value.timestamp - now <= 30
    )
      available.push(outcome.value);
    else missing.push(ids[i]);
  });
  return { available, missing };
}
/** A whole-network graph learned from current predictions (cached 60 s). */
export async function liveGraph(network) {
  return cached(
    "graph",
    async () => {
      const now = Math.floor(Date.now() / 1000);
      const { available, missing } = await allArrivals(now);
      if (!available.length) throw Error("No live feeds available");
      return {
        ...buildGraph(network, available, now),
        feedsUsed: available.map((s) => s.feed),
        missingFeeds: missing,
      };
    },
    Date.now(),
    60000,
    600000,
  );
}
/** Elevator list (changes rarely: 6 h) and outages (60 s). */
export async function elevatorStatus() {
  const equipment = await cached(
    "elevators:equipment",
    async () => ({ list: await read(elevatorUrls.equipment) }),
    Date.now(),
    6 * 3600 * 1000,
    48 * 3600 * 1000,
  );
  const outages = await cached(
    "elevators:outages",
    async () => ({ list: await read(elevatorUrls.outages) }),
    Date.now(),
    60000,
    900000,
  );
  const index = (store.elevatorIndex =
    store.elevatorIndexSource === equipment.fetchedAt
      ? store.elevatorIndex
      : indexEquipment(equipment.list));
  store.elevatorIndexSource = equipment.fetchedAt;
  const current = normalizeOutages(outages.list);
  return {
    index,
    outages: current,
    allowed: stepFreeStations(index, current),
    fetchedAt: outages.fetchedAt,
    stale: !!(equipment.stale || outages.stale),
  };
}
const text = (t) =>
  t?.translation?.find((t) => t.language === "en")?.text ||
  t?.translation?.find((t) => !t.language || t.language === "en-US")?.text ||
  "";
export function normalizeAlerts(
  data,
  now = Math.floor(Date.now() / 1000),
  subwayOnly = false,
) {
  if (!data?.header?.timestamp || !Array.isArray(data.entity))
    throw Error("Invalid alert feed");
  return {
    timestamp: Number(data.header.timestamp),
    alerts: data.entity
      .filter((e) => !e.is_deleted && e.alert)
      .flatMap((e) => {
        const a = e.alert,
          entities = a.informed_entity || [];
        if (
          !subwayOnly &&
          !entities.some(
            (x) => x.agency_id === "MTASBWY" || x.agency_id === "MTASIR",
          )
        )
          return [];
        const periods = a.active_period || [],
          active =
            !periods.length ||
            periods.some(
              (p) =>
                (!p.start || Number(p.start) <= now) &&
                (!p.end || Number(p.end) > now),
            );
        const future = periods.filter((p) => Number(p.start) > now);
        if (!active && !future.length) return [];
        return [
          {
            id: e.id,
            title: text(a.header_text) || "Service advisory",
            description: text(a.description_text),
            routes: [
              ...new Set(entities.map((x) => x.route_id).filter(Boolean)),
            ],
            stops: [...new Set(entities.map((x) => x.stop_id).filter(Boolean))],
            active,
            start: future.length
              ? Math.min(...future.map((x) => Number(x.start)))
              : null,
            type:
              a["transit_realtime.mercury_alert"]?.alert_type ||
              "Service advisory",
          },
        ];
      }),
  };
}
const first = (m, n) => m.get(n)?.[0];
const nested = (m, n) =>
  first(m, n) instanceof Uint8Array ? fields(first(m, n)) : new Map();
const str = (m, n) =>
  first(m, n) instanceof Uint8Array
    ? new TextDecoder().decode(first(m, n))
    : "";
const num = (m, n) =>
  typeof first(m, n) === "bigint" ? Number(first(m, n)) : undefined;
function translated(m, n) {
  return {
    translation: (nested(m, n).get(1) || []).map((b) => {
      const t = fields(b);
      return { text: str(t, 1), language: str(t, 2) };
    }),
  };
}
export function decodeAlerts(bytes) {
  const root = fields(bytes);
  return {
    header: { timestamp: num(nested(root, 1), 3) },
    entity: (root.get(2) || []).map((b) => {
      const e = fields(b),
        a = nested(e, 5);
      return {
        id: str(e, 1),
        is_deleted: num(e, 2) === 1,
        alert: a.size
          ? {
              active_period: (a.get(1) || []).map((b) => {
                const p = fields(b);
                return { start: num(p, 1), end: num(p, 2) };
              }),
              informed_entity: (a.get(5) || []).map((b) => {
                const i = fields(b);
                return {
                  agency_id: str(i, 1),
                  route_id: str(i, 2),
                  stop_id: str(i, 5),
                };
              }),
              header_text: translated(a, 10),
              description_text: translated(a, 11),
            }
          : null,
      };
    }),
  };
}
export async function alerts(format = "json") {
  if (!Object.hasOwn(alertUrls, format)) throw Error("Unknown format");
  return cached("alerts:" + format, async () => {
    let data,
      source = alertUrls[format],
      fallback = false;
    try {
      data =
        format === "json"
          ? await read(source)
          : decodeAlerts(await read(source, true));
    } catch (e) {
      if (format !== "json") throw e;
      source = alertUrls.protobuf;
      data = decodeAlerts(await read(source, true));
      fallback = true;
    }
    return {
      ...normalizeAlerts(
        data,
        Math.floor(Date.now() / 1000),
        format === "protobuf" || fallback,
      ),
      source,
      fallback,
    };
  });
}
