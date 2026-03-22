import maplibregl, { type LayerSpecification, type RasterSourceSpecification, type VectorSourceSpecification } from "maplibre-gl";
import type { Renderer } from "../types";
import { Protocol, PMTiles, FileSource, TileType } from "pmtiles";

const protocol = new Protocol({ metadata: true });
let protocolRegistered = false;
const SOURCE_ID = "qlgis-pmtiles-source";
const LAYER_PREFIX = "qlgis-pmtiles-layer";

export const renderPMTilesPreview: Renderer = async ({ bootstrap, clearBanner, map, setMeta, setSelector, setStatus }) => {
  window.__QLGISNativeLog__?.("info", "starting PMTiles renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();
  setSelector(null);
  ensureProtocolRegistered();

  const response = await fetch(bootstrap.dataURL);
  const blob = await response.blob();
  const sourceKey = `qlgis-${Date.now()}-${Math.random().toString(36).slice(2)}-${bootstrap.displayName}`;
  const file = new File([blob], sourceKey, { type: "application/vnd.pmtiles" });
  const archive = new PMTiles(new FileSource(file));
  protocol.add(archive);

  const header = await archive.getHeader();
  const tileURL = `pmtiles://${sourceKey}`;
  removePMTilesLayers(map);

  if (header.tileType === TileType.Mvt) {
    const tileJSON = (await archive.getTileJson(tileURL)) as { vector_layers?: Array<{ id?: string }> };
    const layerIds = (tileJSON.vector_layers ?? [])
      .map((entry) => entry.id?.trim())
      .filter((value): value is string => Boolean(value));

    if (layerIds.length === 0) {
      throw new Error("This PMTiles archive does not advertise any vector layers.");
    }

    map.addSource(SOURCE_ID, {
      maxzoom: header.maxZoom,
      minzoom: header.minZoom,
      type: "vector",
      url: tileURL
    } satisfies VectorSourceSpecification);

    for (const [index, sourceLayer] of layerIds.entries()) {
      const color = VECTOR_COLORS[index % VECTOR_COLORS.length];
      for (const layer of buildVectorLayers(sourceLayer, color)) {
        map.addLayer(layer);
      }
    }

    setMeta({
      description: `Showing ${layerIds.length} vector layer${layerIds.length === 1 ? "" : "s"} from the PMTiles archive.`,
      eyebrow: "PMTILES",
      title: bootstrap.displayName
    });
  } else if (RASTER_TILE_TYPES.has(header.tileType)) {
    map.addSource(SOURCE_ID, {
      maxzoom: header.maxZoom,
      minzoom: header.minZoom,
      tileSize: 256,
      type: "raster",
      url: tileURL
    } satisfies RasterSourceSpecification);
    map.addLayer({
      id: `${LAYER_PREFIX}-raster`,
      paint: {
        "raster-opacity": 0.92,
        "raster-resampling": "linear"
      },
      source: SOURCE_ID,
      type: "raster"
    });

    setMeta({
      description: "Showing raster tiles from the PMTiles archive.",
      eyebrow: "PMTILES",
      title: bootstrap.displayName
    });
  } else {
    throw new Error("This PMTiles archive uses a tile type that is not supported in the preview yet.");
  }

  if (hasFiniteBounds(header)) {
    map.fitBounds(
      [
        [header.minLon, header.minLat],
        [header.maxLon, header.maxLat]
      ],
      { animate: false, padding: 40 }
    );
  } else {
    map.jumpTo({ center: [header.centerLon, header.centerLat], zoom: header.centerZoom });
  }

  setStatus(null);

  return () => {
    setSelector(null);
    removePMTilesLayers(map);
  };
};

function ensureProtocolRegistered(): void {
  if (protocolRegistered) {
    return;
  }

  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

function buildVectorLayers(sourceLayer: string, color: string): LayerSpecification[] {
  return [
    {
      filter: ["==", ["geometry-type"], "Polygon"],
      id: `${LAYER_PREFIX}-fill-${sourceLayer}`,
      paint: {
        "fill-color": color,
        "fill-opacity": 0.26,
        "fill-outline-color": color
      },
      source: SOURCE_ID,
      "source-layer": sourceLayer,
      type: "fill"
    },
    {
      id: `${LAYER_PREFIX}-line-${sourceLayer}`,
      paint: {
        "line-color": color,
        "line-width": 2
      },
      source: SOURCE_ID,
      "source-layer": sourceLayer,
      type: "line"
    },
    {
      filter: ["==", ["geometry-type"], "Point"],
      id: `${LAYER_PREFIX}-circle-${sourceLayer}`,
      paint: {
        "circle-color": color,
        "circle-radius": 4.5,
        "circle-stroke-color": "#10263b",
        "circle-stroke-width": 1.25
      },
      source: SOURCE_ID,
      "source-layer": sourceLayer,
      type: "circle"
    }
  ];
}

function removePMTilesLayers(map: Parameters<Renderer>[0]["map"]): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith(LAYER_PREFIX)) {
      map.removeLayer(layer.id);
    }
  }

  if (map.getSource(SOURCE_ID)) {
    map.removeSource(SOURCE_ID);
  }
}

function hasFiniteBounds(header: { maxLat: number; maxLon: number; minLat: number; minLon: number }): boolean {
  return [header.minLon, header.minLat, header.maxLon, header.maxLat].every((value) => Number.isFinite(value));
}

const RASTER_TILE_TYPES = new Set<number>([TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif]);
const VECTOR_COLORS = ["#296a8f", "#8a6a00", "#8c3f58", "#0a7c66", "#5c5dd6"];
