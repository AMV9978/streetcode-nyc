"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Badge from "./LineBadge";
import { SubwayMap, StationField, placesFrom, type Leg } from "./JourneyPlanner";
import { prepare, search } from "../../lib/transit/graph.js";

type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string[];
  complex: string;
};
type Network = {
  stations: Station[];
  complexes: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    routes: string[];
    stations: string[];
  }[];
  routes: { id: string; name: string; color: string; paths: number[][][] }[];
  land: { name: string; polygons: number[][][] }[];
  generatedAt: string;
  validThrough: string;
};
type GraphPayload = {
  builtAt: number;
  tripsUsed: number;
  feedsUsed: string[];
  missingFeeds: string[];
  stale?: boolean;
  edges: [string, string, string, number, number][];
  transfers: [string, string, number][];
};
type Result = {
  mode: string;
  found: boolean;
  seconds?: number;
  transfers?: number;
  hops?: number;
  expanded: number;
  relaxed: number;
  ms: number;
  order: string[];
  legs?: {
    kind: string;
    route?: string;
    from: string;
    to: string;
    stops?: string[];
    seconds: number;
    wait?: number;
  }[];
};

const ALGORITHMS: Record<
  string,
  { name: string; goal: string; color: string; big: string; idea: string }
> = {
  bfs: {
    name: "Breadth-first search",
    goal: "Fewest hops",
    color: "#7dd3fc",
    big: "O(V + E)",
    idea: "Explores in rings: every station one hop away, then two hops, and so on. It ignores minutes completely, so it happily picks a slow train that skips stops.",
  },
  dijkstra: {
    name: "Dijkstra",
    goal: "Fewest minutes",
    color: "#F6BC26",
    big: "O((V + E) log V)",
    idea: "Always expands the state with the lowest total time so far, using a binary min-heap. With no negative weights, the first time it reaches the destination is the optimum.",
  },
  astar: {
    name: "A*",
    goal: "Fewest minutes, guided",
    color: "#bcf69b",
    big: "O((V + E) log V) worst case",
    idea: "Dijkstra plus a guess of the time left: straight-line distance ÷ the fastest speed seen on any hop. The guess never overestimates, so the answer stays optimal while fewer states are explored.",
  },
  transfers: {
    name: "Fewest changes",
    goal: "Changes, then minutes",
    color: "#f0a6ff",
    big: "O((V + E) log V)",
    idea: "Dijkstra on a pair (train changes, minutes) compared in that order. One extra change always loses, however many minutes it saves.",
  },
};
const ORDER = ["bfs", "dijkstra", "astar", "transfers"];
const PRESETS = [
  { label: "Times Sq → Atlantic Av", from: "127", to: "235" },
  { label: "Van Cortlandt Park → Court Sq", from: "101", to: "G22" },
  { label: "Inwood → Coney Island", from: "A02", to: "D43" },
  { label: "Flushing → Canarsie", from: "701", to: "L29" },
];
const minutes = (s?: number) => (s === undefined ? "—" : `${Math.round(s / 60)} min`);

