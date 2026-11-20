import { liveGraph } from "../../../lib/transit/service.js";
import { limit } from "../../../lib/http/limit.js";
import network from "../../../lib/transit/map-data.json";

/**
 * GET /api/graph — the whole subway as a weighted graph, learned from the
 * trains running right now. The /algorithms page runs BFS, Dijkstra, A* and
 * a fewest-transfers search on it in the browser.
 */
export async function GET(request: Request) {
  const blocked = limit(request, "graph", { perMinute: 20, burst: 10 });
  if (blocked) return blocked;
  try {
    const g = await liveGraph(network);
    return Response.json(
      {
        builtAt: g.builtAt,
        stale: g.stale,
        tripsUsed: g.tripsUsed,
        feedsUsed: g.feedsUsed,
        missingFeeds: g.missingFeeds,
        // Compact rows keep the payload small: [from, to, route, seconds, wait]
        edges: g.edges.map((e: any) => [e.from, e.to, e.route, e.seconds, e.wait]),
        transfers: g.transfers.map((t: any) => [t.from, t.to, t.seconds]),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Live subway data is unavailable right now." },
      { status: 503 },
    );
  }
}
