/**
 * MTA elevator data, matched to GTFS stations.
 *
 *  - nyct_ene_equipments.json lists every elevator and escalator, with the
 *    GTFS stop IDs it serves (for example "A31/L01").
 *  - nyct_ene.json lists current and upcoming outages by equipment number.
 *
 * "Step-free" here is an approximation for route planning: a station counts
 * when MTA lists at least one ADA elevator for it and none of its
 * non-redundant ADA elevators is out of service right now. It does not model
 * which direction or entrance each elevator serves, and it cannot see
 * stations that are accessible by ramp only.
 */

/** Parse "12/16/2026 10:00:00 PM" as New York local time → unix seconds. */
export function parseEasternTime(text) {
  const m = String(text || "").match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? ?(AM|PM)$/i,
  );
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[7].toUpperCase() === "PM") hour += 12;
  const asUtc = Date.UTC(+m[3], +m[1] - 1, +m[2], hour, +m[5], +(m[6] || 0));
  // Find New York's UTC offset at that moment (handles daylight saving).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(asUtc));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offset = shown - asUtc; // e.g. -5 h in winter
  return Math.round((asUtc - offset) / 1000);
}

/** Keep elevators only, keyed by the GTFS station IDs they serve. */
export function indexEquipment(list) {
  const byStation = new Map(),
    byId = new Map();
  for (const e of Array.isArray(list) ? list : []) {
    if (e?.equipmenttype !== "EL" || e.isactive === "N") continue;
    const item = {
      id: String(e.equipmentno || ""),
      serving: e.shortdescription || e.serving || "",
      ada: e.ADA === "Y",
      redundant: Number(e.redundant) === 1,
      lines: e.linesservedbyelevator || e.trainno || "",
      alternative: e.alternativeroute || "",
      stations: String(e.elevatorsgtfsstopid || "")
        .split(/[\/,; ]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    };
    if (!item.id || !item.stations.length) continue;
    byId.set(item.id, item);
    for (const s of item.stations) {
      if (!byStation.has(s)) byStation.set(s, []);
      byStation.get(s).push(item);
    }
  }
  return { byStation, byId };
}

export function normalizeOutages(list, now = Math.floor(Date.now() / 1000)) {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    if (o?.equipmenttype && o.equipmenttype !== "EL") continue;
    const start = parseEasternTime(o.outagedate),
      until = parseEasternTime(o.estimatedreturntoservice);
    const upcoming = o.isupcomingoutage === "Y" || (start !== null && start > now);
    if (until !== null && until < now) continue; // already back in service
    out.push({
      equipment: String(o.equipment || ""),
      station: o.station || "",
      reason: o.reason || "",
      start,
      until,
      upcoming,
      maintenance: o.ismaintenanceoutage === "Y",
    });
  }
  return out;
}

/** Station IDs that are usable step-free right now (see caveat above). */
export function stepFreeStations(index, outages) {
  const down = new Set(outages.filter((o) => !o.upcoming).map((o) => o.equipment));
  const allowed = new Set();
  for (const [station, elevators] of index.byStation) {
    const ada = elevators.filter((e) => e.ada);
    if (!ada.length) continue;
    if (ada.some((e) => down.has(e.id) && !e.redundant)) continue;
    allowed.add(station);
  }
  return allowed;
}

// Out of service now first, then planned outages, then working elevators.
const rank = (e) => (e.outage ? (e.outage.upcoming ? 1 : 2) : 0);

/** What one station looks like, for the arrivals panel. */
export function stationAccess(index, outages, stationIds) {
  const ids = new Set(stationIds);
  const seen = new Set(),
    elevators = [];
  for (const id of ids)
    for (const e of index.byStation.get(id) || [])
      if (!seen.has(e.id)) {
        seen.add(e.id);
        elevators.push(e);
      }
  const status = new Map(outages.map((o) => [o.equipment, o]));
  return elevators
    .map((e) => ({
      id: e.id,
      serving: e.serving,
      ada: e.ada,
      redundant: e.redundant,
      outage: status.get(e.id) || null,
      alternative: status.has(e.id) ? e.alternative.slice(0, 1200) : "",
    }))
    .sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
}
