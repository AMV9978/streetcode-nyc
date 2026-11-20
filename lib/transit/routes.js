/** Small helpers shared by the server routes, the planner and the tests. */

/** "6X" → "6", "7X" → "7", "FX" → "F", "SIR" → "SI". Shuttles keep their IDs. */
export function baseRoute(route) {
  const r = String(route || "").toUpperCase();
  if (r === "SIR") return "SI";
  return /^[0-9A-Z]X$/.test(r) ? r[0] : r;
}

/** "L03N" → "L03". GTFS platform stop IDs end in a direction letter. */
export const parentStop = (stopId) => String(stopId || "").replace(/[NS]$/, "");

/** True when two route lists share at least one line, ignoring express variants. */
export function sharesRoute(a = [], b = []) {
  const set = new Set(a.map(baseRoute));
  return b.some((r) => set.has(baseRoute(r)));
}

/**
 * Decide how an alert relates to a set of stations on a set of lines.
 *  - "station": the alert names one of these stations
 *  - "line":    the alert is on one of these lines but names no stations
 *  - "elsewhere": the alert is on these lines but only at other stations
 *  - null:      the alert is unrelated
 * Alerts with no routes and no stops apply to the whole system ("line").
 */
export function alertRelevance(alert, routes = [], stationIds = []) {
  const alertRoutes = alert.routes || [],
    alertStops = (alert.stops || []).map(parentStop);
  const onLine = !alertRoutes.length || sharesRoute(routes, alertRoutes);
  const stations = new Set(stationIds.map(parentStop));
  const atStation = alertStops.some((s) => stations.has(s));
  if (atStation) return "station";
  if (!onLine) return null;
  if (!alertStops.length) return "line";
  return "elsewhere";
}
