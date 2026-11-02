import { stations, edges, lines, scenarios } from "./network.js";
import { route, reprice } from "./router.js";
const $ = (id) => document.getElementById(id),
  network = { stations, edges },
  names = new Map(stations.map((s) => [s.id, s.name]));
let current,
  baseline,
  traceIndex = 0,
  favorites = [];
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
for (const s of stations) {
  for (const id of ["origin", "destination"])
    $(id).add(new Option(s.name, s.id));
}
for (const [id, s] of Object.entries(scenarios))
  $("scenario").add(new Option(s.name, id));
function settings() {
  return {
    origin: $("origin").value,
    destination: $("destination").value,
    scenario: $("scenario").value,
    stepFree: $("stepfree").checked,
    transferPenalty: Number($("preference").value),
  };
}
function solve() {
  const s = settings();
  current = route(network, s.origin, s.destination, {
    scenario: scenarios[s.scenario],
    stepFree: s.stepFree,
    transferPenalty: s.transferPenalty,
  });
  baseline = route(network, s.origin, s.destination, {
    scenario: scenarios.normal,
    stepFree: s.stepFree,
    transferPenalty: s.transferPenalty,
  });
  traceIndex = 0;
  $("scenario-description").textContent = scenarios[s.scenario].description;
  renderResults();
  renderMap();
  renderTrace();
}
function badge(line) {
  return `<span class="badge" style="background:${lines[line].color}">${line}</span>`;
}
function renderResults() {
  if (!current.found) {
    $("results").innerHTML =
      `<h2>No available route</h2><p class="error">${current.reason}</p><p class="hint">Try normal service, another station, or turn off the step-free model. A disconnected model does not mean no real-world journey exists.</p>`;
    return;
  }
  const s = settings(),
    kept = reprice(network, baseline, {
      scenario: scenarios[s.scenario],
      stepFree: s.stepFree,
      transferPenalty: s.transferPenalty,
    }),
    change = baseline.found ? current.minutes - baseline.minutes : null;
  let delta =
    change === null
      ? "No normal-service route under these constraints."
      : change === 0
        ? "Same modeled duration as normal service."
        : `${change > 0 ? "+" : ""}${change} min versus normal service (${baseline.minutes} min).`;
  const counterfactual =
    s.scenario === "normal"
      ? ""
      : kept
        ? `Keeping the normal-service itinerary would take ${kept.minutes} min. This choice avoids ${kept.minutes - current.minutes} modeled minutes.`
        : "The normal-service itinerary is unavailable under these conditions.";
  const unique = current.legs
    .filter((e, i, a) => !i || e.line !== a[i - 1].line)
    .map((e) => badge(e.line))
    .join("");
  const itinerary = current.legs
    .map(
      (e) =>
        `<li>${e.transfer ? `<small class="transfer">Change to ${e.line} · +4 min transfer</small>` : ""}${escape(names.get(e.to))}<small>${e.line} corridor · ${e.minutes} min ride${e.delay ? ` + ${e.delay} min simulated delay` : ""}</small></li>`,
    )
    .join("");
  $("results").innerHTML =
    `<h3>${escape(scenarios[s.scenario].name)}</h3><div class="metric"><strong>${current.minutes}</strong><span>simulated minutes</span></div><div class="route-meta">${current.transfers} train change${current.transfers === 1 ? "" : "s"} · ${current.legs.length} connections</div><div class="badges">${unique || '<span class="chip">Already at destination</span>'}</div><div class="comparison"><strong>${delta}</strong><br>${s.transferPenalty ? "Your preference favors fewer train changes, even if the example trip takes longer." : "The route with the shortest example travel time is selected."} Waiting for trains is not included.${counterfactual ? `<br><br>${counterfactual}` : ""}</div><ol class="itinerary"><li>${escape(names.get(s.origin))}<small>Start here</small></li>${itinerary}</ol>`;
}
function renderMap() {
  const selected = new Set(current?.legs?.map((e) => e.id) || []),
    path = new Set(current?.path || []),
    s = settings(),
    scenario = scenarios[s.scenario],
    lookup = new Map(stations.map((v) => [v.id, v]));
  let out =
    '<text x="50" y="65" fill="#4f6d78" font-size="10" letter-spacing="3">WEST SIDE</text><text x="570" y="65" fill="#4f6d78" font-size="10" letter-spacing="3">EAST SIDE</text>';
  // Parallel corridors receive small deterministic offsets so each line remains visible.
  for (const e of [...edges].sort(
    (a, b) => Number(selected.has(a.id)) - Number(selected.has(b.id)),
  )) {
    const a = lookup.get(e.from),
      b = lookup.get(e.to),
      on = selected.has(e.id),
      closed =
        scenario.closedLines.includes(e.line) ||
        scenario.closedStations.includes(e.from) ||
        scenario.closedStations.includes(e.to);
    const offset = { 2: -5, 4: 5, 6: -5 }[e.line] || 0;
    out += `<path d="M ${a.x + offset} ${a.y} L ${b.x + offset} ${b.y}" stroke="${on ? "#bcf69b" : lines[e.line].color}" opacity="${closed ? 0.12 : on ? 1 : 0.35}" stroke-width="${on ? 6 : 4}" fill="none" ${closed ? 'stroke-dasharray="6 6"' : ""}><title>${e.line}: ${escape(a.name)} to ${escape(b.name)}, ${e.minutes} modeled minutes</title></path>`;
  }
  for (const st of stations) {
    const blocked =
      scenario.closedStations.includes(st.id) ||
      (s.stepFree && (!st.stepFree || scenario.inaccessible?.includes(st.id)));
    let labelX = st.x + 13,
      labelY = st.y - 12,
      anchor = "start";
    if (["lex59", "grand", "astor", "cityhall", "borough"].includes(st.id)) {
      labelX = st.x + 15;
      labelY = st.y + 5;
    }
    if (st.id === "atlantic") {
      labelX = st.x;
      labelY = st.y + 30;
      anchor = "middle";
    }
    if (st.id === "8av") {
      labelX = st.x;
      labelY = st.y + 27;
    }
    if (st.id === "hudson") {
      labelX = st.x - 20;
      labelY = st.y - 25;
    }
    const endpoint = st.id === s.origin || st.id === s.destination;
    out += `<g class="station" data-station="${st.id}" tabindex="0" role="button" aria-label="Inspect ${escape(st.name)}"><circle cx="${st.x}" cy="${st.y}" r="${endpoint ? 10 : 6}" fill="${blocked ? "#745850" : path.has(st.id) ? "#bcf69b" : "#172630"}" stroke="${path.has(st.id) ? "#bcf69b" : "#92adb6"}" stroke-width="2"/><text x="${labelX}" y="${labelY}" text-anchor="${anchor}">${escape(st.name)}</text>${blocked ? `<path d="M ${st.x - 4} ${st.y - 4} l 8 8 M ${st.x - 4} ${st.y + 4} l 8 -8" stroke="#f4c1a1"/>` : ""}</g>`;
  }
  $("map").innerHTML = out;
  for (const el of $("map").querySelectorAll("[data-station]")) {
    el.onclick = () => inspect(el.dataset.station);
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inspect(el.dataset.station);
      }
    };
  }
}
function inspect(id) {
  const st = stations.find((s) => s.id === id),
    serving = [
      ...new Set(
        edges.filter((e) => e.from === id || e.to === id).map((e) => e.line),
      ),
    ];
  $("station-info").innerHTML =
    `<strong>${escape(st.name)}</strong> · Example lines ${serving.join(", ")} · ${st.stepFree ? "Step-free in this example" : "Not step-free in this example"}<br><button class="quiet" id="set-origin">Set as start</button><button class="quiet" id="set-destination">Set as destination</button>`;
  $("set-origin").onclick = () => {
    $("origin").value = id;
    solve();
  };
  $("set-destination").onclick = () => {
    $("destination").value = id;
    solve();
  };
}
function renderTrace() {
  const t = current.trace,
    e = t[traceIndex],
    s = settings();
  $("trace-count").textContent = t.length
    ? `Step ${traceIndex + 1} of ${t.length}`
    : "No steps to show";
  $("trace-back").disabled = traceIndex <= 0;
  $("trace-next").disabled = traceIndex >= t.length - 1;
  if (!e) {
    $("trace").textContent =
      "The selected start or destination is unavailable with these settings. Try another station, change the service scenario, or turn off the step-free filter.";
    return;
  }
  const total = (cost) =>
      s.transferPenalty ? `${cost} comparison points` : `${cost} simulated min`,
    reached = current.found && e.station === s.destination,
    exhausted = !current.found && traceIndex === t.length - 1,
    progress = reached
      ? "Destination reached. The best route for your settings is shown above."
      : exhausted
        ? "All available options have been checked. No route connects these stations with your current settings."
        : e.relaxed.length
          ? "New or better options found from here:"
          : "No better onward option found at this step. Select Next to see another option.",
    explanation = s.transferPenalty
      ? `Lower totals are preferred. The comparison includes example travel time plus ${s.transferPenalty} extra points for each train change. Points help rank routes; they are not a travel-time prediction.`
      : "This total uses example travel times, delays, and time to change trains. Lower totals are preferred. It is not a live travel-time prediction.";
  $("trace").innerHTML =
    `<strong class="trace-station">${escape(names.get(e.station))}</strong><p>${e.line === "Start" ? "Starting point" : `Reached using line ${escape(e.line)}`}<br>Total from the start: <strong>${total(e.cost)}</strong></p><p>${progress}</p>${e.relaxed.length ? `<ul>${e.relaxed.map((x) => `<li><span>${escape(names.get(x.station))} on line ${escape(x.line)}</span><small>${total(x.cost)} from the start</small></li>`).join("")}</ul>` : ""}<p class="hint trace-total-note">${explanation}</p>`;
}
function validFavorite(x) {
  return (
    x &&
    names.has(x.origin) &&
    names.has(x.destination) &&
    Object.hasOwn(scenarios, x.scenario) &&
    typeof x.stepFree === "boolean" &&
    [0, 8, 20].includes(x.transferPenalty)
  );
}
function persist() {
  try {
    localStorage.setItem("streetcode-journeys-v1", JSON.stringify(favorites));
    $("storage-message").textContent = "Saved on this browser only.";
  } catch {
    $("storage-message").textContent =
      "Browser storage unavailable. Favorites last for this session only.";
  }
}
function renderFavorites() {
  if (!favorites.length) {
    $("favorites").innerHTML =
      '<p class="hint">Keep a journey ready for your next demo.</p>';
    return;
  }
  $("favorites").innerHTML = favorites
    .map(
      (f, i) =>
        `<div class="favorite"><button data-load="${i}">${escape(names.get(f.origin))} → ${escape(names.get(f.destination))}<br><span>${escape(scenarios[f.scenario].name)}</span></button><button data-remove="${i}" aria-label="Remove saved journey ${i + 1}">×</button></div>`,
    )
    .join("");
  $("favorites")
    .querySelectorAll("[data-load]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          apply(favorites[Number(el.dataset.load)]);
          solve();
        }),
    );
  $("favorites")
    .querySelectorAll("[data-remove]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          favorites.splice(Number(el.dataset.remove), 1);
          persist();
          renderFavorites();
        }),
    );
}
function apply(s) {
  $("origin").value = s.origin;
  $("destination").value = s.destination;
  $("scenario").value = s.scenario;
  $("stepfree").checked = s.stepFree;
  $("preference").value = s.transferPenalty;
}
$("journey").onsubmit = (e) => {
  e.preventDefault();
  solve();
};
["scenario", "preference", "stepfree", "origin", "destination"].forEach(
  (id) => ($(id).onchange = solve),
);
$("swap").onclick = () => {
  const a = $("origin").value;
  $("origin").value = $("destination").value;
  $("destination").value = a;
  solve();
};
$("reset").onclick = () => {
  document.querySelector('[data-view="planner"]').click();
  apply({
    origin: "times",
    destination: "atlantic",
    scenario: "normal",
    stepFree: false,
    transferPenalty: 0,
  });
  $("station-info").textContent =
    "Select any station on the map to explore its connections.";
  solve();
};
$("trace-back").onclick = () => {
  traceIndex = Math.max(0, traceIndex - 1);
  renderTrace();
};
$("trace-next").onclick = () => {
  traceIndex = Math.min(current.trace.length - 1, traceIndex + 1);
  renderTrace();
};
$("save").onclick = () => {
  const s = settings();
  if (!favorites.some((f) => JSON.stringify(f) === JSON.stringify(s))) {
    favorites.unshift(s);
    favorites = favorites.slice(0, 8);
    persist();
    renderFavorites();
  }
};
$("export").onclick = () => {
  const data = {
    project: "StreetCode NYC",
    dataMode: "synthetic educational model, not live MTA",
    settings: settings(),
    result: current,
    baseline,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "streetcode-route.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-view]")
        .forEach((x) => x.classList.toggle("active", x === b));
      $("planner").hidden = b.dataset.view !== "planner";
      $("explain").hidden = b.dataset.view !== "explain";
      $("live").hidden = b.dataset.view !== "live";
    }),
);
try {
  // Read the legacy key on the same origin so a local upgrade keeps saved trips.
  const parsed = JSON.parse(
    localStorage.getItem("streetcode-journeys-v1") ??
      localStorage.getItem("transitlens-journeys-v1") ??
      "[]",
  );
  if (Array.isArray(parsed))
    favorites = parsed.filter(validFavorite).slice(0, 8);
} catch {
  $("storage-message").textContent =
    "Saved data could not be read; starting with an empty list.";
}
renderFavorites();
$("reset").click();

const demos = {
  reroute: {
    origin: "times",
    destination: "atlantic",
    scenario: "westDelay",
    stepFree: false,
    transferPenalty: 0,
  },
  closure: {
    origin: "grand",
    destination: "canal",
    scenario: "unionClosed",
    stepFree: false,
    transferPenalty: 0,
  },
  isolation: {
    origin: "hudson",
    destination: "grand",
    scenario: "crosstownClosed",
    stepFree: false,
    transferPenalty: 0,
  },
};
document.querySelectorAll("[data-demo]").forEach(
  (b) =>
    (b.onclick = () => {
      apply(demos[b.dataset.demo]);
      document.querySelector('[data-view="planner"]').click();
      solve();
    }),
);
