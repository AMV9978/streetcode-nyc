import { feeds, feedUrl, decodeFeed } from "./feed.js";
const $ = (id) => document.getElementById(id);
let observation = null,
  fetchTime = 0,
  lastRequest = 0,
  selectedFeed = "l";
for (const [id, f] of Object.entries(feeds))
  $("feed").add(new Option(f.name, id));
$("feed").value = "l";
function cell(row, value) {
  const td = document.createElement("td");
  td.textContent = String(value);
  row.append(td);
}
function render() {
  const body = $("feed-rows");
  body.replaceChildren();
  if (!observation) return;
  const filter = $("stop-filter").value.trim().toUpperCase(),
    list = observation.arrivals
      .filter((a) => a.stopId.toUpperCase().includes(filter))
      .slice(0, 40);
  for (const a of list) {
    const tr = document.createElement("tr");
    [
      a.route,
      a.stopId,
      new Date(a.time * 1000).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
      Math.max(0, Math.ceil((a.time - fetchTime) / 60)),
    ].forEach((v) => cell(tr, v));
    body.append(tr);
  }
  if (!list.length) {
    const tr = document.createElement("tr"),
      td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "No matching upcoming predictions in this snapshot.";
    tr.append(td);
    body.append(tr);
  }
  freshness();
}
function freshness() {
  if (!observation) return;
  const age = Math.floor(Date.now() / 1000) - observation.timestamp;
  const label =
    age < -30 ? "CLOCK SKEW" : age > 90 ? "STALE SNAPSHOT" : "RECENT SNAPSHOT";
  $("feed-status").textContent =
    `${label} · ${feeds[selectedFeed].name} · feed age ${age} seconds · fetched ${new Date(fetchTime * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET. Refresh manually for new predictions.`;
}
$("refresh-feed").onclick = async () => {
  if (Date.now() - lastRequest < 30000) {
    $("feed-status").textContent = "Please allow 30 seconds between requests.";
    return;
  }
  lastRequest = Date.now();
  $("refresh-feed").disabled = true;
  $("feed").disabled = true;
  $("feed-status").textContent = "Requesting official MTA GTFS-Realtime feed…";
  observation = null;
  $("feed-rows").replaceChildren();
  $("feed-summary").replaceChildren();
  try {
    selectedFeed = $("feed").value;
    const url = feedUrl(selectedFeed);
    $("feed-source").href = url;
    $("feed-source").textContent = "Source: official MTA binary feed ↗";
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error(`MTA returned HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    fetchTime = Math.floor(Date.now() / 1000);
    observation = decodeFeed(bytes, fetchTime);
    $("feed-summary").innerHTML =
      `<div class="feed-metrics"><div><strong>${observation.trips}</strong><span>Trip updates</span></div><div><strong>${observation.arrivals.length}</strong><span>Predictions in next hour</span></div><div><strong>${(bytes.length / 1024).toFixed(1)} KB</strong><span>Protobuf decoded</span></div></div>`;
    render();
  } catch (error) {
    $("feed-status").textContent =
      `Live feed unavailable. ${error.message}. Network access or browser cross-origin restrictions may prevent retrieval. The route lab remains available; no sample data is substituted.`;
  } finally {
    $("refresh-feed").disabled = false;
    $("feed").disabled = false;
  }
};
// Changing feed selection must never leave another feed's predictions visible.
$("feed").onchange = () => {
  observation = null;
  $("feed-rows").replaceChildren();
  $("feed-summary").replaceChildren();
  $("feed-source").href = feedUrl($("feed").value);
  $("feed-source").textContent = "Source: selected official MTA binary feed ↗";
  $("feed-status").textContent = "Feed selection changed. Fetch to load its predictions.";
};
$("stop-filter").oninput = render;
setInterval(freshness, 15000);
