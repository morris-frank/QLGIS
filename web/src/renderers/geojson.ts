import type { GeoJSONSourceSpecification } from "maplibre-gl";
import { boundsToMapLibre } from "../lib/bounds";
import { prepareGeoJSONOverlay } from "../lib/geojson";
import type { Renderer } from "../types";

const SOURCE_ID = "qlgis-geojson-source";
const FILL_LAYER_ID = "qlgis-geojson-fill";
const LINE_LAYER_ID = "qlgis-geojson-line";
const POINT_LAYER_ID = "qlgis-geojson-point";

export const renderGeoJSONPreview: Renderer = async ({ bootstrap, clearBanner, map, setStatus, showBanner }) => {
  window.__QLGISNativeLog__?.("info", "starting GeoJSON renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();

  const response = await fetch(bootstrap.dataURL);
  const rawText = await response.text();
  const { fitBounds, geojson } = prepareGeoJSONOverlay(rawText);
  window.__QLGISNativeLog__?.("info", "GeoJSON overlay prepared", JSON.stringify(fitBounds));

  removeGeoJSONLayers(map);
  map.addSource(SOURCE_ID, {
    data: geojson,
    type: "geojson"
  } satisfies GeoJSONSourceSpecification);

  map.addLayer({
    filter: ["==", ["geometry-type"], "Polygon"],
    id: FILL_LAYER_ID,
    paint: {
      "fill-color": "#2a7b9b",
      "fill-opacity": 0.22,
      "fill-outline-color": "#0d5f8b"
    },
    source: SOURCE_ID,
    type: "fill"
  });

  map.addLayer({
    id: LINE_LAYER_ID,
    paint: {
      "line-color": "#0d5f8b",
      "line-width": 3
    },
    source: SOURCE_ID,
    type: "line"
  });

  map.addLayer({
    filter: ["==", ["geometry-type"], "Point"],
    id: POINT_LAYER_ID,
    paint: {
      "circle-color": "#f28f3b",
      "circle-radius": 7,
      "circle-stroke-color": "#173753",
      "circle-stroke-width": 2
    },
    source: SOURCE_ID,
    type: "circle"
  });

  map.fitBounds(boundsToMapLibre(fitBounds), { animate: false, padding: 40 });
  setStatus(null);
  showBanner(`${bootstrap.displayName} rendered as GeoJSON.`);

  return () => {
    removeGeoJSONLayers(map);
  };
};

function removeGeoJSONLayers(map: RendererMap): void {
  for (const layerId of [POINT_LAYER_ID, LINE_LAYER_ID, FILL_LAYER_ID]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }

  if (map.getSource(SOURCE_ID)) {
    map.removeSource(SOURCE_ID);
  }
}

type RendererMap = Parameters<Renderer>[0]["map"];
