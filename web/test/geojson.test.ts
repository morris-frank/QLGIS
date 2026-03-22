import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { computeGeoJSONBounds, detectNumericGeoJSONAttributes, prepareGeoJSONOverlay } from "../src/lib/geojson";

const fixturesRoot = new URL("../../Fixtures/", import.meta.url);

test("polygon fixture bounds are computed correctly", async () => {
  const raw = await readFile(new URL("polygon.geojson", fixturesRoot), "utf8");
  const overlay = prepareGeoJSONOverlay(raw);
  assert.deepEqual(overlay.fitBounds, [4.9, 52.35, 5.05, 52.42]);
});

test("line fixture bounds are computed correctly", async () => {
  const raw = await readFile(new URL("line.geojson", fixturesRoot), "utf8");
  const overlay = prepareGeoJSONOverlay(raw);
  assert.deepEqual(overlay.fitBounds, [4.84, 52.35, 5.01, 52.41]);
});

test("point features produce non-degenerate bounds", async () => {
  const raw = await readFile(new URL("point.geojson", fixturesRoot), "utf8");
  const bounds = computeGeoJSONBounds(JSON.parse(raw));
  assert.ok(bounds[0] < bounds[2]);
  assert.ok(bounds[1] < bounds[3]);
});

test("numeric GeoJSON properties are detected for thematic styling", () => {
  const attributes = detectNumericGeoJSONAttributes({
    features: [
      { properties: { elevation: 12, name: "a", population: 10 }, type: "Feature" },
      { properties: { elevation: 30, population: 25 }, type: "Feature" }
    ],
    type: "FeatureCollection"
  });

  assert.deepEqual(attributes, [
    { key: "elevation", max: 30, min: 12 },
    { key: "population", max: 25, min: 10 }
  ]);
});
