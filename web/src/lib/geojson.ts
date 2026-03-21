import type { BoundsTuple } from "../types";
import { expandDegenerateBounds } from "./bounds";

export function prepareGeoJSONOverlay(rawText: string): { fitBounds: BoundsTuple; geojson: unknown } {
  const geojson = JSON.parse(rawText) as Record<string, unknown>;
  const fitBounds = computeGeoJSONBounds(geojson);
  return { fitBounds, geojson };
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

