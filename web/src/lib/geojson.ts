import proj4 from "proj4";
import type { BoundsTuple } from "../types";
import { expandDegenerateBounds } from "./bounds";

export interface GeoJSONNumericAttribute {
  key: string;
  max: number;
  min: number;
}

export interface GeoJSONOverlay {
  crsLabel: string;
  featureCount: number;
  fitBounds: BoundsTuple;
  geojson: unknown;
  numericAttributes: GeoJSONNumericAttribute[];
}

export function prepareGeoJSONOverlay(rawText: string): GeoJSONOverlay {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  const normalized = normalizeGeoJSONCRS(parsed);
  return {
    crsLabel: normalized.crsLabel,
    featureCount: countGeoJSONFeatures(normalized.geojson),
    fitBounds: computeGeoJSONBounds(normalized.geojson),
    geojson: normalized.geojson,
    numericAttributes: detectNumericGeoJSONAttributes(normalized.geojson)
  };
}

export function computeGeoJSONBounds(node: unknown): BoundsTuple {
  if (!node || typeof node !== "object") {
    throw new Error("GeoJSON payload is empty.");
  }

  const candidate = node as Record<string, unknown>;
  if (Array.isArray(candidate.bbox) && candidate.bbox.length >= 4) {
    return expandDegenerateBounds([
      Number(candidate.bbox[0]),
      Number(candidate.bbox[1]),
      Number(candidate.bbox[2]),
      Number(candidate.bbox[3])
    ]);
  }

  const bounds: BoundsTuple = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ];

  walkGeoJSON(candidate, (coordinate) => {
    const [lng, lat] = coordinate;
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
  });

  if (bounds.some((value) => !Number.isFinite(value))) {
    throw new Error("GeoJSON does not contain any coordinates.");
  }

  return expandDegenerateBounds(bounds);
}

