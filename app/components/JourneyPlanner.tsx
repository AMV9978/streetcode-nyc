"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Badge from "./LineBadge";
import { nearbyStations } from "../../lib/transit/nearby.js";
import { lineColor } from "../../lib/transit/lines";

type Station = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string[];
  complex: string;
};
type Complex = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string[];
  stations: string[];
};
type Route = { id: string; name: string; color: string; paths: number[][][] };
type Network = {
  stations: Station[];
  complexes: Complex[];
  routes: Route[];
  land: { name: string; polygons: number[][][] }[];
  generatedAt: string;
  validThrough: string;
};
type Leg = {
  kind: string;
  route?: string;
  from: string;
  to: string;
  fromStop?: string;
  departure?: number;
  arrival?: number;
  seconds?: number;
  stops?: string[];
};
type Journey = {
  found: boolean;
  sameStation?: boolean;
  walkOnly?: boolean;
  legs: Leg[];
  arrival?: number;
  departure?: number;
  transfers?: number;
  checkedAt: number;
  timestamp: number;
  missingFeeds: string[];
  advisories: { id: string; title: string; description: string }[];
  alertsAvailable: boolean;
  feedsChecked: number;
};
const project = (lon: number, lat: number) => [
  (lon + 74.27) * 2100,
  (40.94 - lat) * 2800,
];
const xy = (s: { lon: number; lat: number }) => project(s.lon, s.lat);
const path = (points: number[][]) =>
  points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${project(p[0], p[1])
          .map((n) => n.toFixed(1))
          .join(",")}`,
    )
    .join(" ");
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bsquare\b/g, "sq")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "av")
    .replace(/[^a-z0-9]/g, "");
const time = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });

function StationField({
  label,
  value,
  stations,
  onSelect,
}: {
  label: string;
  value: Station | undefined;
  stations: Station[];
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const id = label === "From" ? "journey-from" : "journey-to";
  const results = stations
    .filter((s) => normalize(s.name).includes(normalize(query)))
    .slice(0, 8);
  const choose = (s: Station) => {
    onSelect(s.id);
    setQuery("");
    setOpen(false);
  };
  return (
    <div
      className="station-field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>
        <span
          className={"endpoint-dot " + (label === "From" ? "start" : "end")}
        >
          {label === "From" ? "A" : "B"}
        </span>
        {label}
      </label>
      <div className="field-input">
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id + "-options"}
          aria-activedescendant={
            open && results[active] ? id + "-" + active : undefined
          }
          autoComplete="off"
          placeholder={
            label === "From" ? "Starting station" : "Where do you want to go?"
          }
          value={open ? query : value?.name || ""}
          onFocus={() => {
            setQuery("");
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            onSelect("");
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && open && results[active]) {
              e.preventDefault();
              choose(results[active]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {value && !open && (
          <span className="field-badges">
            {value.routes.map((r) => (
              <Badge key={r} route={r} />
            ))}
          </span>
        )}
      </div>
      {open && (
        <div
          className="station-options"
          id={id + "-options"}
          role="listbox"
          aria-label={label + " station options"}
        >
          {results.map((s, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              id={id + "-" + i}
              key={s.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              <span>{s.name}</span>
              <span className="badges">
                {s.routes.map((r) => (
                  <Badge route={r} key={r} />
                ))}
              </span>
            </button>
          ))}
          {!results.length && (
            <p>No matching stations. Try a different name.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SubwayMap({
  network,
  from,
  to,
  legs,
  onFrom,
  onTo,
  onArrivals,
}: {
  network: Network;
  from: string;
  to: string;
  legs: Leg[];
  onFrom: (id: string) => void;
  onTo: (id: string) => void;
  onArrivals: (id: string, direction?: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    wrapper = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(
      null,
    );
  const [size, setSize] = useState({ w: 900, h: 650 }),
    [camera, setCamera] = useState({ x: 680, y: 520, z: 0.85 }),
    [line, setLine] = useState("All"),
    [picked, setPicked] = useState(""),
    [platform, setPlatform] = useState("");
  const stations = useMemo(
    () => Object.fromEntries(network.stations.map((s) => [s.id, s])),
    [network],
  );
  const firstSelection = useRef(true);
  const selected = network.complexes.find((s) => s.id === picked);
  useEffect(() => {
    if (!wrapper.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  const fit = (points: number[][]) => {
    if (!points.length) return;
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    setCamera({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: Math.max(
        0.3,
        Math.min(4, size.w / (maxX - minX + 180), size.h / (maxY - minY + 180)),
      ),
    });
  };
  useEffect(() => {
    const points = [stations[from], stations[to]].filter(Boolean).map(xy);
    if (points.length === 2) fit(points);
    else if (points.length === 1 && !firstSelection.current)
      setCamera({ x: points[0][0], y: points[0][1], z: 2.4 });
    firstSelection.current = false;
  }, [from, to]);
  const zoom = (factor: number) =>
    setCamera((c) => ({ ...c, z: Math.max(0.3, Math.min(7, c.z * factor)) }));
  const view = [
    camera.x - size.w / (2 * camera.z),
    camera.y - size.h / (2 * camera.z),
    size.w / camera.z,
    size.h / camera.z,
  ];
  const ridePaths = useMemo(
    () =>
      legs
        .filter((l) => l.kind === "ride")
        .map((leg, index) => {
          const stops = (leg.stops || [])
            .map((id) => stations[id])
            .filter(Boolean);
          const route = network.routes.find((r) => r.id === leg.route);
          // Pick a source shape that follows the observed stops in a consistent order.
          let best: { score: number; points: number[][] } | null = null;
          for (const geometry of route?.paths || []) {
            const indices = stops.map((s) => {
              let bestI = 0,
                bestD = Infinity;
              geometry.forEach((p, i) => {
                const d = (p[0] - s.lon) ** 2 + (p[1] - s.lat) ** 2;
                if (d < bestD) {
                  bestD = d;
                  bestI = i;
                }
              });
              return { i: bestI, d: bestD };
            });
            if (indices.length < 2) continue;
            const increasing = indices[indices.length - 1].i >= indices[0].i;
            if (
              indices.some(
                (p, i) =>
                  i > 0 &&
                  (increasing
                    ? p.i < indices[i - 1].i
                    : p.i > indices[i - 1].i),
              )
            )
              continue;
            const score = indices.reduce((a, p) => a + p.d, 0);
            if (score / (indices.length || 1) > 0.000025) continue;
            const a = indices[0].i,
              b = indices[indices.length - 1].i;
            const points = geometry.slice(Math.min(a, b), Math.max(a, b) + 1);
            if (!best || score < best.score)
              best = { score, points: increasing ? points : points.reverse() };
          }
          return {
            id: index,
            route: leg.route || "",
            d: path(best?.points || stops.map((s) => [s.lon, s.lat])),
          };
        }),
    [legs, network, stations],
  );
  const choose = (s: Complex) => {
    setPicked(s.id);
    setPlatform(
      s.stations.find(
        (id) => line !== "All" && stations[id]?.routes.includes(line),
      ) || s.stations[0],
    );
  };
  const mapLabel = (s: Complex) =>
    (s.stations.includes(from)
      ? stations[from]?.name
      : s.stations.includes(to)
        ? stations[to]?.name
        : "") || s.name.split(" / ")[0];
  // Keep labels legible at every viewport size; station buttons remain available.
  const labels = useMemo(() => {
    const visible = new Set<string>();
    if (camera.z <= 1.8) return visible;
    const occupied: number[][] = [[size.w - 76, 0, size.w, 165]];
    const ordered = [...network.complexes].sort((a, b) => {
      const priority = (s: Complex) =>
        (s.id === picked ? 100 : 0) +
        (s.stations.includes(from) || s.stations.includes(to) ? 50 : 0) +
        s.routes.length;
      return priority(b) - priority(a);
    });
    for (const s of ordered) {
      if (line !== "All" && !s.routes.includes(line)) continue;
      const [mx, my] = xy(s),
        x = (mx - camera.x) * camera.z + size.w / 2 + 8,
        y = (my - camera.y) * camera.z + size.h / 2;
      const name = mapLabel(s);
      const box = [x, y - 10, x + Math.min(name.length, 29) * 5.8 + 6, y + 7];
      if (
        box[0] < 0 ||
        box[2] > size.w - 4 ||
        box[1] < 5 ||
        box[3] > size.h - 40
      )
        continue;
      if (
        occupied.some(
          (b) =>
            box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
        )
      )
        continue;
      occupied.push(box);
      visible.add(s.id);
    }
    return visible;
  }, [network, camera, size, line, picked, from, to]);
  const routeButtons = network.routes.filter((r) => !r.id.endsWith("X"));
  return (
    <div className="network-map">
      <div className="map-topline">
        <div>
          <span className="live-dot" /> THE SUBWAY, CONNECTED
        </div>
        <span>Tap a station to begin</span>
      </div>
      <div className="map-canvas" ref={wrapper} id="subway-map">
        <svg
          ref={svg}
          viewBox={view.join(" ")}
          role="group"
          aria-label="Interactive NYC subway map. Drag to pan. Use the zoom buttons or plus and minus keys. Search fields provide an alternative to the map."
          tabIndex={0}
          onPointerDown={(e) => {
            if ((e.target as Element).closest("[data-station]")) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              cx: camera.x,
              cy: camera.y,
            };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setCamera((c) => ({
              ...c,
              x: drag.current!.cx - (e.clientX - drag.current!.x) / c.z,
              y: drag.current!.cy - (e.clientY - drag.current!.y) / c.z,
            }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onDoubleClick={() => zoom(1.5)}
          onKeyDown={(e) => {
            if (e.key === "+" || e.key === "=") {
              e.preventDefault();
              zoom(1.3);
            }
            if (e.key === "-") {
              e.preventDefault();
              zoom(1 / 1.3);
            }
            if (
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              setCamera((c) => ({
                ...c,
                x:
                  c.x +
                  (e.key === "ArrowRight"
                    ? 80
                    : e.key === "ArrowLeft"
                      ? -80
                      : 0) /
                    c.z,
                y:
                  c.y +
                  (e.key === "ArrowDown" ? 80 : e.key === "ArrowUp" ? -80 : 0) /
                    c.z,
              }));
            }
          }}
        >
          <rect
            x="-6000"
            y="-6000"
            width="12000"
            height="12000"
            fill="#0b1825"
          />
          {network.land.map((b) => (
            <path
              key={b.name}
              d={b.polygons.map((r) => path(r) + "Z").join(" ")}
              fillRule="evenodd"
              fill="#172333"
              stroke="#2a3a4d"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[
            ["MANHATTAN", -73.969, 40.788],
            ["BROOKLYN", -73.966, 40.65],
            ["QUEENS", -73.84, 40.735],
            ["THE BRONX", -73.865, 40.861],
            ["STATEN ISLAND", -74.15, 40.585],
          ].map(([name, lon, lat]) => (
            <text
              key={name}
              x={project(Number(lon), Number(lat))[0]}
              y={project(Number(lon), Number(lat))[1]}
              className="borough-label"
              textAnchor="middle"
              fontSize={13 / camera.z}
              letterSpacing={3 / camera.z}
            >
              {name}
            </text>
          ))}
          {network.routes.map((r) => (
            <g
              key={r.id}
              opacity={
                line !== "All" &&
                line !== r.id?.replace(/X$/, "")?.replace("SIR", "SI")?.trim()
                  ? 0.1
                  : ridePaths.length
                    ? 0.22
                    : 0.85
              }
            >
              {r.paths.map((p, i) => (
                <path
                  key={i}
                  d={path(p)}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={line === r.id ? 4 : 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ))}
          {ridePaths.map((p) => (
            <g key={p.id}>
              <path
                d={p.d}
                fill="none"
                stroke="#08111d"
                strokeWidth="9"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={p.d}
                fill="none"
                stroke={lineColor(p.route)}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {network.complexes.map((s) => {
            const [x, y] = xy(s),
              isPicked = s.id === picked,
              dim = line !== "All" && !s.routes.includes(line),
              isEndpoint = s.stations.includes(from) || s.stations.includes(to);
            return (
              <g
                key={s.id}
                data-station={s.id}
                role="button"
                aria-label={
                  "Select " + s.name + ", lines " + s.routes.join(", ")
                }
                tabIndex={isPicked ? 0 : -1}
                onClick={() => choose(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choose(s);
                  }
                }}
                opacity={dim && !isEndpoint ? 0.15 : 1}
              >
                <circle cx={x} cy={y} r={10 / camera.z} fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={
                    (isPicked ? 6 : s.stations.length > 1 ? 4.5 : 3) / camera.z
                  }
                  fill={isPicked ? "#F6BC26" : "#edf3fa"}
                  stroke="#0e1928"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                {labels.has(s.id) && !dim && (
                  <text
                    x={x + 8 / camera.z}
                    y={y + 3 / camera.z}
                    fontSize={10 / camera.z}
                    className="station-map-label"
                  >
                    {mapLabel(s).length > 29
                      ? mapLabel(s).slice(0, 26) + "…"
                      : mapLabel(s)}
                  </text>
                )}
                <title>
                  {s.name} · {s.routes.join(" ")}
                </title>
              </g>
            );
          })}
          {[
            { id: from, letter: "A", color: "#ffffff" },
            { id: to, letter: "B", color: "#F6BC26" },
          ]
            .filter((p) => stations[p.id])
            .map((p) => {
              const [x, y] = xy(stations[p.id]);
              return (
                <g key={p.letter} pointerEvents="none">
                  <circle
                    cx={x}
                    cy={y}
                    r={16 / camera.z}
                    fill={p.color}
                    stroke="#080e17"
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={x}
                    y={y + 5 / camera.z}
                    textAnchor="middle"
                    fontSize={14 / camera.z}
                    fontWeight="900"
                    fill="#080e17"
                  >
                    {p.letter}
                  </text>
                </g>
              );
            })}
        </svg>
        <div className="map-controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.4)}>
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.4)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Fit all subway stations"
            title="Show the entire network"
            onClick={() => fit(network.stations.map(xy))}
          >
            ↗
          </button>
        </div>
        <div className="map-hint">Drag to explore · + / − to zoom</div>
        {selected && (
          <div
            className="map-station-card"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPicked("");
            }}
          >
            <button
              className="map-close"
              aria-label="Close station details"
              onClick={() => setPicked("")}
            >
              ×
            </button>
            <span className="eyebrow">SELECTED STATION</span>
            <h3>{stations[platform]?.name || selected.name}</h3>
            <div className="badges">
              {(stations[platform]?.routes || selected.routes).map((r) => (
                <Badge key={r} route={r} />
              ))}
            </div>
            {selected.stations.length > 1 && (
              <>
                <label htmlFor="map-platform">Choose a platform / line</label>
                <select
                  id="map-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                >
                  {selected.stations.map((id) => (
                    <option key={id} value={id}>
                      {stations[id]?.name} · {stations[id]?.routes.join(" ")}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="map-station-actions">
              <button
                onClick={() => {
                  onFrom(platform);
                  setPicked("");
                }}
              >
                A · Start here
              </button>
              <button
                onClick={() => {
                  onTo(platform);
                  setPicked("");
                }}
              >
                B · Go here
              </button>
            </div>
            <button
              className="text-button"
              onClick={() => onArrivals(platform)}
            >
              See live arrivals ↗
            </button>
          </div>
        )}
      </div>
      <div className="line-filter" aria-label="Map line filters">
        <button
          aria-pressed={line === "All"}
          className={line === "All" ? "chosen" : ""}
          onClick={() => setLine("All")}
        >
          All lines
        </button>
        {routeButtons.map((r) => (
          <button
            key={r.id}
            aria-label={`Show ${r.id} line on map`}
            aria-pressed={line === r.id}
            className={line === r.id ? "chosen" : ""}
            onClick={() => setLine(line === r.id ? "All" : r.id)}
          >
            <Badge route={r.id} />
          </button>
        ))}
      </div>
      <div className="map-attribution">
        Original map · MTA route geometry · NYC Department of City Planning
        boundaries
        <span>Track shapes are a reference, not live train positions.</span>
      </div>
    </div>
  );
}

function NearbyStops({
  network,
  from,
  to,
  onChoose,
}: {
  network: Network;
  from: string;
  to: string;
  onChoose: (id: string, target: string) => void;
}) {
  const [reference, setReference] = useState("from"),
    [location, setLocation] = useState<{
      lat: number;
      lon: number;
      accuracy: number;
    } | null>(null),
    [message, setMessage] = useState(""),
    [locating, setLocating] = useState(false),
    [open, setOpen] = useState(false);
  const anchor =
    reference === "location"
      ? location
      : network.stations.find((s) => s.id === (reference === "to" ? to : from));
  const candidates = nearbyStations(network.stations, anchor, {
    radius: reference === "location" ? 3000 : 1500,
    limit: 5,
    excludeComplex:
      reference === "location" ? "" : (anchor as Station)?.complex,
  });
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  function locate() {
    setOpen(true);
    if (!navigator.geolocation) {
      setMessage(
        "Location is unavailable in this browser. Choose a station or use the map.",
      );
      return;
    }
    setLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setReference("location");
        setLocating(false);
        if (position.coords.accuracy > 200)
          setMessage(
            "Your location is approximate. Check these stations on the map before choosing.",
          );
      },
      () => {
        setLocating(false);
        setMessage(
          "We could not get your location. You can still choose a station or explore the map.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <details
      className="nearby-stops"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Is there a closer station? <span>Explore nearby ↗</span>
      </summary>
      <div className="nearby-tools">
        <label htmlFor="nearby-reference">Look around</label>
        <select
          id="nearby-reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        >
          <option value="from">Starting station</option>
          <option value="to" disabled={!to}>
            Destination station
          </option>
          {location && <option value="location">My location</option>}
        </select>
        <button type="button" onClick={locate} disabled={locating}>
          {locating ? "Finding you…" : "◎ Use my location"}
        </button>
      </div>
      <p className="field-help">
        Distances are in a straight line to station coordinates, not entrances
        or walking routes. Location stays in this browser.
      </p>
      {message && (
        <p className="warning" role="status">
          {message}
        </p>
      )}
      {!anchor && <p>Choose a station first, or use your location.</p>}
      {anchor && !candidates.length && (
        <p>
          No other subway stations found within{" "}
          {reference === "location" ? "3 km" : "1.5 km"}. Explore the map to
          look farther away.
        </p>
      )}
      <div className="nearby-list">
        {candidates.map((s: Station & { meters: number }) => {
          const members = network.stations.filter(
            (n) => n.complex === s.complex,
          );
          const id = platforms[s.complex] || s.id;
          const chosen = members.find((n) => n.id === id) || s;
          return (
            <div className="nearby-stop" key={s.complex}>
              <div>
                <strong>{s.name}</strong>
                <small>About {Math.round(s.meters / 10) * 10} m away</small>
              </div>
              <div className="badges">
                {chosen.routes.map((r) => (
                  <Badge key={r} route={r} />
                ))}
              </div>
              {members.length > 1 && (
                <select
                  aria-label={`Platform at ${s.name}`}
                  value={id}
                  onChange={(e) =>
                    setPlatforms((p) => ({ ...p, [s.complex]: e.target.value }))
                  }
                >
                  {members.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} · {n.routes.join(" ")}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => {
                  onChoose(id, reference === "to" ? "to" : "from");
                  setOpen(false);
                }}
              >
                {reference === "to" ? "Use as destination" : "Start from here"}{" "}
                →
              </button>
            </div>
          );
        })}
      </div>
      <p className="field-help">
        After choosing, set enough time to reach the platform and compare the
        new trip. A closer station does not always mean an earlier arrival.
      </p>
    </details>
  );
}

export default function JourneyPlanner({
  initialStation,
  onArrivals,
}: {
  initialStation: string;
  onArrivals: (id: string, direction?: string) => void;
}) {
  const [network, setNetwork] = useState<Network | null>(null),
    [networkError, setNetworkError] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [result, setResult] = useState<Journey | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [submitted, setSubmitted] = useState<{
      from: string;
      to: string;
      version: number;
      readyIn: number;
    } | null>(null),
    [now, setNow] = useState(0),
    [retry, setRetry] = useState(0),
    [readyIn, setReadyIn] = useState(3);
  useEffect(() => {
    const controller = new AbortController();
    setNetworkError(false);
    fetch("/subway-map.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setNetwork)
      .catch((e) => {
        if (e.name !== "AbortError") setNetworkError(true);
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (network && !from && !submitted) {
      setFrom(
        network.stations.some((s) => s.id === initialStation)
          ? initialStation
          : "127",
      );
    }
  }, [network]);
  useEffect(() => {
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const stationById = useMemo(
    () => Object.fromEntries((network?.stations || []).map((s) => [s.id, s])),
    [network],
  );
  const updateFrom = (id: string) => {
    setFrom(id);
    setSubmitted(null);
    setResult(null);
    setError("");
  };
  const updateTo = (id: string) => {
    setTo(id);
    if (id && window.matchMedia("(max-width:850px)").matches)
      document
        .getElementById("journey-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSubmitted(null);
    setResult(null);
    setError("");
  };
  useEffect(() => {
    setLoading(false);
    if (!submitted) return;
    const controller = new AbortController();
    let stopped = false,
      busy = false,
      timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (stopped || busy) return;
      if (document.hidden) {
        timer = setTimeout(refresh, 30000);
        return;
      }
      if (!navigator.onLine) {
        setError("You’re offline. Reconnect to update this trip.");
        timer = setTimeout(refresh, 30000);
        return;
      }
      busy = true;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/journey?from=${encodeURIComponent(submitted!.from)}&to=${encodeURIComponent(submitted!.to)}&readyIn=${submitted!.readyIn}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30000),
            ]),
          },
        );
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || "Trip search is temporarily unavailable.");
        if (!stopped) {
          setResult(data);
          setError("");
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error && e.name !== "TimeoutError"
              ? e.message
              : "MTA is taking longer than usual. We’ll try again.",
          );
      } finally {
        busy = false;
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(refresh, 30000);
        }
      }
    }
    const resume = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        refresh();
      }
    };
    refresh();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [submitted]);
  if (!network)
    return (
      <section className="planner-loading" id="planner" role="status">
        <h2>
          {networkError
            ? "The map could not load"
            : "Loading the subway network…"}
        </h2>
        <p>Live station arrivals are available below.</p>
        {networkError && (
          <button onClick={() => setRetry((n) => n + 1)}>Try map again</button>
        )}
      </section>
    );
  const stale = !!result && (now - result.timestamp > 90 || !!error),
    rideLegs = result?.legs.filter((l) => l.kind === "ride") || [];
  return (
    <section
      id="planner"
      className="journey-workspace"
      aria-label="Subway map and trip planner"
    >
      <SubwayMap
        network={network}
        from={from}
        to={to}
        legs={result && !stale ? result.legs : []}
        onFrom={updateFrom}
        onTo={updateTo}
        onArrivals={onArrivals}
      />
      <div className="trip-panel" id="journey-form">
        <div className="trip-heading">
          <div>
            <span className="eyebrow">A BETTER WAY THROUGH NYC</span>
            <h2>Where to?</h2>
          </div>
          <span className="journey-symbol">↗</span>
        </div>
        <p className="trip-subtitle">
          Search below, or <a href="#subway-map">choose on the map ↓</a>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to)
              setSubmitted({ from, to, readyIn, version: Date.now() });
          }}
        >
          <StationField
            label="From"
            value={stationById[from]}
            stations={network.stations}
            onSelect={updateFrom}
          />
          <button
            type="button"
            className="swap-stations"
            aria-label="Swap starting station and destination"
            disabled={!from || !to}
            onClick={() => {
              const old = from;
              updateFrom(to);
              updateTo(old);
            }}
          >
            ⇅
          </button>
          <StationField
            label="To"
            value={stationById[to]}
            stations={network.stations}
            onSelect={updateTo}
          />
          <div className="ready-setting">
            <label htmlFor="ready-in">Time to reach the platform</label>
            <select
              id="ready-in"
              value={readyIn}
              onChange={(e) => {
                setReadyIn(Number(e.target.value));
                setSubmitted(null);
                setResult(null);
                setError("");
              }}
            >
              {[1, 3, 5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "minute" : "minutes"}
                </option>
              ))}
            </select>
          </div>
          <p className="field-help">
            Same name, different lines? Choose the platform you’ll use.
          </p>
          <button
            className="find-trip"
            type="submit"
            disabled={!from || !to || loading}
          >
            {loading ? "Checking live trains…" : "Find quickest trip"}
            <span>→</span>
          </button>
        </form>
        <NearbyStops
          network={network}
          from={from}
          to={to}
          onChoose={(id, target) => {
            if (target === "to") updateTo(id);
            else updateFrom(id);
          }}
        />
        <div className="trip-results" aria-live="polite" aria-busy={loading}>
          {error && <p className="warning">{error}</p>}
          {!submitted && (
            <div className="trip-empty">
              <span className="trip-empty-icon">
                A <span>···</span> B
              </span>
              <h3>Your journey starts here.</h3>
              <p>
                Compare currently reported trains to find the earliest predicted
                arrival between your chosen stations.
              </p>
              <div className="trip-features">
                <span>◷ Live predictions</span>
                <span>⇄ Transfer guidance</span>
              </div>
            </div>
          )}
          {loading && !result && (
            <div className="trip-empty">
              <div className="loading-track" />
              <h3>Finding your connection</h3>
              <p>Checking the subway feeds for trains and transfer times.</p>
            </div>
          )}
          {result?.sameStation && (
            <div className="trip-empty">
              <h3>You’re already there.</h3>
              <p>
                Your start and destination are the same station. Choose another
                destination to plan a trip.
              </p>
            </div>
          )}
          {result && !result.found && (
            <div className="trip-empty">
              <h3>No connection found in the next hour.</h3>
              <p>
                Some trains or later stops may not have predictions yet. This
                does not mean service has stopped. Try another platform or check
                the official planner.
              </p>
              <a href="https://www.mta.info" target="_blank" rel="noreferrer">
                Check MTA travel information ↗
              </a>
            </div>
          )}
          {result?.found && !result.sameStation && (
            <>
              <div className="trip-result-heading">
                <div>
                  <span className="eyebrow">
                    {stale ? "NEEDS A FRESH CHECK" : "QUICKEST PREDICTED TRIP"}
                  </span>
                  <strong>
                    {Math.max(
                      0,
                      Math.ceil(
                        ((result.arrival || now) - result.checkedAt) / 60,
                      ),
                    )}
                    <small> min</small>
                  </strong>
                </div>
                <span className="trip-arrival">
                  Arrive around
                  <br />
                  <b>{time(result.arrival || now)} ET</b>
                </span>
              </div>
              <p className="trip-summary">
                {result.walkOnly
                  ? "Walk within the station complex"
                  : `${result.transfers ? `${result.transfers} train ${result.transfers === 1 ? "change" : "changes"}` : "No train changes"} · Includes waiting and transfer time`}
              </p>
              <div className="trip-lines">
                {rideLegs.map((l, i) => (
                  <span key={i}>
                    {i > 0 && <span className="route-arrow">→</span>}
                    <Badge route={l.route!} />
                  </span>
                ))}
              </div>
              {stale && (
                <p className="warning">
                  These trip details may be out of date. Wait for the next
                  successful update before relying on them.
                </p>
              )}
              <ol className="itinerary">
                {result.legs.map((leg, i) => (
                  <li
                    key={i}
                    className={
                      leg.kind === "ride" ? "ride-step" : "transfer-step"
                    }
                    style={
                      {
                        "--route-color": lineColor(leg.route || ""),
                      } as React.CSSProperties
                    }
                  >
                    {leg.kind === "ride" ? (
                      <>
                        <div className="leg-marker">
                          <Badge route={leg.route!} />
                        </div>
                        <div>
                          <strong>
                            Take the {leg.route?.replace(/X$/, "")} train
                          </strong>
                          <p>
                            {stationById[leg.from]?.name} →{" "}
                            {stationById[leg.to]?.name}
                          </p>
                          <small>
                            {time(leg.departure!)}–{time(leg.arrival!)} ET ·{" "}
                            {leg.fromStop?.endsWith("N")
                              ? "Northbound"
                              : "Southbound"}
                          </small>
                          <details>
                            <summary>
                              {Math.max(1, (leg.stops?.length || 2) - 1)}{" "}
                              predicted{" "}
                              {leg.stops?.length === 2 ? "stop" : "stops"}
                            </summary>
                            <ul>
                              {leg.stops?.slice(1).map((id, j) => (
                                <li key={j}>{stationById[id]?.name || id}</li>
                              ))}
                            </ul>
                          </details>
                          <button
                            className="text-button"
                            onClick={() =>
                              onArrivals(leg.from, leg.fromStop?.slice(-1))
                            }
                          >
                            Check this platform’s arrivals ↗
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="walk-marker">⇄</span>
                        <div>
                          <strong>
                            {leg.from === leg.to
                              ? "Change trains"
                              : `Walk to ${stationById[leg.to]?.name}`}
                          </strong>
                          <small>
                            Allow at least {Math.ceil((leg.seconds || 0) / 60)}{" "}
                            min{leg.from === leg.to ? " on this transfer" : ""}
                          </small>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
          {result && (
            <div className="journey-status">
              <span className={stale ? "status-dot-warning" : "live-dot"} />
              {loading
                ? "Updating trip…"
                : `Checked ${time(result.checkedAt)} ET · ${result.feedsChecked}/8 feeds`}
              <p>Refreshes automatically while this page is visible.</p>
            </div>
          )}
          {!!result?.missingFeeds.length && (
            <p className="warning">
              Some subway feeds are unavailable. This trip search may miss other
              options.
            </p>
          )}
          {result && !result.alertsAvailable && (
            <p className="warning">
              Service advisories could not be verified. Check MTA before
              traveling.
            </p>
          )}
          {!!result?.advisories.length && (
            <div className="journey-advisories">
              <h3>On your lines</h3>
              {result.advisories.slice(0, 5).map((a) => (
                <details key={a.id}>
                  <summary>{a.title}</summary>
                  <p>{a.description || "Check MTA for more details."}</p>
                </details>
              ))}
            </div>
          )}
        </div>
        <details className="trip-explainer">
          <summary>How this trip estimate works</summary>
          <p>
            Searches currently reported trains within the next hour. It allows
            your selected time to reach the platform and at least two minutes to
            change trains, with longer times where MTA’s transfer data requires
            them. Allow extra time if you need it.
          </p>
          <p>
            Choose enough time to walk to the station and reach the platform. We
            do not calculate street walking routes. “Quickest” means the
            earliest arrival found in available predictions, not a guarantee
            across all services. Service alerts are shown but are not
            automatically translated into closed tracks. This is not an
            accessibility route planner. Check station signs and MTA advice
            before boarding.
          </p>
          <p>
            Map and transfer reference imported{" "}
            {new Date(network.generatedAt).toLocaleDateString("en-US", {
              timeZone: "America/New_York",
            })}
            . Static track geometry may not show temporary reroutes.
          </p>
        </details>
      </div>
    </section>
  );
}
