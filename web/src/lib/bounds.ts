import type { BoundsTuple, QuadCoordinates } from "../types";

export function expandDegenerateBounds(bounds: BoundsTuple, epsilon = 1e-6): BoundsTuple {
  let [minX, minY, maxX, maxY] = bounds;

  if (minX === maxX) {
    minX -= epsilon;
    maxX += epsilon;
  }

  if (minY === maxY) {
    minY -= epsilon;
    maxY += epsilon;
  }

  return [minX, minY, maxX, maxY];
}

export function boundsToMapLibre(bounds: BoundsTuple): [[number, number], [number, number]] {
  const [minX, minY, maxX, maxY] = expandDegenerateBounds(bounds);
  return [
    [minX, minY],
    [maxX, maxY]
  ];
}

export function boundsFromCoordinates(coordinates: QuadCoordinates): BoundsTuple {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return expandDegenerateBounds([
    normalizePrecision(minX),
    normalizePrecision(minY),
    normalizePrecision(maxX),
    normalizePrecision(maxY)
  ]);
}

function normalizePrecision(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Number(value.toFixed(12));
}
