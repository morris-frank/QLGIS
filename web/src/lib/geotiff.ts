import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";
import type { BoundsTuple, QuadCoordinates } from "../types";
import { colorizeNormalizedValue, normalizeValue } from "./colorRamp";
import { boundsFromCoordinates } from "./bounds";

type NumericArray = ArrayLike<number>;
type ProjectionResult = {
  project: (x: number, y: number) => [number, number];
};

export interface GeoTIFFBand {
  id: string;
  label: string;
  max: number;
  min: number;
  values: NumericArray;
}

export interface GeoTIFFOverlay {
  bands: GeoTIFFBand[];
  coordinates: QuadCoordinates;
  defaultSelection: string;
  fitBounds: BoundsTuple;
  height: number;
  supportsComposite: boolean;
  width: number;
}

export async function prepareGeoTIFFOverlay(buffer: ArrayBuffer): Promise<GeoTIFFOverlay> {
  const tiff = await fromArrayBuffer(buffer);
  const imageCount = await tiff.getImageCount();
  if (imageCount !== 1) {
    throw new Error("Only single-image GeoTIFF files are supported in this preview.");
  }

  const image = await tiff.getImage();
  const fileDirectory = (image.fileDirectory ?? {}) as unknown as Record<string, unknown>;

  if ("ModelTransformation" in fileDirectory || "ModelTransformationTag" in fileDirectory) {
    throw new Error("Rotated or skewed GeoTIFF files are not supported.");
  }

  if ("ColorMap" in fileDirectory || Number(fileDirectory.PhotometricInterpretation) === 3) {
    throw new Error("Palette-based GeoTIFF files are not supported.");
  }

  const samplesPerPixel = Number(image.getSamplesPerPixel());
  if (![1, 3, 4].includes(samplesPerPixel)) {
    throw new Error(`GeoTIFF files with ${samplesPerPixel} bands are not supported.`);
  }

  const width = image.getWidth();
  const height = image.getHeight();
  const bounds = image.getBoundingBox() as BoundsTuple | undefined;
  if (!bounds || bounds.length !== 4) {
    throw new Error("GeoTIFF bounds are missing or invalid.");
  }

  const resolution = image.getResolution();
  if (Math.abs(Number(resolution[2] ?? 0)) > 1e-9) {
    throw new Error("Rotated or skewed GeoTIFF files are not supported.");
  }

  const projection = createProjection(image.getGeoKeys());
  const coordinates = projectBounds(bounds, projection);
  const rasters = await image.readRasters({ interleave: false });
  const bandArrays = normalizeRasterArray(rasters);
  const noDataValue = getNoDataValue(image);

  if (bandArrays.length !== samplesPerPixel) {
    throw new Error("GeoTIFF band data is inconsistent.");
  }

  const bands = bandArrays.map((values, index) => ({
    id: `band:${index}`,
    label: `Band ${index + 1}`,
    max: computeBandRange(values, noDataValue).max,
    min: computeBandRange(values, noDataValue).min,
    values
  }));
  const supportsComposite = bandArrays.length >= 3;

  return {
    bands,
    coordinates,
    defaultSelection: supportsComposite ? "composite" : "band:0",
    fitBounds: boundsFromCoordinates(coordinates),
    height,
    supportsComposite,
    width
  };
}

export function drawOverlayCanvas(overlay: GeoTIFFOverlay, selection: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = overlay.width;
  canvas.height = overlay.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a canvas context for the GeoTIFF overlay.");
  }

  const imageData = context.createImageData(overlay.width, overlay.height);
  imageData.data.set(renderSelectionPixels(overlay, selection));
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function renderSelectionPixels(overlay: GeoTIFFOverlay, selection: string): Uint8ClampedArray {
  if (selection === "composite" && overlay.supportsComposite) {
    return buildCompositeRGBAData(overlay.bands, overlay.width * overlay.height);
  }

  const band = overlay.bands.find((candidate) => candidate.id === selection) ?? overlay.bands[0];
  return buildBandRGBAData(band, overlay.width * overlay.height);
}

export function describeGeoTIFFSelection(overlay: GeoTIFFOverlay, selection: string): string {
  if (selection === "composite" && overlay.supportsComposite) {
    return "Rendering the raster as a composite RGB overlay.";
  }

  const band = overlay.bands.find((candidate) => candidate.id === selection) ?? overlay.bands[0];
  return `Coloring the raster by ${band.label}.`;
}

