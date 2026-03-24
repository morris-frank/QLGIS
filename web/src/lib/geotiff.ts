import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";
import type { BoundsTuple, FactItem, QuadCoordinates } from "../types";
import { colorizeNormalizedValue, normalizeValue } from "./colorRamp";
import { boundsFromCoordinates } from "./bounds";

type NumericArray = ArrayLike<number>;
type ProjectionResult = {
  label: string;
  project: (x: number, y: number) => [number, number];
};

export interface GeoTIFFBand {
  id: string;
  label: string;
  max: number;
  min: number;
  values: NumericArray;
}

export interface GeoTIFFPreview {
  bands: GeoTIFFBand[];
  coordinates: QuadCoordinates | null;
  defaultSelection: string;
  facts: FactItem[];
  fitBounds: BoundsTuple | null;
  height: number;
  noDataValue: number | null;
  renderMode: "raster" | "bounds-only" | "metadata-only";
  supportsComposite: boolean;
  warnings: string[];
  width: number;
}

export async function prepareGeoTIFFPreview(buffer: ArrayBuffer): Promise<GeoTIFFPreview> {
  const tiff = await fromArrayBuffer(buffer);
  const imageCount = await tiff.getImageCount();
  const image = await tiff.getImage(0);
  const fileDirectory = (image.fileDirectory ?? {}) as unknown as Record<string, unknown>;
  const warnings: string[] = [];

  if (imageCount > 1) {
    warnings.push(`Using the first image out of ${imageCount} images.`);
  }

  const width = image.getWidth();
  const height = image.getHeight();
  const noDataValue = getNoDataValue(image);
  const bounds = image.getBoundingBox() as BoundsTuple | undefined;
  const hasTransform = "ModelTransformation" in fileDirectory || "ModelTransformationTag" in fileDirectory;
  const resolution = image.getResolution();
  const hasRotation = Math.abs(Number(resolution[2] ?? 0)) > 1e-9;
  if (hasTransform || hasRotation) {
    warnings.push("Showing the bounding box because rotated or skewed rasters are not rasterized yet.");
  }

  const rasters = await image.readRasters({ interleave: false });
  const bandArrays = normalizeRasterArray(rasters);
  const bands = bandArrays.map((values, index) => {
    const range = computeBandRange(values, noDataValue);
    return {
      id: `band:${index}`,
      label: `Band ${index + 1}`,
      max: range.max,
      min: range.min,
      values
    };
  });
  const supportsComposite = bands.length >= 3;

  let coordinates: QuadCoordinates | null = null;
  let fitBounds: BoundsTuple | null = null;
  let crsLabel = "Unknown";

  if (bounds && bounds.length === 4) {
    try {
      const projection = createProjection(image.getGeoKeys());
      crsLabel = projection.label;
      coordinates = projectBounds(bounds, projection);
      fitBounds = boundsFromCoordinates(coordinates);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const renderMode = coordinates && !hasTransform && !hasRotation ? "raster" : fitBounds ? "bounds-only" : "metadata-only";

  return {
    bands,
    coordinates,
    defaultSelection: supportsComposite ? "composite" : "band:0",
    facts: buildFacts({
      bands,
      bounds,
      crsLabel,
      height,
      imageCount,
      noDataValue,
      width
    }),
    fitBounds,
    height,
    noDataValue,
    renderMode,
    supportsComposite,
    warnings,
    width
  };
}

export function drawOverlayCanvas(preview: GeoTIFFPreview, selection: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = preview.width;
  canvas.height = preview.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a canvas context for the GeoTIFF overlay.");
  }

  const imageData = context.createImageData(preview.width, preview.height);
  imageData.data.set(renderSelectionPixels(preview, selection));
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function renderSelectionPixels(preview: GeoTIFFPreview, selection: string): Uint8ClampedArray {
  if (selection === "composite" && preview.supportsComposite) {
    return buildCompositeRGBAData(preview.bands, preview.noDataValue, preview.width * preview.height);
  }

  const band = preview.bands.find((candidate) => candidate.id === selection) ?? preview.bands[0];
  return buildBandRGBAData(band, preview.noDataValue, preview.width * preview.height);
}

export function describeGeoTIFFSelection(preview: GeoTIFFPreview, selection: string): string {
  if (preview.renderMode === "bounds-only") {
    return "Showing the projected bounding box and metadata because the raster cannot yet be drawn safely.";
  }

  if (preview.renderMode === "metadata-only") {
    return "Showing metadata because the raster coordinates could not be projected to WGS84.";
  }

  if (selection === "composite" && preview.supportsComposite) {
    return "Rendering the raster as a composite RGB overlay.";
  }

  const band = preview.bands.find((candidate) => candidate.id === selection) ?? preview.bands[0];
  return `Coloring the raster by ${band.label}.`;
}

export function selectorOptionsForGeoTIFF(preview: GeoTIFFPreview): Array<{ label: string; value: string }> {
  const options = preview.supportsComposite ? [{ label: "Composite RGB", value: "composite" }] : [];
  return [
    ...options,
    ...preview.bands.map((band) => ({
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
    throw new Error("GeoTIFF CRS metadata is missing.");
  }

  const values = geoKeys as Record<string, unknown>;
  const geographicCode = Number(values.GeographicTypeGeoKey);
  if (geographicCode === 4326) {
    return {
      label: "EPSG:4326",
      project: (x, y) => validateProjectedPoint([x, y])
    };
  }

  const projectedCode = Number(values.ProjectedCSTypeGeoKey);
  if (projectedCode === 3857) {
    const projection = proj4("EPSG:3857", "WGS84");
    return {
      label: "EPSG:3857",
      project: (x, y) => validateProjectedPoint(projection.forward([x, y]) as [number, number])
    };
  }

  const projectionInfo = geokeysToProj4.toProj4(geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0]);
  if (!projectionInfo?.proj4) {
    throw new Error("Unable to derive a supported projection from the GeoTIFF metadata.");
  }

  const projection = proj4(projectionInfo.proj4, "WGS84");
  return {
    label: projectionInfo.proj4,
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

function buildCompositeRGBAData(bands: GeoTIFFBand[], noDataValue: number | null, pixelCount: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  const red = stretchToByteRange(bands[0].values, bands[0].min, bands[0].max, noDataValue);
  const green = stretchToByteRange(bands[1].values, bands[1].min, bands[1].max, noDataValue);
  const blue = stretchToByteRange(bands[2].values, bands[2].min, bands[2].max, noDataValue);
  const alpha = bands.length >= 4 ? stretchToByteRange(bands[3].values, bands[3].min, bands[3].max, noDataValue) : null;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const values = [Number(bands[0].values[index]), Number(bands[1].values[index]), Number(bands[2].values[index])];
    const hasNoData = values.some((value) => noDataValue !== null && value === noDataValue);
    pixels[offset] = red[index];
    pixels[offset + 1] = green[index];
    pixels[offset + 2] = blue[index];
    pixels[offset + 3] = hasNoData ? 0 : alpha ? alpha[index] : 255;
  }

  return pixels;
}

function buildBandRGBAData(band: GeoTIFFBand, noDataValue: number | null, pixelCount: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(pixelCount * 4);

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const value = Number(band.values[index]);
    const [red, green, blue] = colorizeNormalizedValue(normalizeValue(value, band.min, band.max));
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = !Number.isFinite(value) || (noDataValue !== null && value === noDataValue) ? 0 : 255;
  }

  return pixels;
}

function stretchToByteRange(values: NumericArray, min: number, max: number, noDataValue: number | null): Uint8ClampedArray {
  const stretched = new Uint8ClampedArray(values.length);

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    stretched[index] = !Number.isFinite(value) || (noDataValue !== null && value === noDataValue)
      ? 0
      : Math.round(normalizeValue(value, min, max) * 255);
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

function buildFacts(input: {
  bands: GeoTIFFBand[];
  bounds?: BoundsTuple;
  crsLabel: string;
  height: number;
  imageCount: number;
  noDataValue: number | null;
  width: number;
}): FactItem[] {
  return [
    { label: "Images", value: String(input.imageCount) },
    { label: "Size", value: `${input.width} × ${input.height}` },
    { label: "CRS", value: input.crsLabel },
    { label: "Bounds", value: input.bounds ? formatBounds(input.bounds) : "Unavailable" },
    { label: "Bands", value: input.bands.map((band) => `${band.label} ${formatRange(band.min, band.max)}`).join(" | ") },
    { label: "NoData", value: input.noDataValue === null ? "None" : String(input.noDataValue) }
  ];
}

function formatBounds(bounds: BoundsTuple): string {
  return bounds.map((value) => value.toFixed(4)).join(", ");
}

function formatRange(min: number, max: number): string {
  return `[${min.toFixed(3)}, ${max.toFixed(3)}]`;
}

function getNoDataValue(image: unknown): number | null {
  const candidate = typeof (image as { getGDALNoData?: () => unknown }).getGDALNoData === "function"
    ? Number((image as { getGDALNoData: () => unknown }).getGDALNoData())
    : Number.NaN;
  return Number.isFinite(candidate) ? candidate : null;
}
