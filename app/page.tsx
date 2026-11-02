"use client";
import { useEffect, useRef, useState } from "react";
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
function color(r: string) {
  return "123".includes(r)
    ? "#d54943"
    : "456".includes(r)
      ? "#168667"
      : r === "7"
        ? "#a84ca4"
        : "ACE".includes(r)
          ? "#326ac7"
          : "BDFM".includes(r)
            ? "#e47626"
            : r === "G"
              ? "#678731"
              : "JZ".includes(r)
                ? "#936438"
                : "NQRW".includes(r)
                  ? "#a47c00"
                  : "#647588";
}
function Badge({ route }: { route: string }) {
  return (
    <span className="badge" style={{ background: color(route) }}>
      {route}
    </span>
  );
}
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
    [shareMessage, setShareMessage] = useState("");
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
  }, [selected, direction, catalogReady]);
  function selectStation(id: string) {
    setSelected(id);
    setDirection("N");
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
          .map((f) => ({ key: f, url: "/api/arrivals?feed=" + f })),
        { key: "alerts", url: "/api/alerts?format=" + format },
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
  const snapshots = feedIds.map((f) => data[f]).filter(Boolean),
    old = snapshots.some(
      (s) =>
        s.stale ||
        now / 1000 - s.timestamp > 90 ||
        now / 1000 < s.timestamp - 30,
    ),
    missing = feedIds.filter((f) => !data[f] || errors[f]);
  const arrivals = snapshots
    .flatMap((s) =>
      s.arrivals.map((a: any) => ({ ...a, timestamp: s.timestamp })),
    )
    .filter((a) => a.stopId === selected + direction && a.time >= now / 1000)
    .sort((a, b) => a.time - b.time)
    .filter(
      (a, i, all) =>
        all.findIndex(
          (x) =>
            x.trip === a.trip && x.stopId === a.stopId && x.time === a.time,
        ) === i,
    )
    .slice(0, 12);
  const relevant = (alerts?.alerts || []).filter(
    (a: any) =>
      a.active !== planned &&
      (!station ||
        !a.routes.length ||
        a.routes.some((r: string) => station.routes.includes(r))),
  );
  const selectedAlertCount = (alerts?.alerts || []).filter(
    (a: any) =>
      a.active &&
      (!a.routes.length ||
        a.routes.some((r: string) => station?.routes.includes(r))),
  ).length;
  const nearbyStations = station
    ? stations
        .filter(
          (s) =>
            Math.abs(s.lat - station.lat) < 0.045 &&
            Math.abs(s.lon - station.lon) < 0.065,
        )
        .sort(
          (a, b) =>
            (a.lat - station.lat) ** 2 +
            (a.lon - station.lon) ** 2 -
            ((b.lat - station.lat) ** 2 + (b.lon - station.lon) ** 2),
        )
        .slice(0, 12)
    : [];
  return (
    <>
      <a className="skip-link" href="#arrival-board">
        Skip to arrivals
      </a>
      <header>
        <a className="brand" href="/">
          <span className="brand-icon">S↗</span>
          <span>
            StreetCode <em>NYC</em>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={tab === "arrivals" ? "active" : ""}
            onClick={() => setTab("arrivals")}
          >
            Live arrivals
          </button>
          <button
            className={tab === "saved" ? "active" : ""}
            onClick={() => {
              setTab("saved");
              setQuery("");
              setLine("All");
            }}
          >
            Saved <small>{favorites.length}</small>
          </button>
          <a href="/lab/index.html">Route demo ↗</a>
        </nav>
        <span className="city">NEW YORK · {now ? clock(now) : "—"} ET</span>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span className="dot" /> THE CITY MOVES. STAY AHEAD.
            </div>
            <h1>
              Your next train.
              <br />
              <span>One clearer commute.</span>
            </h1>
            <p>Live arrivals and service updates, together in one place.</p>
          </div>
          <div className="intro-note">
            <span>BUILT FOR THE EVERYDAY RIDER</span>
            <strong>
              Less guessing.
              <br />
              More getting there.
            </strong>
            <p>Official MTA feeds · Independent student project</p>
          </div>
        </section>
        <div className="quick-start" aria-label="Getting started">
          <span>
            <b>1</b> Find your station and line
          </span>
          <span>
            <b>2</b> Choose your platform direction
          </span>
          <span>
            <b>3</b> Save it for next time
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
              onChange={(e) => setLine(e.target.value)}
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
              Some station names appear more than once. Choose the entry showing
              your subway line.
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
              These are MTA direction labels. Check platform signs and the
              train’s destination before boarding. Automatic updates run while
              this page is open and visible.
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
                        {direction === "N" ? "Northbound" : "Southbound"}{" "}
                        {a.route}
                      </strong>
                      <small>
                        {i === 0 ? "Next predicted train" : "Following train"}
                      </small>
                    </div>
                  </div>
                  <div className="eta">
                    <strong>
                      {Math.ceil((a.time - now / 1000) / 60)}
                      <small> min</small>
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
                    No matching {planned ? "future" : "active"} advisories in
                    this feed.
                  </p>
                )}
                {relevant.slice(0, 20).map((a: any) => (
                  <details key={a.id}>
                    <summary>
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
              <section className="map-panel">
                <div className="section-label">EXPLORE NEARBY STATIONS</div>
                <h3>Nearby stations</h3>
                <p className="muted">
                  Station locations · select a dot to explore
                </p>
                <svg
                  viewBox="0 0 340 260"
                  role="group"
                  aria-label="Select a nearby station. Station diagram, not a route map."
                >
                  <rect width="340" height="260" fill="#e9f0ec" />
                  {station &&
                    nearbyStations.map((s) => (
                      <g
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        aria-label={"Select " + s.name + " " + s.id}
                        onClick={() => selectStation(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectStation(s.id);
                          }
                        }}
                      >
                        <circle
                          cx={170 + (s.lon - station.lon) * 2400}
                          cy={130 - (s.lat - station.lat) * 2600}
                          r={s.id === selected ? 9 : 4}
                          fill={s.id === selected ? "#173f35" : "#fff"}
                          stroke="#527b6b"
                          strokeWidth="2"
                        />
                        <title>
                          {s.name} · {s.routes.join(", ")}
                        </title>
                      </g>
                    ))}
                </svg>
                <p className="map-note">
                  Dots show stations near your selection. This diagram does not
                  show train locations, streets, or walking directions.
                </p>
                <details>
                  <summary>Choose from nearby stations</summary>
                  <div className="nearby-list">
                    {nearbyStations
                      .filter((s) => s.id !== selected)
                      .map((s) => (
                        <button key={s.id} onClick={() => selectStation(s.id)}>
                          {s.name}
                          <small>Lines {s.routes.join(", ")}</small>
                        </button>
                      ))}
                  </div>
                </details>
                <a className="lab-link" href="/lab/index.html">
                  <strong>Try the route demo ↗</strong>
                  <span>
                    See how example routes change during a delay. A learning
                    simulation, separate from these live arrivals.
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
              This page shows station arrivals and service updates. It does not
              calculate a real trip between stations. The separate route demo
              uses example travel times for learning. Use official MTA
              information for travel planning and accessibility details.
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
