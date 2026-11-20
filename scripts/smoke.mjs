/** Production HTTP check. Add --live to verify outbound MTA access as well. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

const live = process.argv.includes("--live");
const port = process.env.SMOKE_PORT || "4399";
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok && logs.includes("Ready")) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the process to bind the local port. */
    }
    await delay(100);
  }
  assert.ok(ready, `Server did not become ready: ${logs}`);
  async function check(path, expected, validate) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, expected, path);
    const body = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : await response.text();
    validate?.(body, response);
    const result = { path, status: response.status };
    if (body?.arrivals) result.predictions = body.arrivals.length;
    if (body?.alerts) result.advisories = body.alerts.length;
    results.push(result);
    console.log("PASS", JSON.stringify(result));
  }
  await check("/", 200, (body) => assert.match(body, /StreetCode/));
  await check("/stations.json", 200, (body) => {
    assert.equal(body.length, 496);
    assert.equal(new Set(body.map((s) => s.id)).size, body.length);
  });
  await check("/lab/index.html", 200, (body) =>
    assert.match(body, /StreetCode/),
  );
  await check("/api/arrivals?feed=invalid", 400);
  await check("/api/alerts?format=invalid", 400);
  await check("/api/journey?from=invalid&to=L01", 400);
  await check("/api/journey?from=L01&to=L03&readyIn=100", 400);
  await check("/algorithms", 200, (body) => assert.match(body, /algorithms/i));
  await check("/manifest.webmanifest", 200);
  await check("/robots.txt", 200, (body) => assert.match(body, /Disallow: \/api\//));
  await check("/api/arrivals?feed=l&stop=<script>", 400);
  await check("/api/elevators?station=nope", 400);
  await check("/api/reliability?route=bad!", 400);
  await check("/", 200, (_, response) => {
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.equal(response.headers.get("x-powered-by"), null);
  });
  await check("/subway-map.json", 200, (body) => {
    assert.equal(body.stations.length, 496);
    assert.ok(body.routes.find((r) => r.id === "D" && r.color === "#EB6800"));
    assert.ok(body.land.length >= 5);
  });
  if (live) {
    for (const feed of [
      "numbered",
      "ace",
      "bdfm",
      "g",
      "jz",
      "l",
      "nqrw",
      "si",
    ]) {
      await check(`/api/arrivals?feed=${feed}`, 200, (body, response) => {
        assert.ok(Number.isFinite(body.timestamp) && body.timestamp > 0);
        assert.ok(Array.isArray(body.arrivals));
        assert.equal(body.stale, false);
        assert.equal(response.headers.get("cache-control"), "no-store");
      });
    }
    await check("/api/journey?from=L03&to=L01&readyIn=3", 200, (body) => {
      assert.equal(body.feedsChecked, 8);
      assert.equal(body.boardingBufferSeconds, 180);
      assert.ok(Array.isArray(body.legs));
      if (body.found) assert.ok(body.arrival > body.checkedAt);
    });
    await check("/api/arrivals?feed=l&stop=L03", 200, (body) => {
      assert.ok(body.arrivals.every((a) => a.stopId.startsWith("L03")));
    });
    await check("/api/arrivals?feed=l&format=protobuf", 200);
    await check("/api/journey?from=127&to=235&readyIn=3&scope=complex", 200, (body) => {
      assert.ok(Array.isArray(body.options));
      assert.ok(body.stats && Number.isFinite(body.stats.tripsScanned));
    });
    await check("/api/graph", 200, (body) => {
      assert.ok(body.edges.length > 100, "graph has edges");
    });
    await check("/api/elevators?station=127", 200, (body) =>
      assert.ok(Array.isArray(body.elevators)),
    );
    await check("/api/reliability", 200);
    for (const format of ["json", "protobuf"]) {
      await check(`/api/alerts?format=${format}`, 200, (body) => {
        assert.ok(body.timestamp > 0);
        assert.ok(Array.isArray(body.alerts));
        assert.equal(body.stale, false);
        if (format === "json") assert.equal(body.fallback, false);
      });
    }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    node: process.version,
    live,
    results,
  };
  if (process.env.SMOKE_REPORT)
    await writeFile(
      process.env.SMOKE_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
} finally {
  const stopped = once(server, "exit");
  server.kill("SIGTERM");
  await Promise.race([stopped, delay(5000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