export function selectorOptionsForGeoTIFF(overlay: GeoTIFFOverlay): Array<{ label: string; value: string }> {
  const options = overlay.supportsComposite ? [{ label: "Composite RGB", value: "composite" }] : [];
  return [
    ...options,
    ...overlay.bands.map((band) => ({
      label: band.label,
      value: band.id
    }))
  ];
}

function projectBounds(bounds: BoundsTuple, projection: ProjectionResult): QuadCoordinates {
  const [minX, minY, maxX, maxY] = bounds;
  return [
    projection.project(minX, maxY),
    projection.project(maxX, maxY),
    projection.project(maxX, minY),
    projection.project(minX, minY)
  ];
}

function createProjection(geoKeys: unknown): ProjectionResult {
  if (!geoKeys || typeof geoKeys !== "object" || Object.keys(geoKeys as Record<string, unknown>).length === 0) {
    throw new Error("GeoTIFF coordinate reference system metadata is missing.");
  }

  const values = geoKeys as Record<string, unknown>;

  const geographicCode = Number(values.GeographicTypeGeoKey);
  if (geographicCode === 4326) {
    return {
      project: (x, y) => validateProjectedPoint([x, y])
    };
  }

  const projectedCode = Number(values.ProjectedCSTypeGeoKey);
  if (projectedCode === 3857) {
    const projection = proj4("EPSG:3857", "WGS84");
    return {
      project: (x, y) => validateProjectedPoint(projection.forward([x, y]) as [number, number])
    };
  }

  const projectionInfo = geokeysToProj4.toProj4(geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0]);
  if (!projectionInfo?.proj4) {
    throw new Error("Unable to derive a supported projection from the GeoTIFF metadata.");
  }

  const projection = proj4(projectionInfo.proj4, "WGS84");

  return {
    project: (x, y) => {
      const converted = projectionInfo.shouldConvertCoordinates
        ? geokeysToProj4.convertCoordinates(x, y, 0, projectionInfo.coordinatesConversionParameters)
        : { x, y, z: 0 };
      return validateProjectedPoint(projection.forward([converted.x, converted.y]) as [number, number]);
    }
  };
}

function validateProjectedPoint(point: [number, number]): [number, number] {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new Error("Failed to reproject GeoTIFF bounds to WGS84.");
  }

  return point;
}

function normalizeRasterArray(rasters: unknown): NumericArray[] {
  if (Array.isArray(rasters)) {
    return rasters as NumericArray[];
  }

  if (rasters && typeof rasters === "object" && "length" in (rasters as Record<string, unknown>)) {
    return [rasters as NumericArray];
  }

  throw new Error("GeoTIFF raster data is missing.");
}

function buildCompositeRGBAData(bands: GeoTIFFBand[], pixelCount: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  const red = stretchToByteRange(bands[0].values, bands[0].min, bands[0].max);
  const green = stretchToByteRange(bands[1].values, bands[1].min, bands[1].max);
  const blue = stretchToByteRange(bands[2].values, bands[2].min, bands[2].max);
  const alpha = bands.length >= 4 ? stretchToByteRange(bands[3].values, bands[3].min, bands[3].max) : null;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    pixels[offset] = red[index];
    pixels[offset + 1] = green[index];
    pixels[offset + 2] = blue[index];
    pixels[offset + 3] = alpha ? alpha[index] : 255;
  }

  return pixels;
}

function buildBandRGBAData(band: GeoTIFFBand, pixelCount: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(pixelCount * 4);

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const value = Number(band.values[index]);
    const [red, green, blue] = colorizeNormalizedValue(normalizeValue(value, band.min, band.max));
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = Number.isFinite(value) ? 255 : 0;
  }

  return pixels;
}

function stretchToByteRange(values: NumericArray, min: number, max: number): Uint8ClampedArray {
  const stretched = new Uint8ClampedArray(values.length);

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    stretched[index] = !Number.isFinite(value) ? 0 : Math.round(normalizeValue(value, min, max) * 255);
  }

  return stretched;
}

function computeBandRange(values: NumericArray, noDataValue: number | null): { max: number; min: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value) || (noDataValue !== null && value === noDataValue)) {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { max: 1, min: 0 };
  }

  return { max, min };
}

function getNoDataValue(image: unknown): number | null {
  const candidate = typeof (image as { getGDALNoData?: () => unknown }).getGDALNoData === "function"
    ? Number((image as { getGDALNoData: () => unknown }).getGDALNoData())
    : Number.NaN;
  return Number.isFinite(candidate) ? candidate : null;
}
