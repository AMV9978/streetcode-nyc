import { arrivals } from "../../../lib/transit/service.js";
export async function GET(request: Request) {
  const feed = new URL(request.url).searchParams.get("feed") || "numbered";
  try {
    return Response.json(await arrivals(feed), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Feed unavailable" },
      {
        status: feed.match(/^(numbered|ace|bdfm|g|jz|l|nqrw|si)$/) ? 502 : 400,
      },
    );
  }
}
