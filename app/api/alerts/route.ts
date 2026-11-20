import { alerts } from "../../../lib/transit/service.js";
import { sharesRoute } from "../../../lib/transit/routes.js";

/**
 * GET /api/alerts?format=json|protobuf[&routes=L,4,5]
 * With `routes`, only alerts on those lines (or system-wide) are returned,
 * which cuts the response from ~160 KB to a few KB for one station.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const format = params.get("format") || "json";
  if (!["json", "protobuf"].includes(format))
    return Response.json({ error: "Unknown format" }, { status: 400 });
  const routes = (params.get("routes") || "")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter((r) => /^[0-9A-Z]{1,3}$/.test(r))
    .slice(0, 12);
  try {
    const data = await alerts(format);
    const body = routes.length
      ? {
          ...data,
          routes,
          alerts: data.alerts.filter(
            (a: { routes: string[] }) =>
              !a.routes.length || sharesRoute(routes, a.routes),
          ),
        }
      : data;
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Alerts unavailable" },
      { status: 502 },
    );
  }
}
