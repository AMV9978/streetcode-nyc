# Changelog

## 2.0.0 — November 2026

The full audit is in [docs/AUDIT-2026-11.md](docs/AUDIT-2026-11.md).

### Added
- `/algorithms`: BFS, Dijkstra, A* and fewest-changes compared on a live graph of the whole subway, with an animated replay.
- RAPTOR trip planner with Pareto options (fastest vs fewer changes) and search statistics.
- Step-free trip option and per-station elevator status from MTA's elevator feeds.
- Countdown-accuracy tracking (`/api/reliability`).
- Reason codes and a typical-time estimate when no live trip is found.
- Destination labels on arrivals and direction buttons.
- New endpoints `/api/graph`, `/api/elevators` and `/api/reliability`; `stop`, `routes` and `format=protobuf` filters.
- Security headers, rate limiting, web manifest, icons, Open Graph image, robots.txt and a sitemap.
- GitHub Actions: CI, and a weekly map-data refresh pull request.
- 23 new tests (53 total).

### Fixed
- Trains dwelling at the platform were dropped.
- Irrelevant advisories appeared on trips and stations.
- Express route IDs (`7X`) did not match alerts for the base line.
- Expired static data had no warning, and the import script failed on station changes.
- The lab feed inspector was blocked by CORS.
- A dependency had a critical security advisory (Next.js 16.3.4 → 16.4.6).

### Changed
- The planner searches whole station complexes; the platform picker was removed.
- The arrivals board downloads only the selected station (~2 KB instead of up to hundreds of KB).
