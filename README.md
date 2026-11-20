# StreetCode NYC

A group bootcamp project. It combines live NYC subway arrivals, an interactive map, a live trip planner that knows about elevators, and an **algorithms lab** where BFS, Dijkstra, A* and a fewest-changes search run on a graph of the whole subway learned from the trains running right now.

Live site: https://streetcodenyc.angelovasquez.net

## What makes it different

| Feature | How it works |
| --- | --- |
| **Live trip planner (RAPTOR)** | Round-based search over individual MTA train predictions. Round *k* finds the earliest arrival using at most *k* trains, which gives you options like "33 min, 1 change" or "44 min, no changes". It is property-tested against an independent search on 3,000 random networks. |
| **Algorithms on the live subway** (`/algorithms`) | Builds a weighted graph of every station from current predictions: median ride time per segment, and an expected wait of half the current gap between trains. It then races BFS, Dijkstra, A* (with an admissible straight-line heuristic) and lexicographic fewest-changes Dijkstra, shows states expanded and run time, and animates each one exploring the map. |
| **Step-free trips** | Uses MTA's elevator list and live outage feed to plan only through stations with working ADA elevators. Each station's panel shows elevator status and MTA's suggested alternative route. |
| **Countdown accuracy** | The server watches each train approach each stop and scores what the countdown said 1, 3, 5, 10 and 20 minutes earlier against when the train arrived. |
| **Honest "no trip" answers** | Says *why*: the trip needs the Staten Island Ferry, no trains from that station, or the trip is longer than the 1-hour live window. In the last case it adds a typical travel time from the live graph. |
| **Destination labels** | Shows "L to 8 Av" instead of only "Northbound L", using each trip's terminal from the feed. |

## Run locally

Use Node.js 22.13 or later (22.x or 24.x).

```sh
npm ci
npm test          # 53 unit and property tests
npm run build     # production build + TypeScript check
npm start         # http://localhost:3000
```

`npm run test:smoke` checks the local HTTP server. `npm run test:live` also checks every MTA feed. No MTA API key is needed.

`MTA_FEED_BASE` (optional) points the server at a different MTA-compatible base URL. This is useful for replaying a recorded snapshot in tests. Leave it unset in production.

## Deployment (Hostinger Node.js app)

Unchanged: Next.js preset, Node 22.x/24.x, root `./`, install `npm ci`, build `npm run build`, start `npm start`, output `.next`. Pushing to `main` redeploys if auto-deploy is on. See [docs/UPLOAD_GUIDE.md](docs/UPLOAD_GUIDE.md).

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/arrivals?feed=l[&stop=L03][&format=protobuf]` | Decoded feed. With `stop`, only that station's predictions. With `format=protobuf`, the raw bytes, which the lab decodes in the browser. |
| `GET /api/alerts?format=json[&routes=L,4]` | Subway alerts, optionally only for those lines |
| `GET /api/journey?from=&to=&readyIn=3[&scope=complex][&stepFree=1]` | Pareto trip options, search stats, reason codes, estimate and relevant advisories |
| `GET /api/graph` | Live whole-network graph (compact rows) |
| `GET /api/elevators?station=L03` | Elevators and outages at a station complex |
| `GET /api/reliability[?route=L]` | Countdown accuracy summary |

`/api/journey` and `/api/graph` are rate-limited per client. Every response is `Cache-Control: no-store`. Upstream MTA calls are cached and coalesced: 25 s for trains, 60 s for the graph and outages, 6 h for the elevator list.

## Structure

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Dashboard: arrivals, alerts, elevator status, accuracy |
| `app/components/JourneyPlanner.tsx` | Map, trip form, Pareto options, nearby stations |
| `app/components/AlgorithmLab.tsx` / `app/algorithms/page.tsx` | Algorithms on the live subway |
| `app/api/*` | Arrivals, alerts, journey, graph, elevators, reliability |
| `lib/transit/raptor.js` | RAPTOR trip search (Pareto: arrival time × train changes) |
| `lib/transit/journey.js` | Independent earliest-arrival search used as a test oracle |
| `lib/transit/graph.js` | Live graph builder; BFS, Dijkstra, A*, fewest-changes |
| `lib/transit/heap.js` | Binary min-heap |
| `lib/transit/reliability.js` | Countdown accuracy tracker |
| `lib/transit/elevators.js` | MTA elevator data → step-free stations |
| `lib/transit/routes.js` | Line normalisation (6X → 6) and alert relevance |
| `lib/transit/feed.js` | Bounded GTFS-Realtime decoder and feed allowlist |
| `lib/transit/service.js` | Upstream fetch, shared cache, stale fallback |
| `lib/http/limit.js` | Token-bucket rate limiter |
| `scripts/build-map-data.py` | Rebuilds the station catalog, transfers and map from MTA GTFS |
| `.github/workflows/` | CI (tests, build, smoke, audit) and the weekly map-data refresh PR |
| `public/lab/` | The original 17-station teaching simulation |
| `tests/` | Feed, service, routing, RAPTOR, graph, reliability, elevator and limiter tests |

## Data and limitations

- MTA sources: https://api.mta.info/ and https://www.mta.info/developers. Static data comes from https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip. The weekly workflow opens a pull request when it changes.
- Arrival times are predictions, not guarantees. No prediction does not mean no service.
- Step-free mode is an approximation. It counts a station when MTA lists an ADA elevator there and none of its non-redundant ADA elevators is out. It does not model which entrance or direction each elevator serves, or stations accessible by ramp only.
- Accuracy numbers and caches are in memory. They reset when the server restarts and are not shared between multiple server instances.
- Not affiliated with the MTA. Independent student project.

## Group ownership

Add the group members and their contributions before submission. No open-source license has been chosen yet. Agree on one as a group.
