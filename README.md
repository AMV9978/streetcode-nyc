# StreetCode NYC

A group bootcamp project that brings NYC subway arrival predictions, station search, saved stations, and service advisories into one readable dashboard.

This repository is the portable Node.js edition of the deployed StreetCode NYC app. It uses Next.js with server API routes, rather than the original ChatGPT Sites / Cloudflare runtime. It is intended for Hostinger's Node.js Web App hosting, not WordPress or static GitHub Pages.

Full click-by-click instructions: [docs/UPLOAD_GUIDE.md](docs/UPLOAD_GUIDE.md).

## Run locally

Use Node.js 22.13 or later (22.x or 24.x).

```sh
npm ci
npm test
npm run build
npm start
```

Open http://localhost:3000. For development, use `npm run dev`.
`PORT` may be set by the hosting platform. No MTA API key is configured or required by this implementation.

## Hostinger deployment

1. Upload the contents of this folder to AMV9978/streetcode-nyc. Keep package.json at the repository root.
2. In Hostinger, select Websites → Create Website → Web App → Import Git Repository.
3. Authorize the repository, select the main branch, and select the Next.js backend application type.
4. Set Node.js to 22.x (at least 22.13) or 24.x. Root directory: repository root. Install: npm ci. Build: npm run build. Start: npm start. Build output: .next if requested.
5. Use a temporary domain first. Do not select static export or upload to the portfolio's WordPress directory.
6. Inspect deployment logs. Test arrivals and both alert formats on the deployed address before attaching a custom domain.
7. Add a custom domain through Hostinger using the DNS values it supplies. Keep the existing deployed app available until this replacement passes checks.

Hostinger UI fields can vary. Follow the commands above where overrides are offered; a successful static frontend deployment alone is not sufficient.

## Features and behavior

- Eight allowlisted MTA subway/SIR prediction feeds.
- JSON all-alerts feed filtered to subway/SIR and subway GTFS-Realtime alerts.
- 496 station platform groups in a bundled static catalog.
- Browser-local favorites, line/name filters, platform direction, and schematic station map.
- Automatic polling 30 seconds after each completed refresh while the page is visible and not paused.
- Error retries back off to 60, 120, and 240 seconds. Returning to a visible tab refreshes again.
- A 25-second process-local cache coalesces concurrent requests. A previously successful value can be served as explicitly stale for up to five minutes during upstream failure.
- An algorithm lab at /lab/index.html demonstrates routing on a curated simulation network. Its weights, disruptions, and accessibility examples are illustrative, not live trip-planning advice.

## Structure

| Path | Purpose |
| --- | --- |
| app/page.tsx | Dashboard and refresh lifecycle |
| app/globals.css | Responsive dark visual theme |
| app/api/arrivals/route.ts | Arrival feed HTTP endpoint |
| app/api/alerts/route.ts | Alerts HTTP endpoint |
| lib/transit/feed.js | Bounded GTFS-Realtime decoding and feed allowlist |
| lib/transit/service.js | Upstream fetch, cache, fallback, alert normalization |
| public/stations.json | Bundled station catalog |
| public/lab/ | Educational routing simulation |
| tests/ | Feed, service, heap, and routing tests |

## Data and limitations

MTA sources: https://api.mta.info/ and https://www.mta.info/developers
The station catalog was generated from https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip on October 27, 2026. It is not refreshed automatically. Route memberships include trips in the source schedule and do not prove current service at a station.

Arrival times are predictions, not guarantees. No prediction does not mean no service. Feed timestamps and stale indicators matter. This is an independent student project, not an official MTA service.

There are no cloud accounts, background push notifications, live accessible route guarantees, or live train GPS positions. Favorites are per browser/device. Polling happens during an active visit, not continuously with all visitors offline. Process caches do not persist across restarts or synchronize across multiple instances.

## Verification

After a production build, run `npm run test:smoke` to check the local HTTP server or `npm run test:live` to additionally check all live upstream feeds. Live checks depend on MTA availability.

Run `npm test` for 18 automated tests, including 8,670 routing comparisons against an independent shortest-path oracle. Run `npm run build` for compilation and TypeScript checking. See docs/VALIDATION.md for the migration verification record and outstanding hosted checks.

## Group ownership

Add the actual group members and their contributions before submission. Do not attribute the entire group project to one member solely because their account hosts the repository. Add collaborators in GitHub repository settings as agreed by the team.

No open-source license has been selected for the group's authored code. The group should agree on licensing before granting reuse permissions; third-party data and dependencies retain their own terms.
