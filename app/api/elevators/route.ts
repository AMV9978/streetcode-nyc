import { elevatorStatus } from "../../../lib/transit/service.js";
import { stationAccess } from "../../../lib/transit/elevators.js";
import network from "../../../lib/transit/map-data.json";

/** GET /api/elevators?station=L06 — elevators and outages at a station complex. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("station") || "";
  const station = network.stations.find((s) => s.id === id);
  if (!station)
    return Response.json({ error: "Unknown station" }, { status: 400 });
  const members = network.stations
    .filter((s) => s.complex === station.complex)
    .map((s) => s.id);
  try {
    const status = await elevatorStatus();
    const elevators = stationAccess(status.index, status.outages, members);
    return Response.json(
      {
        station: id,
        stations: members,
        // This platform group specifically (e.g. the L platforms at Union Sq),
        // and whether any platform in the complex is reachable step-free.
        stepFree: status.allowed.has(id),
        complexStepFree: members.some((m) => status.allowed.has(m)),
        elevators,
        stale: status.stale,
        checkedAt: Math.floor(status.fetchedAt / 1000),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "MTA elevator status is unavailable right now." },
      { status: 502 },
    );
  }
}
