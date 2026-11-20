import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEasternTime,
  indexEquipment,
  normalizeOutages,
  stepFreeStations,
  stationAccess,
} from "../lib/transit/elevators.js";

// Shapes copied from MTA's nyct_ene_equipments.json and nyct_ene.json.
const equipment = [
  { equipmentno: "EL293", equipmenttype: "EL", ADA: "Y", isactive: "Y", redundant: 0, elevatorsgtfsstopid: "L06", shortdescription: "Street to Brooklyn-bound platform", alternativeroute: "Use Union Sq." },
  { equipmentno: "EL292", equipmenttype: "EL", ADA: "Y", isactive: "Y", redundant: 0, elevatorsgtfsstopid: "L06", shortdescription: "Street to 8 Av-bound platform" },
  { equipmentno: "EL100", equipmenttype: "EL", ADA: "Y", isactive: "Y", redundant: 1, elevatorsgtfsstopid: "A31/L01", shortdescription: "Mezzanine" },
  { equipmentno: "ES001", equipmenttype: "ES", ADA: "N", isactive: "Y", elevatorsgtfsstopid: "127" },
  { equipmentno: "EL999", equipmenttype: "EL", ADA: "N", isactive: "Y", elevatorsgtfsstopid: "R20" },
];

test("parses New York times across daylight saving", () => {
  // 10:00 PM EST on 16 Dec 2026 = 03:00 UTC on 17 Dec.
  assert.equal(parseEasternTime("12/16/2026 10:00:00 PM"), Date.UTC(2026, 11, 17, 3) / 1000);
  // 9:30 AM EDT on 1 Jul 2026 = 13:30 UTC.
  assert.equal(parseEasternTime("07/01/2026 09:30:00 AM"), Date.UTC(2026, 6, 1, 13, 30) / 1000);
  assert.equal(parseEasternTime("12/01/2026 12:05:00 AM"), Date.UTC(2026, 11, 1, 5, 5) / 1000);
  assert.equal(parseEasternTime("garbage"), null);
});

test("indexes elevators by every GTFS station they serve and skips escalators", () => {
  const index = indexEquipment(equipment);
  assert.equal(index.byStation.get("L06").length, 2);
  assert.ok(index.byStation.has("A31") && index.byStation.has("L01"));
  assert.equal(index.byStation.has("127"), false);
});

test("a current non-redundant outage removes step-free status; upcoming ones do not", () => {
  const index = indexEquipment(equipment);
  const now = parseEasternTime("11/20/2026 12:00:00 PM");
  const outages = normalizeOutages(
    [
      { equipment: "EL293", outagedate: "11/20/2026 08:00:00 AM", estimatedreturntoservice: "11/21/2026 08:00:00 AM", isupcomingoutage: "N", reason: "Repair" },
      { equipment: "EL100", outagedate: "11/20/2026 08:00:00 AM", estimatedreturntoservice: "11/21/2026 08:00:00 AM", isupcomingoutage: "N" },
      { equipment: "EL292", outagedate: "12/16/2026 10:00:00 PM", estimatedreturntoservice: "12/17/2026 06:00:00 AM", isupcomingoutage: "Y" },
      { equipment: "EL777", outagedate: "11/01/2026 08:00:00 AM", estimatedreturntoservice: "11/02/2026 08:00:00 AM", isupcomingoutage: "N" },
    ],
    now,
  );
  assert.equal(outages.length, 3, "outage that already ended is dropped");
  const allowed = stepFreeStations(index, outages);
  assert.equal(allowed.has("L06"), false);
  assert.equal(allowed.has("A31"), true, "redundant elevator outage keeps access");
  assert.equal(allowed.has("R20"), false, "non-ADA elevator does not count");
  const access = stationAccess(index, outages, ["L06"]);
  assert.equal(access[0].id, "EL293");
  assert.equal(access[0].outage.reason, "Repair");
  assert.equal(access[0].alternative, "Use Union Sq.");
  assert.equal(access[1].outage.upcoming, true);
});
