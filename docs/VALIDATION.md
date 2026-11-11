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

## Rider usability update — October 27, 2026

The final Node.js production build and TypeScript checks passed after the usability changes. The existing 18 tests passed during this update. Browser checks confirmed expanded-word station search, remembered station/direction, copy-link feedback, pause/resume messages, the complete route walkthrough including its final step, and phone layouts with no horizontal overflow at a 375px content width. These are manual interaction checks, not a claim that every browser or possible failure has been tested.

The local Sites preview could not reach MTA during this pass; it was used to inspect loading and unavailable-data states. The earlier live-check.json is retained with its original timestamp and has not been relabeled as a new live check. Hostinger deployment and public acceptance checks remain the responsibility of the next deployment step described in USABILITY_UPDATE.md.

The updated Sites edition was then published successfully as version 5 from commit 36ade37c3dce948bc7d83428a79fbe10e4395eba. Public browser verification displayed live L arrivals and an active service advisory; the arrival feed timestamp advanced automatically from 1:58:42 PM to 1:59:12 PM ET on October 27, 2026. The new route walkthrough was also verified on the public site.

The existing Hostinger address, https://streetcodenyc.angelovasquez.net/, was reachable and displayed live L arrivals with a 1:59:07 PM ET feed timestamp during the same check. It still had the previous interface. That limited observation verifies current public access to the existing deployment, not this update's Hostinger deployment, every feed, or future uptime.


## Interactive map / quickest-trip update — 2026-10-27

See MAP_UPDATE.md and map-live-check.json. Automated tests increased to 30. Production build and TypeScript checks pass. All 8 arrival feeds and 2 alert formats returned live data in the Node production smoke check. A D service lookup returned live D16N/D16S predictions. The local Sites browser preview cannot reach upstream MTA; the published Sites app was then checked successfully with live D and B itineraries, all-eight-feed coverage, automatic refresh, and the correct southbound arrival link. Hostinger is not updated until the user commits the supplied files and deploys the new GitHub commit.
