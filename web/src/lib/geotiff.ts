import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";
import type { BoundsTuple, QuadCoordinates } from "../types";
import { boundsFromCoordinates } from "./bounds";

type NumericArray = ArrayLike<number>;
type ProjectionResult = {
  project: (x: number, y: number) => [number, number];
};

export interface GeoTIFFOverlay {
  coordinates: QuadCoordinates;
  fitBounds: BoundsTuple;
  height: number;
  mode: "grayscale" | "rgb" | "rgba";
  pixels: Uint8ClampedArray;
  width: number;
}

export async function prepareGeoTIFFOverlay(buffer: ArrayBuffer): Promise<GeoTIFFOverlay> {
  const tiff = await fromArrayBuffer(buffer);
  const imageCount = await tiff.getImageCount();
  if (imageCount !== 1) {
    throw new Error("Only single-image GeoTIFF files are supported in this preview.");
  }

  const image = await tiff.getImage();
  const fileDirectory = (image.fileDirectory ?? {}) as Record<string, unknown>;

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

  if (bandArrays.length !== samplesPerPixel) {
    throw new Error("GeoTIFF band data is inconsistent.");
  }

  const { mode, pixels } = buildRGBAData(bandArrays, width * height);

  return {
    coordinates,
    fitBounds: boundsFromCoordinates(coordinates),
    height,
    mode,
    pixels,
    width
  };
}

export function drawOverlayCanvas(overlay: GeoTIFFOverlay): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = overlay.width;
  canvas.height = overlay.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a canvas context for the GeoTIFF overlay.");
  }

  const imageData = context.createImageData(overlay.width, overlay.height);
  imageData.data.set(overlay.pixels);
  context.putImageData(imageData, 0, 0);
  return canvas;
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

function createProjection(geoKeys: Record<string, unknown>): ProjectionResult {
  if (!geoKeys || Object.keys(geoKeys).length === 0) {
    throw new Error("GeoTIFF coordinate reference system metadata is missing.");
  }

  const geographicCode = Number(geoKeys.GeographicTypeGeoKey);
  if (geographicCode === 4326) {
    return {
      project: (x, y) => validateProjectedPoint([x, y])
    };
  }

  const projectedCode = Number(geoKeys.ProjectedCSTypeGeoKey);
  if (projectedCode === 3857) {
    const projection = proj4("EPSG:3857", "WGS84");
    return {
      project: (x, y) => validateProjectedPoint(projection.forward([x, y]) as [number, number])
    };
  }

  const projectionInfo = geokeysToProj4.toProj4(geoKeys);
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

function buildRGBAData(bands: NumericArray[], pixelCount: number): { mode: GeoTIFFOverlay["mode"]; pixels: Uint8ClampedArray } {
  const pixels = new Uint8ClampedArray(pixelCount * 4);

  if (bands.length === 1) {
    const channel = stretchToByteRange(bands[0]);
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      pixels[offset] = channel[index];
      pixels[offset + 1] = channel[index];
      pixels[offset + 2] = channel[index];
      pixels[offset + 3] = 255;
    }
    return { mode: "grayscale", pixels };
  }

  const red = stretchToByteRange(bands[0]);
  const green = stretchToByteRange(bands[1]);
  const blue = stretchToByteRange(bands[2]);
  const alpha = bands.length === 4 ? stretchToByteRange(bands[3]) : null;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    pixels[offset] = red[index];
    pixels[offset + 1] = green[index];
    pixels[offset + 2] = blue[index];
    pixels[offset + 3] = alpha ? alpha[index] : 255;
  }

  return { mode: bands.length === 4 ? "rgba" : "rgb", pixels };
}

function stretchToByteRange(values: NumericArray): Uint8ClampedArray {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const range = max - min;
  const stretched = new Uint8ClampedArray(values.length);

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    stretched[index] = range === 0 ? 255 : Math.round(((value - min) / range) * 255);
  }

  return stretched;
}
