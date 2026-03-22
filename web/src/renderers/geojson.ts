import type { GeoJSONSourceSpecification } from "maplibre-gl";
import { boundsToMapLibre } from "../lib/bounds";
import { buildNumericColorExpression } from "../lib/colorRamp";
import { prepareGeoJSONOverlay, type GeoJSONNumericAttribute } from "../lib/geojson";
import type { Renderer } from "../types";

const SOURCE_ID = "qlgis-geojson-source";
const FILL_LAYER_ID = "qlgis-geojson-fill";
const LINE_LAYER_ID = "qlgis-geojson-line";
const POINT_LAYER_ID = "qlgis-geojson-point";
const DEFAULT_FILL_COLOR = "#2a7b9b";
const DEFAULT_LINE_COLOR = "#0d5f8b";
const DEFAULT_POINT_COLOR = "#f28f3b";

export const renderGeoJSONPreview: Renderer = async ({ bootstrap, clearBanner, map, setMeta, setSelector, setStatus }) => {
  window.__QLGISNativeLog__?.("info", "starting GeoJSON renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();

  const response = await fetch(bootstrap.dataURL);
  const rawText = await response.text();
  const { fitBounds, geojson, numericAttributes } = prepareGeoJSONOverlay(rawText);
  window.__QLGISNativeLog__?.("info", "GeoJSON overlay prepared", JSON.stringify(fitBounds));

  removeGeoJSONLayers(map);
  map.addSource(SOURCE_ID, {
    data: geojson as GeoJSONSourceSpecification["data"],
    type: "geojson"
  } satisfies GeoJSONSourceSpecification);

  map.addLayer({
    filter: ["==", ["geometry-type"], "Polygon"],
    id: FILL_LAYER_ID,
    paint: {
      "fill-color": DEFAULT_FILL_COLOR,
      "fill-opacity": 0.22,
      "fill-outline-color": DEFAULT_LINE_COLOR
    },
    source: SOURCE_ID,
    type: "fill"
  });

  map.addLayer({
    id: LINE_LAYER_ID,
    paint: {
      "line-color": DEFAULT_LINE_COLOR,
      "line-width": 3
    },
    source: SOURCE_ID,
    type: "line"
  });

  map.addLayer({
    filter: ["==", ["geometry-type"], "Point"],
    id: POINT_LAYER_ID,
    paint: {
      "circle-color": DEFAULT_POINT_COLOR,
      "circle-radius": 7,
      "circle-stroke-color": "#173753",
      "circle-stroke-width": 2
    },
    source: SOURCE_ID,
    type: "circle"
  });

  const initialAttribute = numericAttributes[0] ?? null;
  applyGeoJSONAttribute(map, initialAttribute);

  setMeta({
    description: describeGeoJSONAttribute(initialAttribute),
    eyebrow: "GEOJSON",
    title: bootstrap.displayName
  });
  setSelector(
    numericAttributes.length > 1
      ? {
          label: "Variable",
          onChange: (value) => {
            const nextAttribute = numericAttributes.find((candidate) => candidate.key === value) ?? null;
            applyGeoJSONAttribute(map, nextAttribute);
            setMeta({
              description: describeGeoJSONAttribute(nextAttribute),
              eyebrow: "GEOJSON",
              title: bootstrap.displayName
            });
          },
          options: numericAttributes.map((attribute) => ({
            label: attribute.key,
            value: attribute.key
          })),
          value: initialAttribute?.key ?? numericAttributes[0]?.key ?? ""
        }
      : null
  );

  map.fitBounds(boundsToMapLibre(fitBounds), { animate: false, padding: 40 });
  setStatus(null);

  return () => {
    setSelector(null);
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

function applyGeoJSONAttribute(map: RendererMap, attribute: GeoJSONNumericAttribute | null): void {
  const fillColor = attribute
    ? buildNumericColorExpression(attribute.key, attribute.min, attribute.max, DEFAULT_FILL_COLOR)
    : DEFAULT_FILL_COLOR;
  const lineColor = attribute
    ? buildNumericColorExpression(attribute.key, attribute.min, attribute.max, DEFAULT_LINE_COLOR)
    : DEFAULT_LINE_COLOR;
  const pointColor = attribute
    ? buildNumericColorExpression(attribute.key, attribute.min, attribute.max, DEFAULT_POINT_COLOR)
    : DEFAULT_POINT_COLOR;

  map.setPaintProperty(FILL_LAYER_ID, "fill-color", fillColor);
  map.setPaintProperty(FILL_LAYER_ID, "fill-outline-color", lineColor);
  map.setPaintProperty(LINE_LAYER_ID, "line-color", lineColor);
  map.setPaintProperty(POINT_LAYER_ID, "circle-color", pointColor);
}

function describeGeoJSONAttribute(attribute: GeoJSONNumericAttribute | null): string {
  if (!attribute) {
    return "Showing default feature styling.";
  }

  return `Coloring features by ${attribute.key}.`;
}
