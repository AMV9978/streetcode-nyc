/**
 * How good are MTA countdowns? This tracker watches the same train approach
 * the same stop across successive feed snapshots. When the train leaves the
 * feed for that stop, its last prediction is taken as the actual time, and
 * every earlier prediction is scored against it.
 *
 * Results are grouped by line and by how far ahead the prediction was made
 * (lead time). Only trains watched continuously (no gap longer than 90 s
 * between snapshots) are scored, so a quiet period never produces fake
 * accuracy numbers. Data lives in memory: it starts empty when the server
 * restarts and only grows while people are using the site.
 */
import { baseRoute } from "./routes.js";

/** Each train is scored once per checkpoint: the countdown that was on
 * screen when the train was `at` seconds away. One sample per train per
 * bucket keeps trains with jumpy predictions from being over-counted. */
export const LEAD_BUCKETS = [
  { id: "1", at: 60 },
  { id: "3", at: 180 },
  { id: "5", at: 300 },
  { id: "10", at: 600 },
  { id: "20", at: 1200 },
];

export class ReliabilityTracker {
  constructor({ maxWatched = 60000, maxGap = 90, maxSamples = 64 } = {}) {
    this.watching = new Map();
    this.lastSeenFeed = new Map();
    this.stats = new Map();
    this.maxWatched = maxWatched;
    this.maxGap = maxGap;
    this.maxSamples = maxSamples;
    this.since = null;
    this.scored = 0;
  }

  /** Feed one decoded snapshot. `observedAt` is the feed's own timestamp. */
  observe(feed, decoded, observedAt = decoded.timestamp) {
    if (!Number.isFinite(observedAt)) return;
    const previous = this.lastSeenFeed.get(feed);
    if (previous !== undefined && observedAt <= previous) return; // same or older snapshot
    this.lastSeenFeed.set(feed, observedAt);
    this.since ??= observedAt;
    const present = new Set();
    for (const a of decoded.arrivals || []) {
      const key = `${feed}|${a.startDate}|${a.trip}|${a.stopId}`;
      present.add(key);
      let w = this.watching.get(key);
      if (!w) {
        w = { feed, route: baseRoute(a.route), samples: [], lastSeen: observedAt };
        this.watching.set(key, w);
      }
      const last = w.samples[w.samples.length - 1];
      if (!last || last[1] !== a.time) {
        w.samples.push([observedAt, a.time]);
        if (w.samples.length > this.maxSamples) w.samples.shift();
      }
      w.gapOk = observedAt - w.lastSeen <= this.maxGap && w.gapOk !== false;
      w.lastSeen = observedAt;
      w.lastPrediction = a.time;
    }
    for (const [key, w] of this.watching) {
      if (w.feed !== feed || present.has(key)) continue;
      // Train left this stop's predictions. Score it only if we watched it
      // closely and it was actually due (not cancelled far in the future).
      const due = w.lastPrediction <= observedAt + 60;
      if (due && w.gapOk !== false && observedAt - w.lastSeen <= this.maxGap)
        this.score(w);
      this.watching.delete(key);
    }
    if (this.watching.size > this.maxWatched) {
      const extra = this.watching.size - this.maxWatched;
      let i = 0;
      for (const key of this.watching.keys()) {
        if (i++ >= extra) break;
        this.watching.delete(key);
      }
    }
  }

  score(w) {
    const actual = w.lastPrediction;
    let used = false;
    for (const bucket of LEAD_BUCKETS) {
      const moment = actual - bucket.at;
      // We must have been watching before that moment.
      if (!w.samples.length || w.samples[0][0] > moment) continue;
      let shown = w.samples[0][1];
      for (const [at, predicted] of w.samples) {
        if (at > moment) break;
        shown = predicted;
      }
      const k = `${w.route}|${bucket.id}`;
      let s = this.stats.get(k);
      if (!s) this.stats.set(k, (s = { n: 0, abs: 0, bias: 0, within60: 0 }));
      const error = shown - actual; // > 0: the train came earlier than shown
      s.n++;
      s.abs += Math.abs(error);
      s.bias += error;
      if (Math.abs(error) <= 60) s.within60++;
      used = true;
    }
    if (used) this.scored++;
  }

  /** Summary safe to send to browsers. */
  summary(route) {
    const lines = {};
    for (const [k, s] of this.stats) {
      const [r, bucket] = k.split("|");
      if (route && r !== baseRoute(route)) continue;
      (lines[r] ??= {})[bucket] = {
        n: s.n,
        meanAbsSeconds: Math.round(s.abs / s.n),
        biasSeconds: Math.round(s.bias / s.n),
        withinOneMinute: Math.round((s.within60 / s.n) * 100) / 100,
      };
    }
    return {
      since: this.since,
      trainsScored: this.scored,
      watching: this.watching.size,
      buckets: LEAD_BUCKETS.map((b) => b.id),
      lines,
    };
  }
}

/** One tracker per server process, shared by every API route. Stored on
 * globalThis so separately bundled routes still see the same instance. */
export const tracker = (globalThis.__streetcodeReliability ??=
  new ReliabilityTracker());
