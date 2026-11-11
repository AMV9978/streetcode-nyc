import { lineColor, lineText, lineLabel } from "../../lib/transit/lines";
export default function LineBadge({ route }: { route: string }) {
  return (
    <span
      title={
        route === "GS"
          ? "42 Street Shuttle"
          : route === "FS"
            ? "Franklin Avenue Shuttle"
            : route === "H"
              ? "Rockaway Shuttle"
              : route.endsWith("X")
                ? `${lineLabel(route)} express`
                : `${lineLabel(route)} line`
      }
      className={"badge" + (route.endsWith("X") ? " express" : "")}
      style={{ background: lineColor(route), color: lineText(route) }}
    >
      <span>{lineLabel(route)}</span>
    </span>
  );
}
