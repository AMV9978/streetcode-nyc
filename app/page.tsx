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
    [storageError, setStorageError] = useState("");
  const station = stations.find((s) => s.id === selected),
    generation = useRef(0);
  useEffect(() => {
    fetch("/stations.json")
      .then((r) => {
        if (!r.ok) throw Error("Station catalog unavailable");
        return r.json();
      })
      .then(setStations)
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
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
    if (!station) return;
    const id = ++generation.current;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let busy = false;
    const refresh = async () => {
      if (disposed || busy) return;
      if (document.hidden || paused) {
        timer = setTimeout(refresh, 30000);
        return;
      }
      busy = true;
      setLoading(true);
      const jobs = [
        ...feedKey
          .split(",")
          .filter(Boolean)
          .map((f) => ({ key: f, url: "/api/arrivals?feed=" + f })),
        { key: "alerts", url: "/api/alerts?format=" + format },
      ];
      const results = await Promise.allSettled(
        jobs.map(async (j) => {
          const r = await fetch(j.url, { signal: AbortSignal.timeout(18000) });
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
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [feedKey, paused, format, !!station]);
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
      `${s.name} ${s.id}`.toLowerCase().includes(query.toLowerCase()) &&
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
      a.active && a.routes.some((r: string) => station?.routes.includes(r)),
  ).length;
  return (
    <>
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
            Live stations
          </button>
          <button
            className={tab === "saved" ? "active" : ""}
            onClick={() => setTab("saved")}
          >
            Saved <small>{favorites.length}</small>
          </button>
          <a href="/lab/index.html">Algorithm lab ↗</a>
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
        <div className="workspace">
          <aside>
            <div className="section-label">01 / FIND YOUR STATION</div>
            <h2>
              {tab === "saved"
                ? "Your saved stations"
                : "Where are you headed?"}
            </h2>
            <label htmlFor="search">Station name or ID</label>
            <input
              id="search"
              placeholder="Search Union Sq, Times Sq…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label htmlFor="line">Subway line</label>
            <select
              id="line"
              value={line}
              onChange={(e) => setLine(e.target.value)}
            >
              <option>All</option>
              {routes.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <div className="list-caption">
              {shown.length} stations <span>Choose a platform group</span>
            </div>
            {errors.catalog && <p role="alert">{errors.catalog}</p>}
            <div className="station-list">
              {shown.map((s) => (
                <button
                  key={s.id}
                  className={"station " + (selected === s.id ? "selected" : "")}
                  onClick={() => {
                    setSelected(s.id);
                    setDirection("N");
                  }}
                >
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {s.id} {favorites.includes(s.id) ? "· Saved" : ""}
                    </small>
                  </span>
                  <span className="badges">
                    {s.routes.map((r) => (
                      <Badge key={r} route={r} />
                    ))}
                  </span>
                </button>
              ))}
              {!shown.length && (
                <p className="empty">
                  {tab === "saved"
                    ? "Save a station using the star beside its name."
                    : "No stations match. Try another name or line."}
                </p>
              )}
            </div>
          </aside>
          <section className="detail">
            <div className="station-heading">
              <div>
                <div className="section-label">02 / YOUR PLATFORM</div>
                <h2>{station?.name || "Loading stations…"}</h2>
                <div className="badges">
                  {station?.routes.map((r) => (
                    <Badge key={r} route={r} />
                  ))}
                  <span className="muted">Station {selected}</span>
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
                onClick={() => favorite(selected)}
              >
                {favorites.includes(selected) ? "★ Saved" : "☆ Save"}
              </button>
            </div>
            {storageError && <p role="status">{storageError}</p>}
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
              <button className="pause" onClick={() => setPaused(!paused)}>
                {paused ? "▶ Resume updates" : "Ⅱ Pause updates"}
              </button>
            </div>
            <p className="direction-note">
              MTA platform direction · Check train destinations and station
              signs before boarding.
            </p>
            <div
              className={"health " + (old || missing.length ? "warning" : "")}
              role="status"
            >
              <span className="dot" />
              {paused
                ? "Updates paused"
                : loading
                  ? "Refreshing MTA feeds…"
                  : missing.length
                    ? "Some feeds unavailable · automatic retry enabled"
                    : old
                      ? "Stale predictions · check MTA before traveling"
                      : "Automatic updates every 30 seconds"}
              <span>
                {snapshots.length
                  ? "Feed time " +
                    clock(Math.min(...snapshots.map((s) => s.timestamp)) * 1000)
                  : "Waiting for first feed"}
              </span>
            </div>
            <div className="arrival-head">
              <span>LINE / PLATFORM</span>
              <span>EXPECTED ARRIVAL</span>
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
                        Platform {a.stopId} {i === 0 ? "· Next departure" : ""}
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
                      {now / 1000 - a.timestamp > 90 ? " · stale" : ""}
                    </span>
                  </div>
                </div>
              ))}
              {!arrivals.length && (
                <div className="empty">
                  <strong>
                    {loading
                      ? "Checking the next trains…"
                      : "No upcoming predictions available"}
                  </strong>
                  <p>
                    {missing.length
                      ? "The feed could not be loaded. We will retry automatically."
                      : "MTA has no matching predictions in the next hour. This does not confirm that service has stopped."}
                  </p>
                </div>
              )}
            </div>
            <div className="bottom-grid">
              <section className="alerts">
                <div className="section-label">03 / KNOW BEFORE YOU GO</div>
                <h3>
                  Service updates <span>{selectedAlertCount}</span>
                </h3>
                <div className="segmented">
                  <button
                    className={!planned ? "active" : ""}
                    onClick={() => setPlanned(false)}
                  >
                    Active now
                  </button>
                  <button
                    className={planned ? "active" : ""}
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
                {!alerts && !errors.alerts && <p>Loading MTA advisories…</p>}
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
                <label htmlFor="format">Alert source</label>
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
              </section>
              <section className="map-panel">
                <div className="section-label">EXPLORE NEARBY STATIONS</div>
                <h3>A view of your network</h3>
                <p className="muted">
                  Station locations · select a dot to explore
                </p>
                <svg
                  viewBox="0 0 340 260"
                  role="img"
                  aria-label="Nearby subway station locations, not a route map"
                >
                  <rect width="340" height="260" fill="#e9f0ec" />
                  <path
                    d="M0 180 Q150 20 340 90 M0 240 Q150 80 340 150"
                    fill="none"
                    stroke="#d6e5ed"
                    strokeWidth="28"
                  />
                  {station &&
                    stations
                      .filter(
                        (s) =>
                          Math.abs(s.lat - station.lat) < 0.045 &&
                          Math.abs(s.lon - station.lon) < 0.065,
                      )
                      .map((s) => (
                        <g
                          key={s.id}
                          role="button"
                          tabIndex={0}
                          aria-label={"Select " + s.name + " " + s.id}
                          onClick={() => setSelected(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected(s.id);
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
                  Geographic station view. No train locations or route geometry
                  are inferred.
                </p>
                <a className="lab-link" href="/lab/index.html">
                  <strong>Go under the hood ↗</strong>
                  <span>
                    Explore Dijkstra’s algorithm in our simulated route lab.
                  </span>
                </a>
              </section>
            </div>
          </section>
        </div>
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
