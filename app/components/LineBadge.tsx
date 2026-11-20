import { lineColor, lineText, lineLabel } from "../../lib/transit/lines";

const describe = (route: string) =>
  route === "GS"
    ? "42 Street Shuttle"
    : route === "FS"
      ? "Franklin Avenue Shuttle"
      : route === "H"
        ? "Rockaway Shuttle"
        : route.endsWith("X")
          ? `${lineLabel(route)} express`
          : `${lineLabel(route)} line`;

/** Round bullet for local service, diamond for express (MTA convention). */
export default function LineBadge({ route }: { route: string }) {
  return (
    <span
      role="img"
      aria-label={describe(route)}
      title={describe(route)}
      className={"badge" + (route.endsWith("X") ? " express" : "")}
      style={{ background: lineColor(route), color: lineText(route) }}
    >
      <span aria-hidden="true">{lineLabel(route)}</span>
    </span>
  );
}
