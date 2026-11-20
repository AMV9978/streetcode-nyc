"use client";
import { useEffect, useRef, useState } from "react";
import JourneyPlanner from "./components/JourneyPlanner";
import Badge from "./components/LineBadge";
import { lineColor } from "../lib/transit/lines";
import { alertRelevance, baseRoute, parentStop } from "../lib/transit/routes.js";
type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string[];
};
const groups: Record<string, string> = {
  numbered: "1 2 3 4 5 6 7 GS",
  ace: "A C E H",
  bdfm: "B D F M FS",
  g: "G",
  jz: "J Z",
  l: "L",
  nqrw: "N Q R W",
  si: "SI SIR",
};
const routes = "1 2 3 4 5 6 7 A C E B D F M G J Z L N Q R W GS FS H SI".split(
  " ",
);
const clock = (n: number) =>
  new Date(n).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
const normalizeSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/\bsquare\b/g, "sq")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "av")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export default function Home() {
  const [stations, setStations] = useState<Station[]>([]),
    [selected, setSelected] = useState("L03"),
    [query, setQuery] = useState(""),
    [line, setLine] = useState("All"),
    [direction, setDirection] = useState("N"),
    [tab, setTab] = useState("arrivals"),
    [favorites, setFavorites] = useState<string[]>([]),
    [data, setData] = useState<Record<string, any>>({}),
    [alerts, setAlerts] = useState<any>(null),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(false),
    [paused, setPaused] = useState(false),
    [now, setNow] = useState(0),
    [planned, setPlanned] = useState(false),
    [format, setFormat] = useState("json"),
    [storageError, setStorageError] = useState(""),
    [catalogReady, setCatalogReady] = useState(false),
    [online, setOnline] = useState(true),
    [refreshVersion, setRefreshVersion] = useState(0),
    [lastAttempt, setLastAttempt] = useState(0),
    [shareMessage, setShareMessage] = useState(""),
    [showAll, setShowAll] = useState(false),
    [access, setAccess] = useState<any>(null),
    [accuracy, setAccuracy] = useState<any>(null);
  const station = stations.find((s) => s.id === selected),
    generation = useRef(0);
  useEffect(() => {
    fetch("/stations.json")
      .then((r) => {
        if (!r.ok) throw Error("Station catalog unavailable");
        return r.json();
      })
      .then((catalog: Station[]) => {
        setStations(catalog);
        const params = new URLSearchParams(window.location.search);
        let saved: { station?: string; direction?: string } = {};
        try {
          saved =
            JSON.parse(
              localStorage.getItem("streetcode-last-station-v1") || "{}",
            ) || {};
        } catch {}
        const requested = params.get("station") || saved.station;
        if (catalog.some((s) => s.id === requested)) {
          setSelected(requested!);
          const requestedDirection = params.has("station")
            ? params.get("direction")
            : saved.direction;
          setDirection(requestedDirection === "S" ? "S" : "N");
        }
        setCatalogReady(true);
      })
      .catch((e) => setErrors((v) => ({ ...v, catalog: e.message })));
    try {
      const f = JSON.parse(
        localStorage.getItem("streetcode-stations-v1") || "[]",
      );
      if (Array.isArray(f))
        setFavorites(f.filter((x) => typeof x === "string").slice(0, 30));
    } catch {
      setStorageError("Saved stations could not be read.");
    }
    setNow(Date.now());
    const connection = () => setOnline(navigator.onLine);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  useEffect(() => {
    if (!catalogReady) return;
    try {
      localStorage.setItem(
        "streetcode-last-station-v1",
        JSON.stringify({ station: selected, direction }),
      );
    } catch {}
    setShareMessage("");
    setShowAll(false);
  }, [selected, direction, catalogReady]);
  // Elevator status for the selected station (refreshed every 2 minutes).
  useEffect(() => {
    if (!catalogReady || !selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setAccess(null);
    const load = () =>
      fetch("/api/elevators?station=" + encodeURIComponent(selected), {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setAccess)
        .catch((e) => {
          if (e?.name !== "AbortError") setAccess({ error: true });
        })
        .finally(() => {
          if (!controller.signal.aborted) timer = setTimeout(load, 120000);
        });
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected, catalogReady]);
  function selectStation(id: string, platformDirection = "N") {
    setSelected(id);
    setDirection(platformDirection === "S" ? "S" : "N");
    if (window.matchMedia("(max-width: 700px)").matches) {
      document
        .getElementById("arrival-board")
        ?.scrollIntoView({ behavior: "auto", block: "start" });
      document.getElementById("station-title")?.focus({ preventScroll: true });
    }
  }
  async function shareStation() {
    const url = new URL(window.location.origin + "/");
    url.searchParams.set("station", selected);
    url.searchParams.set("direction", direction);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareMessage(
        "Station link copied. You can paste it into a message or bookmark it.",
      );
    } catch {
      setShareMessage("Your station link: " + url.toString());
    }
  }
  const feedIds = station
    ? ([
        ...new Set(
          station.routes
            .map((r) =>
              Object.keys(groups).find((k) =>
                groups[k].split(" ").includes(r.replace(/[X]$/, "")),
              ),
            )
            .filter(Boolean),
        ),
      ] as string[])
    : [];
  const feedKey = feedIds.sort().join(",");
  const routeKey = [
    ...new Set((station?.routes || []).map((r) => baseRoute(r))),
  ].join(",");
  useEffect(() => {
    setLoading(false);
    if (!station || !catalogReady) return;
    const id = ++generation.current;
    const controller = new AbortController();
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let busy = false;
    const refresh = async () => {
      if (disposed || busy) return;
      if (document.hidden || paused || !online) {
        timer = setTimeout(refresh, 30000);
        return;
      }
      busy = true;
      setLoading(true);
      setLastAttempt(Date.now());
      const jobs = [
        ...feedKey
          .split(",")
          .filter(Boolean)
          .map((f) => ({
            key: f,
            // Only this station's predictions: a few KB instead of the
            // whole feed (the numbered-line feed is several hundred KB).
            url: `/api/arrivals?feed=${f}&stop=${encodeURIComponent(selected)}`,
          })),
        {
          key: "alerts",
          url: `/api/alerts?format=${format}&routes=${encodeURIComponent(routeKey)}`,
        },
      ];
      const results = await Promise.allSettled(
        jobs.map(async (j) => {
          const r = await fetch(j.url, {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(18000),
            ]),
          });
          if (!r.ok) throw Error("Feed temporarily unavailable");
          return r.json();
        }),
      );
      busy = false;
      if (disposed || id !== generation.current) return;
      let failed = false;
      results.forEach((r, i) => {
        const key = jobs[i].key;
        if (r.status === "fulfilled") {
          if (key === "alerts") setAlerts(r.value);
          else setData((v) => ({ ...v, [key]: r.value }));
          setErrors((v) => {
            const n = { ...v };
            delete n[key];
            return n;
          });
        } else {
          failed = true;
          setErrors((v) => ({
            ...v,
            [key]: "Unable to refresh. Retrying automatically.",
          }));
        }
      });
      failures = failed ? Math.min(failures + 1, 3) : 0;
      setLoading(false);
      timer = setTimeout(refresh, failed ? 30000 * 2 ** failures : 30000);
    };
    refresh();
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        refresh();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    feedKey,
    selected,
    routeKey,
    paused,
    format,
    !!station,
    catalogReady,
    online,
    refreshVersion,
  ]);
  function favorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id].slice(-30);
    setFavorites(next);
    try {
      localStorage.setItem("streetcode-stations-v1", JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "Browser storage is unavailable; favorites will last for this visit only.",
      );
    }
  }
  const shown = stations.filter(
    (s) =>
      (line === "All" || s.routes.includes(line)) &&
      normalizeSearch(`${s.name} ${s.id}`).includes(normalizeSearch(query)) &&
      (tab !== "saved" || favorites.includes(s.id)),
  );
  const snapshots = feedIds
      .map((f) => data[f])
      // Ignore a response that belongs to the previously selected station.
      .filter((d) => d && (!d.stops || d.stops.includes(selected))),
    old = snapshots.some(
      (s) =>
        s.stale ||
        now / 1000 - s.timestamp > 90 ||
        now / 1000 < s.timestamp - 30,
    ),
    missing = feedIds.filter(
      (f) =>
        !data[f] ||
        errors[f] ||
        (data[f].stops && !data[f].stops.includes(selected)),
    );
  const nameOf = (stopId?: string) =>
    stopId ? stations.find((s) => s.id === parentStop(stopId))?.name : "";
  const platformArrivals = (d: string) =>
    snapshots
      .flatMap((s) =>
        s.arrivals.map((a: any) => ({ ...a, timestamp: s.timestamp })),
      )
      .filter(
        (a) =>
          a.stopId === selected + d &&
          // A train dwelling at the platform can still be boarded.
          (a.departure ?? a.time) >= now / 1000,
      )
      .sort((a, b) => a.time - b.time)
      .filter(
        (a, i, all) =>
          all.findIndex(
            (x) =>
              x.trip === a.trip && x.stopId === a.stopId && x.time === a.time,
          ) === i,
      );
  const allArrivals = platformArrivals(direction);
  const arrivals = allArrivals.slice(0, showAll ? 12 : 6);
  // "Northbound" means little on the L or the shuttles, so show where most
  // trains on each platform are actually heading.
  const headsign = (d: string) => {
    const counts = new Map<string, number>();
    for (const a of platformArrivals(d)) {
      const n = nameOf(a.dest);
      if (n && parentStop(a.dest) !== selected)
        counts.set(n, (counts.get(n) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  };
  const firstRoute = arrivals[0]?.route || station?.routes[0] || "";
  const accuracyLine = accuracy?.lines?.[baseRoute(firstRoute)];
  const accuracyNote = (() => {
    const b = accuracyLine?.["5"];
    if (!b || b.n < 15) return "";
    return `Five minutes out, ${baseRoute(firstRoute)} train countdowns have been within a minute ${Math.round(b.withinOneMinute * 100)}% of the time (${b.n} trains watched by this site).`;
  })();
  const scoped = (alerts?.alerts || [])
    .map((a: any) => ({
      ...a,
      relevance: station
        ? alertRelevance(a, station.routes, [selected])
        : "line",
    }))
    .filter((a: any) => a.relevance);
  const rank = (a: any) =>
    a.relevance === "station" ? 0 : a.relevance === "line" ? 1 : 2;
  const forTab = scoped
    .filter((a: any) => a.active !== planned)
    .sort((a: any, b: any) => rank(a) - rank(b));
  const relevant = forTab.filter((a: any) => a.relevance !== "elsewhere");
  const elsewhere = forTab.filter((a: any) => a.relevance === "elsewhere");
  const selectedAlertCount = scoped.filter(
    (a: any) => a.active && a.relevance !== "elsewhere",
  ).length;
  // Countdown accuracy by line (a small summary), refreshed every few minutes.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/reliability")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && setAccuracy(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 180000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <>
      <a className="skip-link" href="#arrival-board">
        Skip to arrivals
      </a>
      <header>
        <a className="brand" href="/">
          <span className="brand-icon">
            S<span>↗</span>
          </span>
          <span>
            StreetCode <em>NYC</em>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#planner" className="plan-nav">
            Plan a trip
          </a>
          <button
            className={tab === "arrivals" ? "active" : ""}
            onClick={() => {
              setTab("arrivals");
              document
                .getElementById("live-stations")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Live arrivals
          </button>
          <button
            className={tab === "saved" ? "active" : ""}
            onClick={() => {
              setTab("saved");
              setQuery("");
              setLine("All");
              document
                .getElementById("live-stations")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Saved <small>{favorites.length}</small>
          </button>
          <a href="/algorithms">Algorithms</a>
          <a href="/lab/index.html" className="lab-nav">
            Route demo ↗
          </a>
        </nav>
        <span className="city">NEW YORK · {now ? clock(now) : "—"} ET</span>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span className="live-dot" /> NEW YORK CITY · LIVE TRANSIT
            </div>
            <h1>
              The city is yours.
              <br />
              <span>Find your way through it.</span>
            </h1>
            <p>Your stations. Your connection. One clearer commute.</p>
          </div>
          <div className="intro-network" aria-label="NYC subway lines">
            <div>
              {["1", "2", "3", "A", "C", "E", "N", "Q", "R"].map((r) => (
                <Badge key={r} route={r} />
              ))}
            </div>
            <div>
              {["4", "5", "6", "B", "D", "F", "7", "G", "L"].map((r) => (
                <Badge key={r} route={r} />
              ))}
            </div>
            <p>Official MTA data. A StreetCode perspective.</p>
          </div>
        </section>
        <JourneyPlanner
          initialStation={selected}
          onArrivals={(id, direction) => {
            selectStation(id, direction);
            document
              .getElementById("arrival-board")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <div className="section-heading" id="live-stations">
          <div>
            <div className="eyebrow">RIGHT NOW, AT YOUR STATION</div>
            <h2>Next trains. Less guesswork.</h2>
          </div>
          <span className="live-label">
            <span className="live-dot" /> Live MTA arrivals
          </span>
        </div>
        <div className="workspace">
          <aside>
            <div className="section-label">01 / FIND YOUR STATION</div>
            <h2>
              {tab === "saved"
                ? "Your saved stations"
                : "Where are you boarding?"}
            </h2>
            <label htmlFor="search">Find a station</label>
            <input
              id="search"
              disabled={!catalogReady}
              placeholder="Search Union Sq, Times Sq…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label htmlFor="line">Subway line</label>
            <select
              id="line"
              disabled={!catalogReady}
              value={line}
              onChange={(e) => {
                setLine(e.target.value);
                setQuery("");
              }}
            >
              <option>All</option>
              {routes.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <div className="list-caption">
              <span>
                {catalogReady
                  ? `${shown.length} ${shown.length === 1 ? "match" : "matches"}`
                  : "Loading stations…"}
              </span>
              {(query || line !== "All") && (
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery("");
                    setLine("All");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
            <p className="search-help">
              Changing the line shows all of its stations. Times Sq and nearby
              42 St–Bryant Park are separate stops; B, D, F and M use Bryant
              Park.
            </p>
            {errors.catalog && (
              <div role="alert" className="warning">
                We couldn’t load the station list.{" "}
                <button
                  className="text-button"
                  onClick={() => window.location.reload()}
                >
                  Try again
                </button>
              </div>
            )}
            <div className="station-list">
              {shown.map((s) => (
                <button
                  key={s.id}
                  className={"station " + (selected === s.id ? "selected" : "")}
                  aria-pressed={selected === s.id}
                  onClick={() => selectStation(s.id)}
                >
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {favorites.includes(s.id)
                        ? "★ Saved station"
                        : "View arrivals"}
                    </small>
                  </span>
                  <span className="badges">
                    {s.routes.map((r) => (
                      <Badge key={r} route={r} />
                    ))}
                  </span>
                </button>
              ))}
              {catalogReady && !shown.length && (
                <p className="empty">
                  {tab === "saved" && !favorites.length
                    ? "Save a station using the star beside its name. It will stay here on this browser, with no sign-in needed."
                    : "No stations match. Try another name or line."}
                </p>
              )}
            </div>
          </aside>
          <section
            style={
              {
                "--selected-line": lineColor(station?.routes[0] || "L"),
              } as React.CSSProperties
            }
            className="detail"
            id="arrival-board"
            aria-label="Selected station arrivals"
            tabIndex={-1}
          >
            <div className="station-heading">
              <div>
                <div className="section-label">02 / YOUR PLATFORM</div>
                <h2 id="station-title" tabIndex={-1}>
                  {station?.name ||
                    (errors.catalog
                      ? "Station list unavailable"
                      : "Loading stations…")}
                </h2>
                <div className="badges">
                  {station?.routes.map((r) => (
                    <Badge key={r} route={r} />
                  ))}
                </div>
              </div>
              <button
                aria-label={
                  favorites.includes(selected)
                    ? "Remove saved station"
                    : "Save station"
                }
                aria-pressed={favorites.includes(selected)}
                className="save"
                disabled={!catalogReady}
                onClick={() => favorite(selected)}
              >
                {favorites.includes(selected) ? "★ Saved" : "☆ Save"}
              </button>
            </div>
            {storageError && <p role="status">{storageError}</p>}
            <div className="station-actions">
              <button
                className="text-button"
                disabled={!catalogReady}
                onClick={shareStation}
              >
                Copy station link
              </button>
              <span>Saved stations stay on this browser.</span>
            </div>
            {shareMessage && (
              <p className="share-message" role="status">
                {shareMessage}
              </p>
            )}
            <div className="board-tools">
              <div className="segmented" aria-label="Direction">
                {["N", "S"].map((d) => (
                  <button
                    key={d}
                    aria-pressed={direction === d}
                    className={direction === d ? "active" : ""}
                    onClick={() => setDirection(d)}
                  >
                    {d === "N" ? "Northbound" : "Southbound"}
                    {headsign(d) && <small>to {headsign(d)}</small>}
                  </button>
                ))}
              </div>
              <div className="refresh-actions">
                <button
                  className="refresh"
                  disabled={
                    !station || !online || loading || now - lastAttempt < 30000
                  }
                  onClick={() => {
                    setPaused(false);
                    setRefreshVersion((v) => v + 1);
                  }}
                >
                  Refresh now
                </button>
                <button
                  className="pause"
                  aria-pressed={paused}
                  onClick={() => setPaused(!paused)}
                >
                  {paused ? "▶ Resume updates" : "Ⅱ Pause updates"}
                </button>
              </div>
            </div>
            <p className="direction-note">
              Northbound and Southbound are MTA’s platform labels; “to …” is
              where most trains on that platform are heading. Check platform
              signs and the train’s destination before boarding.
            </p>
            <div
              className={
                "health " +
                (!online || paused || old || (missing.length && !loading)
                  ? "warning"
                  : "")
              }
            >
              <span className="dot" />
              <span role="status">
                {!online
                  ? "You’re offline. Updates will resume when your connection returns."
                  : !catalogReady
                    ? "Waiting for the station list…"
                    : paused
                      ? "Updates paused. Resume to check the latest arrivals."
                      : loading
                        ? "Checking MTA for the latest arrivals…"
                        : missing.length
                          ? "Some arrival information is unavailable. We’ll try again automatically."
                          : old
                            ? "These predictions may be out of date. Check MTA before traveling."
                            : "Updates automatically about every 30 seconds"}
              </span>
              <span>
                {snapshots.length
                  ? "MTA updated " +
                    clock(
                      Math.min(...snapshots.map((s) => s.timestamp)) * 1000,
                    ) +
                    " ET"
                  : "No arrival data received yet"}
              </span>
            </div>
            <div className="arrival-head">
              <span>YOUR TRAIN</span>
              <span>PREDICTED ARRIVAL</span>
            </div>
            <div className="arrival-list">
              {arrivals.map((a, i) => (
                <div className="arrival" key={a.trip + a.stopId + a.time}>
                  <div>
                    <Badge route={a.route} />
                    <div>
                      <strong>
                        {nameOf(a.dest) && parentStop(a.dest) !== selected
                          ? `${baseRoute(a.route)} to ${nameOf(a.dest)}`
                          : `${direction === "N" ? "Northbound" : "Southbound"} ${baseRoute(a.route)}`}
                      </strong>
                      <small>
                        {a.route.endsWith("X") ? "Express · " : ""}
                        {i === 0 ? "Next predicted train" : "Following train"}
                      </small>
                    </div>
                  </div>
                  <div className="eta">
                    <strong>
                      {a.time <= now / 1000 ? (
                        "Now"
                      ) : (
                        <>
                          {Math.ceil((a.time - now / 1000) / 60)}
                          <small> min</small>
                        </>
                      )}
                    </strong>
                    <span>
                      {clock(a.time * 1000)} ET
                      {old || missing.length || !online
                        ? " · may be out of date"
                        : ""}
                    </span>
                  </div>
                </div>
              ))}
              {allArrivals.length > 6 && (
                <button
                  className="text-button show-more"
                  aria-expanded={showAll}
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll
                    ? "Show fewer trains"
                    : `Show ${Math.min(12, allArrivals.length) - 6} more trains`}
                </button>
              )}
              {accuracyNote && <p className="accuracy-note">{accuracyNote}</p>}
              {!arrivals.length && (
                <div className="empty">
                  <strong>
                    {!catalogReady
                      ? "Choose a station once the list loads"
                      : !online
                        ? "Reconnect to check arrivals"
                        : paused
                          ? "Updates are paused"
                          : loading
                            ? "Checking the next trains…"
                            : "No upcoming predictions available"}
                  </strong>
                  <p>
                    {!catalogReady
                      ? "The station list is needed to look up your trains."
                      : !online
                        ? "We’ll check again when you’re back online."
                        : paused
                          ? "Select Resume updates to check for the next trains."
                          : loading
                            ? "This can take a few seconds."
                            : missing.length
                              ? "The feed could not be loaded. We will retry automatically."
                              : "MTA has no matching predictions in the next hour. This does not confirm that service has stopped."}
                  </p>
                  {!loading && catalogReady && (
                    <a
                      href="https://www.mta.info"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Check official MTA information ↗
                    </a>
                  )}
                </div>
              )}
            </div>
            <section className="access-panel" aria-label="Elevator status">
              <div className="section-label">STEP-FREE ACCESS</div>
              {!access ? (
                <p className="muted">Checking MTA elevator status…</p>
              ) : access.error ? (
                <p className="muted">
                  Elevator status is unavailable right now.{" "}
                  <a
                    href="https://www.mta.info/accessibility/stations"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Check MTA accessibility ↗
                  </a>
                </p>
              ) : !access.elevators.length ? (
                <p>
                  <strong>No elevators listed for this station.</strong> MTA’s
                  data shows no elevator here, so it is unlikely to be
                  step-free.
                </p>
              ) : (
                <>
                  <p>
                    <strong>
                      {access.elevators.filter((e: any) => !e.outage || e.outage.upcoming).length}{" "}
                      of {access.elevators.length} elevators working
                    </strong>
                    {access.stepFree
                      ? " · These platforms look step-free right now"
                      : access.complexStepFree
                        ? " · Other platforms here are step-free, but these may not be"
                        : " · Step-free access may be limited"}
                  </p>
                  <ul className="elevator-list">
                    {access.elevators.slice(0, 8).map((e: any) => (
                      <li
                        key={e.id}
                        className={
                          e.outage && !e.outage.upcoming ? "out" : e.outage ? "planned" : ""
                        }
                      >
                        <span>
                          {e.outage && !e.outage.upcoming
                            ? "Out of service"
                            : e.outage
                              ? "Planned outage"
                              : "Working"}
                        </span>
                        <div>
                          {e.serving || e.id}
                          {e.outage?.until && (
                            <small>
                              {e.outage.upcoming ? "From " : "Expected back "}
                              {new Date(
                                (e.outage.upcoming ? e.outage.start : e.outage.until) * 1000,
                              ).toLocaleString("en-US", {
                                timeZone: "America/New_York",
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}{" "}
                              ET
                            </small>
                          )}
                          {e.alternative && !e.outage?.upcoming && (
                            <details>
                              <summary>Alternative route</summary>
                              <p>{e.alternative}</p>
                            </details>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <div className="bottom-grid">
              <section className="alerts">
                <div className="section-label">03 / KNOW BEFORE YOU GO</div>
                <h3>
                  Service updates{" "}
                  {alerts && (
                    <span>
                      {planned ? relevant.length : selectedAlertCount}
                    </span>
                  )}
                </h3>
                <div className="segmented">
                  <button
                    className={!planned ? "active" : ""}
                    aria-pressed={!planned}
                    onClick={() => setPlanned(false)}
                  >
                    Active now
                  </button>
                  <button
                    className={planned ? "active" : ""}
                    aria-pressed={planned}
                    onClick={() => setPlanned(true)}
                  >
                    Planned work
                  </button>
                </div>
                {(errors.alerts ||
                  alerts?.stale ||
                  (alerts && now / 1000 - alerts.timestamp > 180)) && (
                  <p className="warning">
                    Alerts may be out of date. {errors.alerts}
                  </p>
                )}
                {!alerts && !errors.alerts && (
                  <p>
                    {!online
                      ? "Connect to the internet to load service updates."
                      : paused
                        ? "Resume updates to load service advisories."
                        : "Loading MTA advisories…"}
                  </p>
                )}
                {alerts && relevant.length === 0 && (
                  <p className="muted">
                    No {planned ? "planned" : "active"} advisories for this
                    station or its lines.
                  </p>
                )}
                {relevant.slice(0, 20).map((a: any) => (
                  <details key={a.id}>
                    <summary>
                      <span
                        className={
                          "alert-scope" + (a.relevance === "station" ? " here" : "")
                        }
                      >
                        {a.relevance === "station" ? "This station" : "Line-wide"}
                      </span>
                      <span className="alert-type">{a.type}</span>
                      {a.title}
                    </summary>
                    <p>
                      {a.description ||
                        "No additional details supplied by MTA."}
                    </p>
                    {!a.active && a.start && (
                      <small>
                        Starts{" "}
                        {new Date(a.start * 1000).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                        })}{" "}
                        ET
                      </small>
                    )}
                  </details>
                ))}
                {elsewhere.length > 0 && (
                  <details className="elsewhere-alerts">
                    <summary>
                      {elsewhere.length} more on these lines at other stations
                    </summary>
                    {elsewhere.slice(0, 20).map((a: any) => (
                      <p key={a.id}>
                        <span className="alert-type">{a.type}</span> {a.title}
                      </p>
                    ))}
                  </details>
                )}
                <details className="data-details">
                  <summary>About this data</summary>
                  <p>
                    Service updates come from MTA and may apply to a whole line.
                    Open an update to check the affected stations and times.
                    Most riders can leave the source below on its default
                    setting.
                  </p>
                  <label htmlFor="format">Data source (advanced)</label>
                  <select
                    id="format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="json">MTA JSON · subway filtered</option>
                    <option value="protobuf">MTA subway GTFS-Realtime</option>
                  </select>
                  {alerts && (
                    <small className="source-note">
                      Feed timestamp {clock(alerts.timestamp * 1000)} ET
                      {alerts.fallback ? " · Backup GTFS feed in use" : ""}
                    </small>
                  )}
                </details>
              </section>
              <section className="travel-tips">
                <div className="section-label">MAKE YOUR NEXT MOVE</div>
                <h3>A little help along the way.</h3>
                <p>
                  Choose a start and destination on the map to check live
                  connections, including a step-free option. Your saved
                  stations are always one tap away.
                </p>
                <a className="planner-link" href="#planner">
                  Back to the subway map <span>↗</span>
                </a>
                <a className="lab-link" href="/algorithms">
                  <strong>Curious how routes are found? ↗</strong>
                  <span>
                    Race BFS, Dijkstra, A* and a fewest-changes search on the
                    live subway, and watch each one explore the map.
                  </span>
                </a>
              </section>
            </div>
          </section>
        </div>
        <section className="rider-help" aria-label="Using StreetCode NYC">
          <h2>A few things worth knowing</h2>
          <details>
            <summary>Do I need an account?</summary>
            <p>
              No. You can check arrivals and save stations without signing in.
              Your saved stations and last-viewed station stay on this browser.
              Clearing browser data removes them.
            </p>
          </details>
          <details>
            <summary>How fresh are the arrivals?</summary>
            <p>
              The page checks MTA about 30 seconds after each completed update.
              Requests pause when the tab is hidden, and slow down after errors.
              The MTA timestamp shows when the source data was produced. An
              internet connection is required; predictions can change.
            </p>
          </details>
          <details>
            <summary>Can this plan my whole journey?</summary>
            <p>
              The map searches live subway predictions for a connection in the
              next hour, including station transfers, and can limit the trip to
              stations with working elevators. It does not include buses,
              ferries, or your walk to the first station. It may miss a
              connection when predictions are incomplete. Check MTA service
              advice before traveling. The separate route demo uses example
              times for learning.
            </p>
          </details>
        </section>
        <footer>
          <span>StreetCode NYC · Built as a group learning project</span>
          <a href="https://www.mta.info" target="_blank" rel="noreferrer">
            Official MTA information ↗
          </a>
          <span>Predictions can change. Not affiliated with the MTA.</span>
        </footer>
      </main>
    </>
  );
}
