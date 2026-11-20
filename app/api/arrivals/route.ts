import { arrivals, rawFeed } from "../../../lib/transit/service.js";
import { feeds } from "../../../lib/transit/feed.js";
import { parentStop } from "../../../lib/transit/routes.js";

/**
 * GET /api/arrivals?feed=l                 whole decoded feed (as before)
 * GET /api/arrivals?feed=l&stop=L03        only predictions for that station
 *                                          (both directions; up to 10 IDs)
 * GET /api/arrivals?feed=l&format=protobuf raw GTFS-Realtime bytes for the
 *                                          lab's in-browser decoder
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const feed = params.get("feed") || "numbered";
  if (!Object.hasOwn(feeds, feed))
    return Response.json({ error: "Unknown feed" }, { status: 400 });
  const stopParam = params.get("stop");
  const stops = stopParam
    ? stopParam
        .split(",")
        .map((s) => parentStop(s.trim().toUpperCase()))
        .filter((s) => /^[A-Z0-9]{2,5}$/.test(s))
        .slice(0, 10)
    : null;
  if (stopParam && !stops?.length)
    return Response.json({ error: "Invalid stop" }, { status: 400 });
  try {
    if (params.get("format") === "protobuf") {
      const raw = await rawFeed(feed);
      return new Response(raw.bytes, {
        headers: {
          "Content-Type": "application/x-protobuf",
          "Cache-Control": "no-store",
          "X-Feed-Stale": String(raw.stale),
        },
      });
    }
    const data = await arrivals(feed);
    const body = stops
      ? {
          ...data,
          stops,
          arrivals: data.arrivals.filter((a: { stopId: string }) =>
            stops.includes(parentStop(a.stopId)),
          ),
        }
      : data;
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Feed unavailable" },
      { status: 502 },
    );
  }
}
