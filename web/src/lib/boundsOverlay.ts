import type { GeoJSONSourceSpecification, Map } from "maplibre-gl";
import type { BoundsTuple } from "../types";

export function addBoundsOverlay(map: Map, sourceId: string, fillLayerId: string, lineLayerId: string, bounds: BoundsTuple): void {
  removeBoundsOverlay(map, sourceId, fillLayerId, lineLayerId);
  map.addSource(sourceId, {
    data: {
      features: [
        {
          geometry: {
            coordinates: [[
              [bounds[0], bounds[1]],
              [bounds[2], bounds[1]],
              [bounds[2], bounds[3]],
              [bounds[0], bounds[3]],
              [bounds[0], bounds[1]]
            ]],
            type: "Polygon"
          },
          properties: {},
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    },
    type: "geojson"
  } satisfies GeoJSONSourceSpecification);

  map.addLayer({
    id: fillLayerId,
    paint: {
      "fill-color": "#ee9b00",
      "fill-opacity": 0.1
    },
    source: sourceId,
    type: "fill"
  });

  map.addLayer({
    id: lineLayerId,
    paint: {
      "line-color": "#bb3e03",
      "line-dasharray": [2, 1.5],
      "line-width": 2
    },
    source: sourceId,
    type: "line"
  });
}

export function removeBoundsOverlay(map: Map, sourceId: string, fillLayerId: string, lineLayerId: string): void {
  for (const layerId of [lineLayerId, fillLayerId]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }

  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}
