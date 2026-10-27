import { alerts } from "../../../lib/transit/service.js";
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") || "json";
  try {
    return Response.json(await alerts(format), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Alerts unavailable" },
      { status: ["json", "protobuf"].includes(format) ? 502 : 400 },
    );
  }
}
