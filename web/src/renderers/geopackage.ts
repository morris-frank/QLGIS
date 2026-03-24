import type { GeoJSONSourceSpecification } from "maplibre-gl";
import { addBoundsOverlay, removeBoundsOverlay } from "../lib/boundsOverlay";
import { boundsToMapLibre } from "../lib/bounds";
import { buildNumericColorExpression } from "../lib/colorRamp";
import { prepareGeoJSONOverlay, type GeoJSONNumericAttribute } from "../lib/geojson";
import type { Renderer } from "../types";

const SOURCE_ID = "qlgis-geopackage-source";
const FILL_LAYER_ID = "qlgis-geopackage-fill";
const LINE_LAYER_ID = "qlgis-geopackage-line";
const POINT_LAYER_ID = "qlgis-geopackage-point";
const BOUNDS_SOURCE_ID = "qlgis-geopackage-bounds-source";
const BOUNDS_FILL_LAYER_ID = "qlgis-geopackage-bounds-fill";
const BOUNDS_LINE_LAYER_ID = "qlgis-geopackage-bounds-line";
const DEFAULT_FILL_COLOR = "#2a7b9b";
const DEFAULT_LINE_COLOR = "#0d5f8b";
const DEFAULT_POINT_COLOR = "#f28f3b";

let wasmConfigured = false;

type GeoPackageModule = {
  GeoPackageAPI: {
    open(data: Uint8Array): Promise<GeoPackageHandle>;
  };
  setSqljsWasmLocateFile(callback: () => string): void;
};

type GeoPackageHandle = {
  close(): void;
  getFeatureDao(table: string): { getBoundingBox(): unknown };
  getFeatureTables(): string[];
  getTableContents(table: string): Record<string, unknown> | undefined;
  getTileTables(): string[];
  queryForGeoJSONFeaturesInTable(table: string, bounds: unknown): unknown[];
};

declare global {
  interface Window {
    GeoPackage?: GeoPackageModule;
  }
}

export const renderGeoPackagePreview: Renderer = async ({ bootstrap, clearBanner, map, setFacts, setMeta, setSelectors, setStatus, showBanner }) => {
  window.__QLGISNativeLog__?.("info", "starting GeoPackage renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();
  setSelectors([]);
  const module = getGeoPackageModule();
  configureWasmLocation(module);

  const response = await fetch(bootstrap.dataURL);
  const preview = await module.GeoPackageAPI.open(new Uint8Array(await response.arrayBuffer()));
  const featureTables = preview.getFeatureTables();
  const tileTables = preview.getTileTables();

  if (featureTables.length === 0) {
    const facts = [
      { label: "Feature Tables", value: "0" },
      { label: "Tile Tables", value: String(tileTables.length) },
      { label: "Tables", value: tileTables.join(", ") || "None" }
    ];
    setFacts(facts);
    setMeta({
      description: "Showing GeoPackage metadata because no feature tables are available for direct vector preview.",
      eyebrow: "GEOPACKAGE",
      title: bootstrap.displayName
    });

    const firstTileTable = tileTables[0];
    if (firstTileTable) {
      const contents = preview.getTableContents(firstTileTable);
      const minX = Number(contents?.min_x);
      const minY = Number(contents?.min_y);
      const maxX = Number(contents?.max_x);
      const maxY = Number(contents?.max_y);
      if ([minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) {
        addBoundsOverlay(map, BOUNDS_SOURCE_ID, BOUNDS_FILL_LAYER_ID, BOUNDS_LINE_LAYER_ID, [minX, minY, maxX, maxY]);
        map.fitBounds(boundsToMapLibre([minX, minY, maxX, maxY]), { animate: false, padding: 40 });
      }
    }

    setStatus(null);
    showBanner("This GeoPackage does not contain feature tables. Showing metadata instead.");
    return () => {
      preview.close();
      setSelectors([]);
      removeGeoPackageLayers(map);
    };
  }

  let activeTable = featureTables[0];
  let activeAttribute: GeoJSONNumericAttribute | null = null;

  const applyTable = (nextTable: string): void => {
    activeTable = nextTable;
    const featureDao = preview.getFeatureDao(activeTable);
    const bounds = featureDao.getBoundingBox();
    const features = preview.queryForGeoJSONFeaturesInTable(activeTable, bounds);
    const overlay = prepareGeoJSONOverlay(JSON.stringify({
      features,
      type: "FeatureCollection"
    }));

    removeGeoPackageLayers(map);
    map.addSource(SOURCE_ID, {
      data: overlay.geojson as GeoJSONSourceSpecification["data"],
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

    activeAttribute = overlay.numericAttributes[0] ?? null;
    applyGeoPackageAttribute(map, activeAttribute);
    setMeta({
      description: activeAttribute ? `Coloring ${activeTable} by ${activeAttribute.key}.` : `Showing ${activeTable} from the GeoPackage.`,
      eyebrow: "GEOPACKAGE",
      title: bootstrap.displayName
    });
    setFacts([
      { label: "Feature Tables", value: String(featureTables.length) },
      { label: "Tile Tables", value: String(tileTables.length) },
      { label: "Active Table", value: activeTable },
      { label: "Features", value: String(overlay.featureCount) },
      { label: "CRS", value: overlay.crsLabel },
      { label: "Variables", value: overlay.numericAttributes.length > 0 ? overlay.numericAttributes.map((attribute) => attribute.key).join(", ") : "None" }
    ]);
    setSelectors([
      {
        label: "Table",
        onChange: (value) => {
          applyTable(value);
        },
        options: featureTables.map((table) => ({ label: table, value: table })),
        value: activeTable
      },
      {
        label: "Variable",
        onChange: (value) => {
          activeAttribute = overlay.numericAttributes.find((candidate) => candidate.key === value) ?? null;
          applyGeoPackageAttribute(map, activeAttribute);
          setMeta({
            description: activeAttribute ? `Coloring ${activeTable} by ${activeAttribute.key}.` : `Showing ${activeTable} from the GeoPackage.`,
            eyebrow: "GEOPACKAGE",
            title: bootstrap.displayName
          });
        },
        options: overlay.numericAttributes.map((attribute) => ({ label: attribute.key, value: attribute.key })),
        value: activeAttribute?.key ?? overlay.numericAttributes[0]?.key ?? ""
      }
    ]);
    map.fitBounds(boundsToMapLibre(overlay.fitBounds), { animate: false, padding: 40 });
  };

  applyTable(activeTable);
  setStatus(null);

  return () => {
    preview.close();
    setSelectors([]);
    removeGeoPackageLayers(map);
  };
};

function getGeoPackageModule(): GeoPackageModule {
  if (!window.GeoPackage) {
    throw new Error("GeoPackage runtime failed to load.");
  }

  return window.GeoPackage;
}

function configureWasmLocation(module: GeoPackageModule): void {
  if (wasmConfigured) {
    return;
  }

  module.setSqljsWasmLocateFile(() => new URL("./sql-wasm.wasm", window.location.href).toString());
  wasmConfigured = true;
}

function applyGeoPackageAttribute(map: Parameters<Renderer>[0]["map"], attribute: GeoJSONNumericAttribute | null): void {
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

function removeGeoPackageLayers(map: Parameters<Renderer>[0]["map"]): void {
  removeBoundsOverlay(map, BOUNDS_SOURCE_ID, BOUNDS_FILL_LAYER_ID, BOUNDS_LINE_LAYER_ID);
  for (const layerId of [POINT_LAYER_ID, LINE_LAYER_ID, FILL_LAYER_ID]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }

  if (map.getSource(SOURCE_ID)) {
    map.removeSource(SOURCE_ID);
  }
}