export default function AlgorithmLab() {
  const [network, setNetwork] = useState<Network | null>(null),
    [graph, setGraph] = useState<GraphPayload | null>(null),
    [graphError, setGraphError] = useState(""),
    [from, setFrom] = useState("127"),
    [to, setTo] = useState("235"),
    [results, setResults] = useState<Result[] | null>(null),
    [selected, setSelected] = useState("dijkstra"),
    [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [accuracy, setAccuracy] = useState<any>(null),
    [loadingGraph, setLoadingGraph] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/subway-map.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setNetwork)
      .catch(() => setGraphError("The subway map could not load."));
    fetch("/api/reliability")
      .then((r) => (r.ok ? r.json() : null))
      .then(setAccuracy)
      .catch(() => {});
  }, []);
  async function loadGraph() {
    setLoadingGraph(true);
    try {
      const r = await fetch("/api/graph");
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Live data unavailable");
      setGraph(data);
      setGraphError("");
    } catch (e) {
      setGraphError(
        e instanceof Error ? e.message : "Live subway data is unavailable.",
      );
    } finally {
      setLoadingGraph(false);
    }
  }
  useEffect(() => {
    loadGraph();
  }, []);

  const prepared = useMemo(() => {
    if (!network || !graph) return null;
    return prepare(
      {
        edges: graph.edges.map(([from, to, route, seconds, wait]) => ({
          from,
          to,
          route,
          seconds,
          wait,
        })),
        transfers: graph.transfers.map(([from, to, seconds]) => ({
          from,
          to,
          seconds,
        })),
      },
      network.stations,
    );
  }, [network, graph]);
  const places = useMemo(() => (network ? placesFrom(network) : []), [network]);
  const stationById = useMemo(
    () => Object.fromEntries((network?.stations || []).map((s) => [s.id, s])),
    [network],
  );
  const members = (id: string) =>
    network?.stations
      .filter((s) => s.complex === stationById[id]?.complex)
      .map((s) => s.id) || [];
  const placeOf = (id: string) =>
    places.find((p) => p.complex === stationById[id]?.complex);

  function run(f = from, t = to) {
    if (!prepared || !f || !t) return;
    const sources = members(f),
      targets = members(t);
    const out = ORDER.map((mode) => search(prepared, sources, targets, mode) as Result);
    setResults(out);
    setStep(0);
    setPlaying(true);
  }
  // Run the default example once the graph is ready.
  useEffect(() => {
    if (prepared && !results) run();
  }, [prepared]);

  const current = results?.find((r) => r.mode === selected);
  const order = current?.order || [];
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!playing || !order.length) return;
    const stride = Math.max(1, Math.ceil(order.length / 120));
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s + stride >= order.length) {
          setPlaying(false);
          return order.length;
        }
        return s + stride;
      });
    }, 40);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, selected, results]);

  const mapLegs: Leg[] =
    current?.found && step >= order.length
      ? (current.legs || [])
          .filter((l) => l.kind === "ride")
          .map((l) => ({
            kind: "ride",
            route: l.route,
            from: l.from,
            to: l.to,
            stops: l.stops,
          }))
      : [];
  const best = (key: "seconds" | "transfers" | "hops" | "expanded" | "relaxed" | "ms") => {
    const values = (results || [])
      .filter((r) => r.found && r[key] !== undefined)
      .map((r) => r[key] as number);
    return values.length ? Math.min(...values) : undefined;
  };
  const stationCount = prepared
    ? new Set([...prepared.out.keys(), ...prepared.links.keys()]).size
    : 0;
  const edgeCount = graph?.edges.length || 0;
  const builtAt = graph
    ? new Date(graph.builtAt * 1000).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <>
      <a className="skip-link" href="#algo-results">
        Skip to results
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
          <a href="/#planner" className="plan-nav">
            Plan a trip
          </a>
          <a href="/#live-stations">Live arrivals</a>
          <a href="/algorithms" className="active" aria-current="page">
            Algorithms
          </a>
          <a href="/lab/index.html" className="lab-nav">
            Route demo ↗
          </a>
        </nav>
        <span className="city">LEETCODE · LIVE DATA</span>
      </header>
      <main className="algo-page">
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span className="live-dot" /> FROM LEETCODE TO THE LIVE SUBWAY
            </div>
            <h1>
              Four algorithms.
              <br />
              <span>One live subway.</span>
            </h1>
            <p>
              The graph below is learned from the trains MTA is predicting
              right now: {stationCount ? `${stationCount} stations` : "every station"},{" "}
              {edgeCount ? `${edgeCount.toLocaleString()} weighted edges` : "weighted edges"}
              . Pick two stations and watch each algorithm explore it.
            </p>
          </div>
          <div className="algo-graph-card">
            <span className="eyebrow">THE GRAPH</span>
            {graph ? (
              <>
                <strong>{graph.tripsUsed.toLocaleString()} live trains</strong>
                <span>
                  Built {builtAt} ET from {graph.feedsUsed.length}/8 feeds
                  {graph.stale ? " · last good copy" : ""}
                </span>
              </>
            ) : (
              <span>{graphError || "Loading live predictions…"}</span>
            )}
            <button
              className="text-button"
              disabled={loadingGraph}
              onClick={async () => {
                await loadGraph();
              }}
            >
              {loadingGraph ? "Rebuilding…" : "Rebuild from latest data ↻"}
            </button>
          </div>
        </section>

        <section className="algo-workspace">
          <div className="algo-map">
            {network ? (
              <SubwayMap
                network={network}
                from={from}
                to={to}
                legs={mapLegs}
                onFrom={(id) => setFrom(id)}
                onTo={(id) => setTo(id)}
                heading={
                  current
                    ? `${ALGORITHMS[selected].name.toUpperCase()} · ${Math.min(step, order.length)} / ${order.length} STATIONS EXPLORED`
                    : "THE LIVE GRAPH"
                }
                highlight={{
                  ids: order.slice(0, step),
                  color: ALGORITHMS[selected].color,
                  current: order[Math.min(step, order.length) - 1],
                }}
              />
            ) : (
              <p role="status">{graphError || "Loading the subway map…"}</p>
            )}
            {current && (
              <div className="replay">
                <button
                  onClick={() => {
                    if (step >= order.length) setStep(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? "Ⅱ Pause" : step >= order.length ? "↺ Replay" : "▶ Play"}
                </button>
                <label htmlFor="replay-step" className="sr-only">
                  Exploration step
                </label>
                <input
                  id="replay-step"
                  type="range"
                  min={0}
                  max={order.length}
                  value={Math.min(step, order.length)}
                  onChange={(e) => {
                    setPlaying(false);
                    setStep(Number(e.target.value));
                  }}
                />
                <span>
                  {order[Math.min(step, order.length) - 1]
                    ? stationById[order[Math.min(step, order.length) - 1]]?.name
                    : "Start"}
                </span>
              </div>
            )}
          </div>

          <div className="trip-panel algo-controls">
            <span className="eyebrow">01 / CHOOSE TWO STATIONS</span>
            <h2>Race the algorithms</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
            >
              <StationField
                label="From"
                value={placeOf(from)}
                stations={places}
                onSelect={setFrom}
              />
              <StationField
                label="To"
                value={placeOf(to)}
                stations={places}
                onSelect={setTo}
              />
              <button
                className="find-trip"
                type="submit"
                disabled={!prepared || !from || !to}
              >
                Run all four <span>→</span>
              </button>
            </form>
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={!prepared}
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                    run(p.from, p.to);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="field-help">
              Times are expected trips: ride time plus half the current gap
              between trains when you board. For an exact live connection, use
              the{" "}
              <a href="/#planner">trip planner</a>.
            </p>
          </div>
        </section>

        <section className="algo-results" id="algo-results">
          <div className="section-label">02 / THE RESULTS</div>
          <h2>Same graph, four answers</h2>
          {!results && <p className="muted">Results appear once the graph loads.</p>}
          {results && (
            <div className="algo-table-wrap">
              <table className="algo-table">
                <caption className="sr-only">
                  Comparison of four shortest-path algorithms
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Algorithm</th>
                    <th scope="col">Optimises</th>
                    <th scope="col">Expected trip</th>
                    <th scope="col">Changes</th>
                    <th scope="col">Hops</th>
                    <th scope="col">States expanded</th>
                    <th scope="col">Edges relaxed</th>
                    <th scope="col">Run time</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const a = ALGORITHMS[r.mode];
                    const win = (k: Parameters<typeof best>[0]) =>
                      r.found && r[k] === best(k) ? "win" : "";
                    return (
                      <tr
                        key={r.mode}
                        className={selected === r.mode ? "selected" : ""}
                      >
                        <th scope="row">
                          <button
                            onClick={() => {
                              setSelected(r.mode);
                              setStep(0);
                              setPlaying(true);
                            }}
                            aria-pressed={selected === r.mode}
                          >
                            <i style={{ background: a.color }} />
                            {a.name}
                          </button>
                        </th>
                        <td>{a.goal}</td>
                        <td className={win("seconds")}>
                          {r.found ? minutes(r.seconds) : "No path"}
                        </td>
                        <td className={win("transfers")}>{r.found ? r.transfers : "—"}</td>
                        <td className={win("hops")}>{r.found ? r.hops : "—"}</td>
                        <td className={win("expanded")}>{r.expanded.toLocaleString()}</td>
                        <td className={win("relaxed")}>{r.relaxed.toLocaleString()}</td>
                        <td>{r.ms.toFixed(1)} ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {current?.found && (
            <div className="algo-route">
              <h3>
                {ALGORITHMS[selected].name}’s route ·{" "}
                {minutes(current.seconds)}
              </h3>
              <ol className="itinerary">
                {(current.legs || []).map((l, i) =>
                  l.kind === "ride" ? (
                    <li key={i} className="ride-step">
                      <div className="leg-marker">
                        <Badge route={l.route!} />
                      </div>
                      <div>
                        <strong>
                          {stationById[l.from]?.name} → {stationById[l.to]?.name}
                        </strong>
                        <small>
                          {(l.stops?.length || 2) - 1} stops ·{" "}
                          {Math.round(l.seconds / 60)} min riding
                          {l.wait ? ` · about ${Math.round(l.wait / 60)} min wait` : ""}
                        </small>
                      </div>
                    </li>
                  ) : (
                    <li key={i} className="transfer-step">
                      <span className="walk-marker">⇄</span>
                      <div>
                        <strong>Walk to {stationById[l.to]?.name}</strong>
                        <small>{Math.ceil(l.seconds / 60)} min</small>
                      </div>
                    </li>
                  ),
                )}
              </ol>
            </div>
          )}
        </section>

        <section className="algo-explain">
          <div className="section-label">03 / HOW EACH ONE THINKS</div>
          <div className="algo-cards">
            {ORDER.map((m) => (
              <article key={m} style={{ borderTopColor: ALGORITHMS[m].color }}>
                <h3>{ALGORITHMS[m].name}</h3>
                <code>{ALGORITHMS[m].big}</code>
                <p>{ALGORITHMS[m].idea}</p>
              </article>
            ))}
            <article style={{ borderTopColor: "#ffffff" }}>
              <h3>Why the state is (station, line)</h3>
              <code>V ≈ stations × lines</code>
              <p>
                Staying on the 4 at 86 St is free; switching to the 6 there
                costs a transfer and a wait. A search that only remembers the
                station would merge those two situations and could return a
                route that is not actually the fastest.
              </p>
            </article>
            <article style={{ borderTopColor: "#ff8a65" }}>
              <h3>The live trip planner: RAPTOR</h3>
              <code>O(rounds × trains × stops)</code>
              <p>
                The real planner works on individual trains, not averages.
                Round k finds the earliest arrival using at most k trains, which
                gives a set of trade-offs between speed and train changes. Tests
                check it against an independent search on 3,000 random
                networks.
              </p>
            </article>
          </div>
        </section>

        <section className="algo-accuracy">
          <div className="section-label">04 / HOW GOOD ARE COUNTDOWNS?</div>
          <h2>Prediction accuracy, measured by this site</h2>
          <p>
            Each time the site refreshes a feed, it remembers what every
            countdown said. When a train leaves a stop, we compare what was
            shown 1, 3, 5, 10 and 20 minutes earlier with when it really
            arrived. Only trains watched without gaps are scored, and the
            numbers reset when the server restarts.
          </p>
          {accuracy?.trainsScored ? (
            <div className="algo-table-wrap">
              <table className="algo-table accuracy-table">
                <caption className="sr-only">
                  Share of countdowns within one minute, by line and lead time
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    {accuracy.buckets.map((b: string) => (
                      <th scope="col" key={b}>
                        {b} min out
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(accuracy.lines)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([line, buckets]: [string, any]) => (
                      <tr key={line}>
                        <th scope="row">
                          <Badge route={line} />
                        </th>
                        {accuracy.buckets.map((b: string) => {
                          const v = buckets[b];
                          return (
                            <td key={b}>
                              {v && v.n >= 5 ? (
                                <>
                                  <strong>{Math.round(v.withinOneMinute * 100)}%</strong>
                                  <small>
                                    ±{Math.round(v.meanAbsSeconds / 6) / 10} min · n={v.n}
                                  </small>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="field-help">
                Percent of trains that arrived within one minute of the
                countdown; ± is the average miss. {accuracy.trainsScored.toLocaleString()} trains
                scored since{" "}
                {new Date(accuracy.since * 1000).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                ET.
              </p>
            </div>
          ) : (
            <p className="muted">
              Not enough trains observed yet. Numbers appear after the site has
              watched trains arrive for a few minutes while people are using
              it.
            </p>
          )}
        </section>
        <footer>
          <span>StreetCode NYC · Built as a group learning project</span>
          <a href="https://www.mta.info" target="_blank" rel="noreferrer">
            Official MTA information ↗
          </a>
          <span>Expected times are estimates. Not affiliated with the MTA.</span>
        </footer>
      </main>
    </>
  );
}
