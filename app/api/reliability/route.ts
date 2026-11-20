import { tracker } from "../../../lib/transit/reliability.js";

/** GET /api/reliability[?route=L] — how accurate countdowns have been. */
export async function GET(request: Request) {
  const route = new URL(request.url).searchParams.get("route") || undefined;
  if (route && !/^[0-9A-Z]{1,3}$/i.test(route))
    return Response.json({ error: "Invalid route" }, { status: 400 });
  return Response.json(tracker.summary(route), {
    headers: { "Cache-Control": "no-store" },
  });
}
