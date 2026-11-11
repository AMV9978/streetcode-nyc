/** Great-circle proximity only: never a walking route or entrance distance. */
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function nearbyStations(
  stations,
  point,
  { radius = 1500, limit = 6, excludeComplex = "" } = {},
) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon))
    return [];
  const byComplex = new Map();
  for (const s of stations) {
    if (s.complex === excludeComplex) continue;
    const meters = distanceMeters(point, s);
    if (meters > radius) continue;
    const key = s.complex || s.id;
    const previous = byComplex.get(key);
    if (!previous || meters < previous.meters)
      byComplex.set(key, { ...s, meters });
  }
  return [...byComplex.values()]
    .sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id))
    .slice(0, limit);
}
