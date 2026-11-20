/**
 * Tiny in-memory rate limiter (token bucket per client and route).
 * Upstream MTA calls are already cached, so this only protects this server's
 * CPU from someone scripting the trip planner in a loop.
 */
const buckets = (globalThis.__streetcodeBuckets ??= new Map());

export function clientId(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return (
    forwarded.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

/** Returns null when allowed, or a 429 Response when the client is over. */
export function limit(request, name, { perMinute = 40, burst = 20 } = {}, now = Date.now()) {
  const key = name + ":" + clientId(request);
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size > 20000) buckets.clear(); // bounded memory
    b = { tokens: burst, at: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return null;
  }
  const retry = Math.ceil(((1 - b.tokens) / perMinute) * 60);
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: { "Retry-After": String(retry), "Cache-Control": "no-store" },
    },
  );
}
