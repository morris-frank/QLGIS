import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import proj4 from "proj4";
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

test("named GeoJSON CRS is reprojected to WGS84", () => {
  proj4.defs("EPSG:25832", "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs");
  const first = proj4("EPSG:4326", "EPSG:25832", [4.9, 52.35]);
  const second = proj4("EPSG:4326", "EPSG:25832", [5.05, 52.42]);

  const overlay = prepareGeoJSONOverlay(JSON.stringify({
    crs: {
      properties: {
        name: "urn:ogc:def:crs:EPSG::25832"
      },
      type: "name"
    },
    features: [{
      geometry: {
        coordinates: [first, second],
        type: "LineString"
      },
      properties: {},
      type: "Feature"
    }],
    type: "FeatureCollection"
  }));

  assert.equal(overlay.crsLabel, "Reprojected from urn:ogc:def:crs:EPSG::25832");
  assert.ok(Math.abs(overlay.fitBounds[0] - 4.9) < 0.01);
  assert.ok(Math.abs(overlay.fitBounds[1] - 52.35) < 0.01);
  assert.ok(Math.abs(overlay.fitBounds[2] - 5.05) < 0.01);
  assert.ok(Math.abs(overlay.fitBounds[3] - 52.42) < 0.01);
});
