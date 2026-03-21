import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prepareGeoTIFFOverlay } from "../src/lib/geotiff";

const fixturesRoot = new URL("../../Fixtures/", import.meta.url);

test("grayscale GeoTIFF exposes bounds and grayscale rendering mode", async () => {
  const buffer = await readFixture("grayscale_4326.tif");
  const overlay = await prepareGeoTIFFOverlay(buffer);

  assert.equal(overlay.mode, "grayscale");
  assert.equal(overlay.width, 2);
  assert.equal(overlay.height, 2);
  assert.deepEqual(overlay.fitBounds, [4.8, 52.2, 5, 52.4]);
  assert.deepEqual(Array.from(overlay.pixels.slice(0, 4)), [0, 0, 0, 255]);
});

test("rgb GeoTIFF preserves per-band rendering", async () => {
  const buffer = await readFixture("rgb_4326.tif");
  const overlay = await prepareGeoTIFFOverlay(buffer);

  assert.equal(overlay.mode, "rgb");
  assert.deepEqual(overlay.fitBounds, [5, 52.4, 5.1, 52.5]);
  assert.deepEqual(Array.from(overlay.pixels.slice(0, 4)), [255, 0, 0, 255]);
});

test("rotated GeoTIFF fixtures are rejected as unsupported", async () => {
  const buffer = await readFixture("unsupported_rotated.tif");
  await assert.rejects(() => prepareGeoTIFFOverlay(buffer), /Rotated or skewed GeoTIFF/);
});

async function readFixture(name: string): Promise<ArrayBuffer> {
  const buffer = await readFile(new URL(name, fixturesRoot));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

