# Node.js migration validation

Source baseline: live Sites commit 0537a575eaca7b7e725d6e3bdf1df1fd1bc665ae.
Migration date: October 27, 2026.

The portable edition retains the app, transit service, station catalog, simulation lab, and tests. It removes Sites-specific authentication scaffolding, Worker bindings, deployment scripts, unused template components, and dependencies. It uses standard Next.js build/start commands.

Verified during preparation:
- Clean dependency installation from the portable package lock completed.
- Production compilation and TypeScript checking passed (Node.js 24.22.1).
- 18 automated tests passed; routing tests include 8,670 oracle comparisons.
- Local production HTTP server returned 200 for the dashboard, station catalog and algorithm lab.
- All eight arrival feeds returned live predictions through the HTTP backend. Both JSON and protobuf alert endpoints returned 178 advisories; JSON used its own source, not fallback.
- Invalid feed and alert format queries returned 400.
- Machine-readable HTTP check evidence is included in live-check.json, recorded at 2026-10-27T17:09:56.781Z. Counts change with service conditions.

Pending until Hostinger deployment:
- Hostinger build, process start, and outbound access to all MTA feeds.
- Public HTTPS, domain verification, and production mobile/browser checks.
- Observed refresh over multiple cycles and recovery from an upstream outage.

The earlier Cloudflare deployment was verified separately. Its success does not establish Hostinger compatibility or uptime. A local build is not evidence of a successful Hostinger deployment.
