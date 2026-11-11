// MTA developer palette, https://www.mta.info/document/168976 (checked 2026-10-27).
export const LINE_COLORS: Record<string, string> = {
  "1": "#D82233",
  "2": "#D82233",
  "3": "#D82233",
  "4": "#009952",
  "5": "#009952",
  "6": "#009952",
  "6X": "#009952",
  "7": "#9A38A1",
  "7X": "#9A38A1",
  A: "#0062CF",
  C: "#0062CF",
  E: "#0062CF",
  B: "#EB6800",
  D: "#EB6800",
  F: "#EB6800",
  FX: "#EB6800",
  M: "#EB6800",
  G: "#799534",
  J: "#8E5C33",
  Z: "#8E5C33",
  L: "#7C858C",
  N: "#F6BC26",
  Q: "#F6BC26",
  R: "#F6BC26",
  W: "#F6BC26",
  GS: "#7C858C",
  FS: "#7C858C",
  H: "#7C858C",
  S: "#7C858C",
  SI: "#08179C",
  SIR: "#08179C",
};
export const lineColor = (route: string) => LINE_COLORS[route] || "#7C858C";
export const lineText = (route: string) =>
  ["N", "Q", "R", "W", "G", "L", "GS", "FS", "H", "S"].includes(route)
    ? "#101418"
    : "#FFFFFF";
export const lineLabel = (route: string) =>
  ["GS", "FS", "H"].includes(route)
    ? "S"
    : route === "SI"
      ? "SIR"
      : route.replace(/X$/, "");
