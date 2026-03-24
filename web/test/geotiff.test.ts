import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeGeoTIFFSelection, prepareGeoTIFFPreview, renderSelectionPixels, selectorOptionsForGeoTIFF } from "../src/lib/geotiff";

const fixturesRoot = new URL("../../Fixtures/", import.meta.url);

test("grayscale GeoTIFF exposes bounds and grayscale rendering mode", async () => {
  const buffer = await readFixture("grayscale_4326.geotiff");
  const overlay = await prepareGeoTIFFPreview(buffer);

  assert.equal(overlay.defaultSelection, "band:0");
  assert.equal(overlay.width, 2);
  assert.equal(overlay.height, 2);
  assert.deepEqual(overlay.fitBounds, [4.8, 52.2, 5, 52.4]);
  assert.deepEqual(selectorOptionsForGeoTIFF(overlay), [{ label: "Band 1", value: "band:0" }]);
  assert.equal(describeGeoTIFFSelection(overlay, "band:0"), "Coloring the raster by Band 1.");
});

test("rgb GeoTIFF preserves per-band rendering", async () => {
  const buffer = await readFixture("rgb_4326.geotiff");
  const overlay = await prepareGeoTIFFPreview(buffer);

  assert.equal(overlay.defaultSelection, "composite");
  assert.deepEqual(overlay.fitBounds, [5, 52.4, 5.1, 52.5]);
  assert.deepEqual(selectorOptionsForGeoTIFF(overlay), [
    { label: "Composite RGB", value: "composite" },
    { label: "Band 1", value: "band:0" },
    { label: "Band 2", value: "band:1" },
    { label: "Band 3", value: "band:2" }
  ]);
});

test("GeoTIFF selections render to canvas", async () => {
  const buffer = await readFixture("rgb_4326.geotiff");
  const overlay = await prepareGeoTIFFPreview(buffer);

  const composite = renderSelectionPixels(overlay, "composite");
  const band = renderSelectionPixels(overlay, "band:0");

  assert.equal(composite.length, overlay.width * overlay.height * 4);
  assert.ok(composite.some((value, index) => index % 4 !== 3 && value > 0));
  assert.equal(band.length, overlay.width * overlay.height * 4);
});

async function readFixture(name: string): Promise<ArrayBuffer> {
  const buffer = await readFile(new URL(name, fixturesRoot));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
