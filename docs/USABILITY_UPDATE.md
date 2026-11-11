# StreetCode NYC — rider usability update

Prepared October 27, 2026. This update makes the live dashboard easier to use and keeps the teaching simulation clearly separate from actual travel information.

## What changed

- Station search recognizes full words such as Union Square, Street, and Avenue.
- The browser remembers the last selected station and direction. A copied station link opens that exact selection.
- Saved stations remain local to the browser; no account is required.
- Manual refresh, pause/resume, loading, offline, and stale-data messages make the update status clear. Manual refresh becomes available again after 30 seconds.
- Selecting a station on a narrow screen moves focus to its arrival panel. Inputs, controls, focus styles, and a skip link support phone and keyboard use.
- Service alerts have clear active/planned views. Technical source settings are inside About this data.
- The station diagram has a text list of nearby stations and no decorative geography that could be mistaken for a street map.
- The route demo now says How the route is calculated. Plain-language steps explain example times and train changes. An optional Learn more section explains Dijkstra's algorithm.
- Simulated travel times, accessibility labels, and route choices are explicitly distinguished from live arrivals.

## Update GitHub, then Hostinger

1. Download and extract the updated `StreetCode_NYC_GitHub_Hostinger.zip`.
2. Open your existing `AMV9978/streetcode-nyc` repository in GitHub Desktop. Pull any teammate changes first. Copy the extracted source contents into the repository folder and review the diff. Preserve unrelated teammate changes.
3. The application files changed in this update are `app/page.tsx`, `app/globals.css`, `public/lab/index.html`, `public/lab/app.js`, and `public/lab/styles.css`. The upload guide, validation notes, and this document are also updated. There are no new dependencies or environment variables.
4. Commit with a message such as `Make StreetCode NYC easier for everyday riders`, then push to the branch Hostinger deploys, currently shown as `main` in your setup screenshots.
5. In Hostinger, open the existing StreetCode NYC Node.js application. Confirm that a new deployment starts for your new commit. If automatic deployment is not enabled, use its deploy/redeploy control. Keep the existing Next.js, npm, Node 24.x, root `./`, build `npm run build`, and output `.next` settings.
6. Wait for the deployment to succeed. Check its logs if it fails; a successful GitHub upload alone is not a successful deployment.
7. Open your public Hostinger address and hard refresh. Look for Copy station link on the dashboard and How the route is calculated in Route demo. These distinguish this version from the previous one.
8. Run the checks below on the public address. Keep the previous successful deployment available for rollback if those checks fail.

Browser-upload alternative: in GitHub, use Add file → Upload files. Upload the extracted contents with the existing folder structure, not the ZIP or its enclosing folder. Review replacements and commit to the deployment branch. Use GitHub Desktop if your browser does not preserve folders.

## Public acceptance checks

| Check | Expected result |
| --- | --- |
| Search Union Square and select L | The L entry opens the arrival board |
| Choose Southbound, then reload | Same station and direction return |
| Copy station link, open elsewhere | Shared station and direction load |
| Save a station, open Saved, reload | The station remains saved in that browser |
| Leave visible for 65 seconds | MTA timestamps and predictions refresh when upstream data changes |
| Pause, then Resume | Status explains the pause; checking resumes |
| Refresh now | A new request starts; the button is temporarily unavailable while refreshing/cooling down |
| Disconnect, reconnect | Offline message appears; reconnection starts a new check |
| Active now / Planned work | Advisories switch; About this data holds source controls |
| Open Route demo and choose Next | Readable simulation steps advance; Back returns; final step disables Next |
| Phone and keyboard | No horizontal page overflow; controls remain usable and focus is visible |

## Availability and limits

The deployed Node.js server must remain running on your active Hostinger plan. GitHub stores source code; it does not run this backend. Domain/HTTPS configuration and MTA reachability must also remain healthy.

Arrivals refresh about 30 seconds after a completed request while the page is visible. The server briefly caches responses, and retries slow after failures. Opening the app starts a fresh check; it does not need a visitor to leave a tab running overnight. Updates cannot be fresher than MTA's feed timestamps. This update adds no background notifications, account sync, or offline arrival data.

This is a live arrivals and alerts tool with a separate teaching demo, not a complete real-world journey planner or accessibility guarantee. Use official MTA information and platform signage before boarding.

## Verification record

The Node production build and TypeScript checks passed. All 18 existing tests passed, including routing oracle comparisons, feed decoding, and service behavior. Browser checks covered search, saved/remembered selections, copy links, pause/resume, simulation steps, and phone-width layout without horizontal overflow.

Local preview outbound MTA requests were unavailable, so local checks do not establish Hostinger feed connectivity or uptime. Re-run the public acceptance checks after deploying this package.

After publication, the updated Sites edition displayed live L arrivals and service alerts, and its source timestamp advanced automatically. Your existing Hostinger address also displayed live L arrivals, but it still showed the previous interface. This ZIP must be committed and deployed there to apply the update. See VALIDATION.md for the exact observations and timestamps.
