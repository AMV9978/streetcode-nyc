# StreetCode NYC — map and route update

## What is implemented

- A custom interactive NYC subway map: drag to pan, zoom controls, keyboard map navigation, readable labels that avoid collisions, and line filters using the official MTA palette.
- Select any station complex, choose its platform group when necessary, and set A (start) or B (destination). Search fields offer an alternative to map selection.
- 496 platform groups, 444 connected complexes, 29 source route IDs including express variants, 85 geometry paths, and borough outlines. These counts describe the imported reference, not concurrent service.
- A quickest predicted trip based on live MTA stop updates. It considers waiting, transfer time, and a user-selected 1–30 minute allowance to reach the starting platform (default 3).
- Trip legs show line colors, stations, predicted times, direction, intermediate predicted stops, and a link to the correct arrival direction.
- Nearby station alternatives around the origin or destination. An optional button requests device location; coordinates are used in browser memory only, not sent to our backend or saved.
- Nearby candidates are ranked by straight-line distance within 1.5 km of a selected station or 3 km of device location, with complexes deduplicated. Riders choose a platform and then compare the resulting trip themselves.
- Route search refreshes 30 seconds after a request completes while the page is visible. It resumes on return or reconnection. The arrivals panel's pause control affects that panel; trip search refresh is independent.
- Eight arrival feeds plus both alert formats remain connected. D belongs to bdfm; D16 is 42 St–Bryant Pk. The Times Square groups are separate. Changing the arrival line filter clears the previous station-name search so D stations are discoverable.

## What “quickest” means

The engine returns the earliest arrival it can find from explicit, fresh predictions within the next hour, between the selected platform groups. It keeps stops on the same trip identity (feed, service date, route, trip ID), honors stop order, rejects decreasing timestamps, and permits changes only through the supplied transfer links or a change at the same parent station. A binary priority queue prioritizes the earliest time a rider can board again. Remaining on a train does not incur a transfer penalty.

Transfers allow at least 2 minutes; unspecified/zero-duration links use a 3-minute allowance, and longer MTA transfer times are preserved. Passageway chains are traversed using their total time. These are planning allowances, not measured walks. This model is not a guarantee of the fastest possible door-to-door journey. Missing predictions, unreported future trains, disruptions, and platform access can affect results.

A nearby stop may be closer yet lead to a later arrival. Distances do not represent street paths, entrances, bridges, stairs, or accessibility. Set enough boarding time yourself. This version does not calculate walking routes, automatically compare every nearby origin/destination pair, or reroute around free-text alerts. It shows relevant alerts for review. It does not promise elevator access.

Freshness rules: exclude cached failures, feed timestamps older than 90 seconds or more than 30 seconds ahead. Show incomplete coverage when any feed is missing. Show no-result and unavailable-data states separately. An empty result does not mean subway service has stopped.

## Ideas evaluated from the supplied examples

Adopted: a large dark map, official line-color badges/tracks, a prominent route recommendation, practical itinerary steps, nearby stations, and service advisories.

Deferred: venue reviews and carbon-savings counters (need trustworthy sources and a defined calculation); accessibility badges and elevator guarantees (need equipment-to-entrance/path matching and current outages); cloud sign-in (requires a configured identity provider); address-to-address walking and transit alternatives (requires a pedestrian/routing provider).

The app remains React + Next.js with Node API routes. Adding FastAPI and Firebase solely to resemble an architecture slide would introduce extra deployment and account management without improving this feature. A licensed routing service can be integrated later when provider access and billing are agreed. No new paid service is required by this update.

## Verify the deployed app

1. Open the site and select 42 St–Bryant Pk on the map (the complex also contains the 5 Av platform; choose B/D/F/M).
2. Set it as the start. Set 59 St–Columbus Circle, A/B/C/D platform group, as the destination.
3. Set the time to reach the platform and press Find quickest trip. The returned line can differ by the current service; do not expect a fixed demo itinerary.
4. Open the stop details and check the matched arrival direction. Wait through a refresh and check the feed/checked times.
5. Explore nearby stations. Around Times Square, Bryant Park must be discoverable. The location button is optional and may be denied; station-based discovery still works.
6. In the arrivals search, type Times Sq, then choose D from the line filter. The name filter clears and D station results appear.
7. Try the phone layout, map zoom, origin/destination swapping, and invalid/same-station cases. Check the app on an actual phone before a live group presentation; responsive browser checks do not replace device testing.

## Evidence from this update

`npm test`: 30 passing tests. Twelve new journey/proximity/data cases cover express-vs-local arrival ranking, boarding allowance, dwell times, transfers, passageways, trip identity, stale data, bad timestamps, horizon limits, and nearby D service. The existing 8,670 oracle comparisons cover the teaching lab, not the new live engine.

`npm run build`: production compilation and TypeScript checks passed during this update. `npm run test:live`: all eight arrival feeds, both alert formats, input validation, map assets, and the journey endpoint returned expected HTTP results. See map-live-check.json for the timestamped local production record. Live results are point-in-time checks, not uptime guarantees.

Additional live searches found a direct D trip from Bryant Park to Columbus Circle, a direct L trip, and a B-to-R transfer. A longer Times Square–Coney Island query had no complete prediction path within the horizon and correctly returned no result. Search computation in this check took 17–26 ms after feeds were loaded; network response time is additional.

Browser verification on the published Sites app: selected the B/D/F/M platform from the map; found a live D trip from Bryant Park to Columbus Circle with all 8 feeds; observed an automatic refresh; reversed the trip and obtained a B journey; confirmed its arrival link selected southbound. The layout was checked at desktop size and a 390px phone viewport with no horizontal page overflow. Nearby selection and line-filter clearing were exercised. Device-location permission was not requested during automated checks; it remains an opt-in feature to verify on a physical device.

## Data and maintenance

- MTA developer resources: https://www.mta.info/developers
- MTA static source: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
- MTA palette: https://www.mta.info/document/168976
- NYC Department of City Planning borough boundaries: https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne
- GTFS-Realtime semantics: https://gtfs.org/documentation/realtime/reference/

Reference geometry and transfer links were imported on 2026-10-27. The source schedule's valid-through value is 2026-10-31; this app does not use its timetable for journey times. Geometry and transfer data still require periodic review/re-import for station and connection changes. The live feeds refresh during visits; the bundled reference files do not update themselves. Track drawings may not reflect temporary reroutes. The source generator documents its usage and validation. Review changes before committing regenerated files.

The map is an original rendering of source geometry, not a reproduction of the official printed MTA map or an official MTA product. Team authorship remains collective.
