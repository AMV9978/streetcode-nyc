import {
  alerts,
  allArrivals,
  elevatorStatus,
  liveGraph,
} from "../../../lib/transit/service.js";
import { planTrips } from "../../../lib/transit/raptor.js";
import { prepare, search } from "../../../lib/transit/graph.js";
import { alertRelevance } from "../../../lib/transit/routes.js";
import { limit } from "../../../lib/http/limit.js";
import network from "../../../lib/transit/map-data.json";

type Leg = {
  kind: string;
  route?: string;
  from: string;
  to: string;
  stops?: string[];
};

const complexOf = new Map(network.stations.map((s) => [s.id, s.complex]));
const onlyStatenIsland = (id: string) => {
  const c = complexOf.get(id);
  return network.stations
    .filter((s) => s.complex === c)
    .every((s) => s.routes.every((r) => r === "SI"));
};

/**
 * GET /api/journey?from=L03&to=414&readyIn=3[&scope=complex][&stepFree=1]
 *
 * scope=complex  start from / arrive at any platform in the station complex
 *                (the default stays "platform" for older clients)
 * stepFree=1     only board, change and leave at stations whose ADA
 *                elevators are all working (approximation; see elevators.js)
 */
export async function GET(request: Request) {
  const blocked = limit(request, "journey", { perMinute: 30, burst: 15 });
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "",
    to = params.get("to") || "";
  if (!complexOf.has(from) || !complexOf.has(to))
    return Response.json(
      { error: "Choose a starting station and destination." },
      { status: 400 },
    );
  const readyIn = Number(params.get("readyIn") ?? 3);
  if (!Number.isInteger(readyIn) || readyIn < 1 || readyIn > 30)
    return Response.json(
      { error: "Choose 1–30 minutes to reach the platform." },
      { status: 400 },
    );
  const scope = params.get("scope") === "complex" ? "complex" : "platform";
  const stepFree = params.get("stepFree") === "1";

  const now = Math.floor(Date.now() / 1000);
  const { available, missing } = await allArrivals(now);
  if (!available.length)
    return Response.json(
      {
        error:
          "Live trip predictions are temporarily unavailable. Please try again.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );

  let allowed: Set<string> | undefined,
    accessAvailable = true;
  if (stepFree) {
    try {
      const status = await elevatorStatus();
      allowed = status.allowed;
      accessAvailable = !status.stale;
    } catch {
      return Response.json(
        {
          error:
            "MTA elevator status is unavailable right now, so a step-free trip can't be checked. Please try again shortly.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const result: any = planTrips(network, available, {
    from,
    to,
    now,
    boardingSeconds: readyIn * 60,
    scope,
    allowed,
  });

  // Explain an empty answer instead of leaving the rider guessing.
  let estimate: any = null;
  if (!result.found) {
    if (!result.reason) {
      if (onlyStatenIsland(from) !== onlyStatenIsland(to))
        result.reason = "ferry";
      else if (result.stats.originDepartures === 0)
        result.reason = "no-departures";
      else result.reason = "beyond-horizon";
    }
    if (result.reason === "beyond-horizon" || result.reason === "no-departures") {
      try {
        const graph = await liveGraph(network);
        const best: any = search(
          prepare(graph, network.stations),
          result.origins,
          result.destinations,
          "dijkstra",
          { allowed },
        );
        if (best.found)
          estimate = {
            minutes: Math.round((readyIn * 60 + best.seconds) / 60),
            transfers: best.transfers,
            routes: best.legs
              .filter((l: Leg) => l.kind === "ride")
              .map((l: Leg) => l.route),
            basis:
              "Typical time from current train speeds and gaps between trains. Not a specific live connection.",
          };
      } catch {
        /* An estimate is a bonus; the answer stands without it. */
      }
    }
  }

  // Advisories: only ones on the lines used AND either line-wide or at a
  // station this trip actually stops at (not every station on the line).
  let advisories: any[] = [],
    alertsAvailable = true;
  try {
    const a = await alerts();
    alertsAvailable = !a.stale && now - a.timestamp <= 180;
    const legs: Leg[] = result.options?.flatMap((o: any) => o.legs) || [];
    const routes = [
      ...new Set(legs.filter((l) => l.kind === "ride").map((l) => l.route!)),
    ];
    const stations = [
      ...new Set(legs.flatMap((l) => [l.from, l.to, ...(l.stops || [])])),
    ];
    if (routes.length)
      advisories = a.alerts
        .filter((x: any) => x.active)
        .map((x: any) => ({ ...x, relevance: alertRelevance(x, routes, stations) }))
        .filter((x: any) => x.relevance === "station" || x.relevance === "line")
        .sort(
          (x: any, y: any) =>
            Number(y.relevance === "station") - Number(x.relevance === "station"),
        );
  } catch {
    alertsAvailable = false;
  }

  return Response.json(
    {
      ...result,
      from,
      to,
      scope,
      stepFree,
      accessAvailable,
      estimate,
      checkedAt: now,
      timestamp: Math.min(...available.map((s) => s.timestamp)),
      missingFeeds: missing,
      feedsChecked: available.length,
      advisories,
      alertsAvailable,
      horizonMinutes: 60,
      boardingBufferSeconds: readyIn * 60,
      transferMinimumSeconds: 120,
      algorithm: "RAPTOR (round-based, Pareto-optimal on arrival time and train changes)",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
