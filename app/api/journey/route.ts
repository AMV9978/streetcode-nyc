import { arrivals, alerts } from "../../../lib/transit/service.js";
import { feeds } from "../../../lib/transit/feed.js";
import { findJourney } from "../../../lib/transit/journey.js";
import network from "../../../lib/transit/map-data.json";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from"),
    to = params.get("to");
  if (
    !network.stations.some((s) => s.id === from) ||
    !network.stations.some((s) => s.id === to)
  ) {
    return Response.json(
      { error: "Choose a starting station and destination." },
      { status: 400 },
    );
  }
  const readyIn = Number(params.get("readyIn") ?? 3);
  if (!Number.isInteger(readyIn) || readyIn < 1 || readyIn > 30)
    return Response.json(
      { error: "Choose 1–30 minutes to reach the platform." },
      { status: 400 },
    );
  const ids = Object.keys(feeds);
  const outcomes = await Promise.allSettled(ids.map((id) => arrivals(id)));
  const now = Math.floor(Date.now() / 1000);
  const available: any[] = [],
    missing: string[] = [];
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
  if (!available.length)
    return Response.json(
      {
        error:
          "Live trip predictions are temporarily unavailable. Please try again.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const result = findJourney(network, available, from, to, now, readyIn * 60);
  let advisories: any[] = [],
    alertsAvailable = true;
  try {
    const a = await alerts();
    alertsAvailable = !a.stale && now - a.timestamp <= 180;
    const lines = new Set(
      result.legs
        .filter((l: any) => l.kind === "ride")
        .map((l: any) => l.route),
    );
    advisories = a.alerts.filter(
      (a: any) =>
        a.active &&
        (!a.routes.length || a.routes.some((r: string) => lines.has(r))),
    );
  } catch {
    alertsAvailable = false;
  }
  return Response.json(
    {
      ...result,
      from,
      to,
      checkedAt: now,
      timestamp: Math.min(...available.map((s) => s.timestamp)),
      missingFeeds: missing,
      feedsChecked: available.length,
      advisories,
      alertsAvailable,
      horizonMinutes: 60,
      boardingBufferSeconds: readyIn * 60,
      transferMinimumSeconds: 120,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