export function detectNumericGeoJSONAttributes(node: unknown): GeoJSONNumericAttribute[] {
  const stats = new Map<string, { max: number; min: number }>();

  walkGeoJSONFeatures(node, (feature) => {
    const properties = feature.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      return;
    }

    for (const [key, rawValue] of Object.entries(properties as Record<string, unknown>)) {
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
        continue;
      }

      const existing = stats.get(key);
      if (existing) {
        existing.min = Math.min(existing.min, rawValue);
        existing.max = Math.max(existing.max, rawValue);
      } else {
        stats.set(key, { min: rawValue, max: rawValue });
      }
    }
  });

  return [...stats.entries()]
    .map(([key, value]) => ({
      key,
      max: value.max,
      min: value.min
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeGeoJSONCRS(node: Record<string, unknown>): { crsLabel: string; geojson: Record<string, unknown> } {
  const crsName = extractGeoJSONCRSName(node);
  if (!crsName || isWGS84CRS(crsName)) {
    return { crsLabel: crsName ?? "WGS84", geojson: node };
  }

  const projection = createGeoJSONProjection(crsName);
  const cloned = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
  walkGeoJSONCoordinates(cloned, (coordinate) => {
    const projected = projection.forward([Number(coordinate[0]), Number(coordinate[1])]);
    coordinate[0] = projected[0];
    coordinate[1] = projected[1];
  });
  delete cloned.crs;

  return {
    crsLabel: `Reprojected from ${crsName}`,
    geojson: cloned
  };
}

function extractGeoJSONCRSName(node: Record<string, unknown>): string | null {
  const crs = node.crs;
  if (!crs || typeof crs !== "object") {
    return null;
  }

  const candidate = crs as Record<string, unknown>;
  if (candidate.type === "name" && candidate.properties && typeof candidate.properties === "object") {
    const name = (candidate.properties as Record<string, unknown>).name;
    return typeof name === "string" ? name : null;
  }

  return null;
}

function createGeoJSONProjection(crsName: string): proj4.Converter {
  const normalizedName = normalizeCRSName(crsName);
  const definition = lookupCRSDefinition(normalizedName);
  if (!definition) {
    throw new Error(`Unsupported GeoJSON CRS: ${crsName}`);
  }

  if (!proj4.defs(normalizedName)) {
    proj4.defs(normalizedName, definition);
  }

  return proj4(normalizedName, "EPSG:4326");
}

function normalizeCRSName(value: string): string {
  const trimmed = value.trim();
  const urnMatch = trimmed.match(/EPSG(?::|::)(\d+)$/i);
  if (urnMatch) {
    return `EPSG:${urnMatch[1]}`;
  }

  const epsgMatch = trimmed.match(/^EPSG:(\d+)$/i);
  if (epsgMatch) {
    return `EPSG:${epsgMatch[1]}`;
  }

  if (/CRS84$/i.test(trimmed)) {
    return "CRS84";
  }

  return trimmed.toUpperCase();
}

function isWGS84CRS(value: string): boolean {
  const normalized = normalizeCRSName(value);
  return normalized === "EPSG:4326" || normalized === "CRS84";
}

function lookupCRSDefinition(name: string): string | null {
  switch (name) {
    case "EPSG:25832":
      return "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs";
    case "EPSG:25833":
      return "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs";
    case "EPSG:32632":
      return "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs";
    case "EPSG:32633":
      return "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs";
    case "EPSG:3035":
      return "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs";
    case "EPSG:3857":
      return "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs";
    case "EPSG:4326":
    case "CRS84":
      return "+proj=longlat +datum=WGS84 +no_defs";
    default:
      return null;
  }
}

function countGeoJSONFeatures(node: unknown): number {
  let count = 0;
  walkGeoJSONFeatures(node, () => {
    count += 1;
  });
  return count;
}

function walkGeoJSON(node: Record<string, unknown>, visit: (coordinate: [number, number]) => void): void {
  switch (node.type) {
    case "FeatureCollection":
      for (const feature of safeArray(node.features)) {
        if (feature && typeof feature === "object") {
          walkGeoJSON(feature as Record<string, unknown>, visit);
        }
      }
      return;
    case "Feature":
      if (node.geometry && typeof node.geometry === "object") {
        walkGeoJSON(node.geometry as Record<string, unknown>, visit);
      }
      return;
    case "GeometryCollection":
      for (const geometry of safeArray(node.geometries)) {
        if (geometry && typeof geometry === "object") {
          walkGeoJSON(geometry as Record<string, unknown>, visit);
        }
      }
      return;
    case "Point":
      visitCoordinate(node.coordinates, visit);
      return;
    case "MultiPoint":
    case "LineString":
      visitLineString(node.coordinates, visit);
      return;
    case "MultiLineString":
    case "Polygon":
      for (const line of safeArray(node.coordinates)) {
        visitLineString(line, visit);
      }
      return;
    case "MultiPolygon":
      for (const polygon of safeArray(node.coordinates)) {
        for (const line of safeArray(polygon)) {
          visitLineString(line, visit);
        }
      }
      return;
    default:
      throw new Error(`Unsupported GeoJSON type: ${String(node.type)}`);
  }
}

function walkGeoJSONFeatures(node: unknown, visit: (feature: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") {
    return;
  }

  const candidate = node as Record<string, unknown>;
  switch (candidate.type) {
    case "FeatureCollection":
      for (const feature of safeArray(candidate.features)) {
        walkGeoJSONFeatures(feature, visit);
      }
      return;
    case "Feature":
      visit(candidate);
      return;
    default:
      return;
  }
}

function walkGeoJSONCoordinates(node: Record<string, unknown>, visit: (coordinate: number[]) => void): void {
  switch (node.type) {
    case "FeatureCollection":
      for (const feature of safeArray(node.features)) {
        if (feature && typeof feature === "object") {
          walkGeoJSONCoordinates(feature as Record<string, unknown>, visit);
        }
      }
      return;
    case "Feature":
      if (node.geometry && typeof node.geometry === "object") {
        walkGeoJSONCoordinates(node.geometry as Record<string, unknown>, visit);
      }
      return;
    case "GeometryCollection":
      for (const geometry of safeArray(node.geometries)) {
        if (geometry && typeof geometry === "object") {
          walkGeoJSONCoordinates(geometry as Record<string, unknown>, visit);
        }
      }
      return;
    default:
      visitNestedCoordinates(node.coordinates, visit);
  }
}

function visitNestedCoordinates(value: unknown, visit: (coordinate: number[]) => void): void {
  if (!Array.isArray(value)) {
    return;
  }

  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value as number[]);
    return;
  }

  for (const item of value) {
    visitNestedCoordinates(item, visit);
  }
}

function visitLineString(value: unknown, visit: (coordinate: [number, number]) => void): void {
  for (const coordinate of safeArray(value)) {
    visitCoordinate(coordinate, visit);
  }
}

function visitCoordinate(value: unknown, visit: (coordinate: [number, number]) => void): void {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("GeoJSON coordinate is malformed.");
  }

  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error("GeoJSON coordinate is invalid.");
  }

  visit([lng, lat]);
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
