/** Curated teaching network, NOT an MTA timetable or accessibility inventory.
 * Each link may compress several real stops. Times and step-free flags are fixtures.
 * Coordinates describe our original schematic, not geographical positions.
 */
export const stations = [
  ["columbus", "Columbus Circle", 170, 65, true],
  ["lex59", "Lexington Av / 59 St", 490, 65, true],
  ["times", "Times Sq / 42 St", 170, 170, true],
  ["grand", "Grand Central", 490, 170, true],
  ["hudson", "Hudson Yards", 45, 170, true],
  ["penn", "Penn Station", 170, 275, true],
  ["herald", "Herald Square", 330, 275, true],
  ["union", "Union Square", 400, 390, false],
  ["14west", "14 St / 7 Av", 170, 390, true],
  ["8av", "8 Av / 14 St", 45, 390, false],
  ["astor", "Astor Place", 490, 480, false],
  ["canal", "Canal Street", 330, 520, false],
  ["chambers", "Chambers Street", 170, 600, true],
  ["cityhall", "Brooklyn Bridge / City Hall", 490, 600, true],
  ["fulton", "Fulton Street", 330, 680, true],
  ["atlantic", "Atlantic Av / Barclays", 570, 780, true],
  ["borough", "Borough Hall", 490, 710, true],
].map(([id, name, x, y, stepFree]) => ({ id, name, x, y, stepFree }));
export const lines = {
  1: { color: "#e76a64", name: "West Side local" },
  2: { color: "#d94957", name: "West Side express" },
  4: { color: "#31a982", name: "East Side express" },
  6: { color: "#73b887", name: "East Side local" },
  7: { color: "#b78aea", name: "Crosstown" },
  N: { color: "#cfac3f", name: "Broadway" },
  L: { color: "#8ba6b5", name: "14 Street" },
};
const links = [
  ["columbus", "times", "1", 5],
  ["times", "penn", "1", 3],
  ["penn", "14west", "1", 6],
  ["14west", "chambers", "1", 9],
  ["times", "penn", "2", 3],
  ["penn", "chambers", "2", 11],
  ["chambers", "fulton", "2", 4],
  ["fulton", "borough", "2", 5],
  ["borough", "atlantic", "2", 5],
  ["lex59", "grand", "4", 5],
  ["grand", "union", "4", 7],
  ["union", "cityhall", "4", 8],
  ["cityhall", "fulton", "4", 3],
  ["fulton", "borough", "4", 5],
  ["borough", "atlantic", "4", 5],
  ["lex59", "grand", "6", 6],
  ["grand", "union", "6", 9],
  ["union", "astor", "6", 3],
  ["astor", "canal", "6", 5],
  ["canal", "cityhall", "6", 4],
  ["hudson", "times", "7", 4],
  ["times", "grand", "7", 4],
  ["lex59", "times", "N", 8],
  ["times", "herald", "N", 4],
  ["herald", "union", "N", 5],
  ["union", "canal", "N", 6],
  ["canal", "atlantic", "N", 13],
  ["8av", "14west", "L", 2],
  ["14west", "union", "L", 3],
];
export const edges = links.map(([from, to, line, minutes], i) => ({
  id: `e${i}`,
  from,
  to,
  line,
  minutes,
}));
export const scenarios = {
  normal: {
    name: "Normal service",
    description: "All modeled corridors are available.",
    closedStations: [],
    closedLines: [],
    delays: {},
  },
  westDelay: {
    name: "West Side delay",
    description: "Add 6 simulated minutes to each 1 / 2 corridor segment.",
    closedStations: [],
    closedLines: [],
    delays: { 1: 6, 2: 6 },
  },
  unionClosed: {
    name: "Union Square closure",
    description:
      "Remove Union Square from the teaching graph. No boarding, transfer, or passage.",
    closedStations: ["union"],
    closedLines: [],
    delays: {},
  },
  crosstownClosed: {
    name: "7 service suspended",
    description:
      "Remove all 7 links. Hudson Yards becomes disconnected in this reduced model.",
    closedStations: [],
    closedLines: ["7"],
    delays: {},
  },
  elevator: {
    name: "Grand Central access outage",
    description:
      "Mark Grand Central unavailable to step-free journeys in this simulation.",
    closedStations: [],
    closedLines: [],
    inaccessible: ["grand"],
    delays: {},
  },
};
