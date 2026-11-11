#!/usr/bin/env python3
"""Build compact map geometry and transfer metadata from an official MTA GTFS ZIP.

Usage: python3 scripts/build-map-data.py /path/to/gtfs.zip [--land boroughs.geojson]
The input station catalog must be generated from the same GTFS release.
This is geographic reference data, not an assertion of current train service.
"""
import argparse
import csv
import io
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile


SOURCE = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
LAND_SOURCE = "https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne"
ROOT = Path(__file__).resolve().parents[1]


def read_rows(archive, name):
    with archive.open(name) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def simplify(points, tolerance=0.000035):
    """Iterative Douglas-Peucker. About 3 m latitude tolerance at NYC."""
    if len(points) < 3:
        return points
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        denominator = dx * dx + dy * dy
        furthest, distance = -1, tolerance * tolerance
        for index in range(first + 1, last):
            px, py = points[index]
            t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) if denominator else 0
            value = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if value > distance:
                furthest, distance = index, value
        if furthest >= 0:
            keep.add(furthest)
            stack.extend([(first, furthest), (furthest, last)])
    return [points[index] for index in sorted(keep)]


def linework(shape_ids, shapes):
    """Deduplicate shared directed/reversed shapes as undirected drawing edges.

    This normalization is used only for the drawing, never for travel routing.
    Degree-two chains are merged before geometry simplification.
    """
    graph = defaultdict(set)
    edges = set()
    for shape_id in sorted(shape_ids):
        points = shapes.get(shape_id, [])
        for a, b in zip(points, points[1:]):
            if a != b:
                key = tuple(sorted((a, b)))
                edges.add(key)
                graph[a].add(b)
                graph[b].add(a)
    remaining = set(edges)
    paths = []

    def walk(start, neighbor):
        path = [start, neighbor]
        remaining.discard(tuple(sorted((start, neighbor))))
        previous, current = start, neighbor
        while len(graph[current]) == 2:
            onward = next(x for x in sorted(graph[current]) if x != previous)
            key = tuple(sorted((current, onward)))
            if key not in remaining:
                break
            remaining.remove(key)
            path.append(onward)
            previous, current = current, onward
        paths.append(simplify(path))

    for start in sorted(graph):
        if len(graph[start]) != 2:
            for neighbor in sorted(graph[start]):
                if tuple(sorted((start, neighbor))) in remaining:
                    walk(start, neighbor)
    while remaining:
        walk(*min(remaining))
    return paths


def load_land(path):
    if not path:
        return []
    document = json.loads(Path(path).read_text())
    result = []
    for feature in document["features"]:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"]
        if geometry["type"] == "Polygon":
            polygons = [polygons]
        if geometry["type"] not in ("MultiPolygon", "Polygon"):
            continue
        rings = []
        for polygon in polygons:
            for ring in polygon:
                # All rings are retained so SVG evenodd fill preserves holes.
                points = [(round(x, 6), round(y, 6)) for x, y, *_ in ring]
                reduced = simplify(points, tolerance=0.00012)
                if len(reduced) >= 4:
                    rings.append(reduced)
        props = feature.get("properties", {})
        name = props.get("boro_name") or props.get("boroname") or props.get("name") or "NYC borough"
        result.append({"name": name, "polygons": rings})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gtfs", type=Path)
    parser.add_argument("--land", type=Path)
    args = parser.parse_args()
    stations = json.loads((ROOT / "public/stations.json").read_text())
    ids = {station["id"] for station in stations}
    parents = {station_id: station_id for station_id in ids}

    def find(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            smaller, larger = sorted((a, b))
            parents[larger] = smaller

    with ZipFile(args.gtfs) as archive:
        info = next(read_rows(archive, "feed_info.txt"))
        gtfs_stops = {row["stop_id"]: row for row in read_rows(archive, "stops.txt")}
        parent_ids = {key for key, row in gtfs_stops.items() if row.get("location_type") == "1"}
        if ids != parent_ids:
            raise ValueError("Station catalog and GTFS parent IDs do not match")

        def parent(stop):
            return gtfs_stops.get(stop, {}).get("parent_station") or stop

        transfer_map = {}
        for row in read_rows(archive, "transfers.txt"):
            if row["transfer_type"] not in ("0", "1", "2"):
                continue
            source, target = parent(row["from_stop_id"]), parent(row["to_stop_id"])
            if source not in ids or target not in ids:
                continue
            seconds = int(row["min_transfer_time"]) if row.get("min_transfer_time") else 180
            key = (source, target)
            transfer_map[key] = min(seconds, transfer_map.get(key, seconds))
            union(source, target)
        transfers = [{"from": source, "to": target, "seconds": seconds}
                     for (source, target), seconds in sorted(transfer_map.items())]

        grouped = defaultdict(list)
        for station in stations:
            station["complex"] = find(station["id"])
            grouped[station["complex"]].append(station)
        complexes = []
        for complex_id, members in sorted(grouped.items()):
            names = list(dict.fromkeys(member["name"] for member in members))
            complexes.append({
                "id": complex_id,
                "name": " / ".join(names),
                "lat": round(sum(s["lat"] for s in members) / len(members), 6),
                "lon": round(sum(s["lon"] for s in members) / len(members), 6),
                "stations": [s["id"] for s in members],
                "routes": sorted({r for s in members for r in s["routes"]}),
            })
        route_shapes = defaultdict(set)
        for row in read_rows(archive, "trips.txt"):
            route_shapes[row["route_id"]].add(row["shape_id"])
        raw_shapes = defaultdict(list)
        for row in read_rows(archive, "shapes.txt"):
            raw_shapes[row["shape_id"]].append((int(row["shape_pt_sequence"]),
                (round(float(row["shape_pt_lon"]), 6), round(float(row["shape_pt_lat"]), 6))))
        shapes = {key: [point for _, point in sorted(value)] for key, value in raw_shapes.items()}
        routes = []
        for row in read_rows(archive, "routes.txt"):
            routes.append({
                "id": row["route_id"], "name": row["route_long_name"],
                "shortName": row["route_short_name"],
                "color": "#" + row["route_color"],
                "textColor": "#" + row["route_text_color"],
                "paths": linework(route_shapes[row["route_id"]], shapes),
            })
    meta = {"generatedAt": datetime.now(timezone.utc).isoformat(), "source": SOURCE,
            "feedVersion": info["feed_version"],
            "validThrough": datetime.strptime(info["feed_end_date"], "%Y%m%d").date().isoformat()}
    public = {**meta, "routes": routes, "stations": stations, "complexes": complexes,
              "land": load_land(args.land)}
    if args.land:
        public["landSource"] = LAND_SOURCE
    backend = {**meta, "stations": stations, "complexes": complexes, "transfers": transfers}
    for relative, payload in [("public/subway-map.json", public), ("lib/transit/map-data.json", backend)]:
        destination = ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
        print(f"{relative}: {destination.stat().st_size:,} bytes")
    print(f"{len(stations)} stations; {len(complexes)} complexes; {len(routes)} lines; "
          f"{sum(len(route['paths']) for route in routes)} paths; {len(transfers)} directed transfers")
    print(f"{sum(len(path) for route in routes for path in route['paths'])} linework points")


if __name__ == "__main__":
    main()
