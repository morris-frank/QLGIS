import { addBoundsOverlay, removeBoundsOverlay } from "../lib/boundsOverlay";
import { boundsToMapLibre } from "../lib/bounds";
import { describeGeoTIFFSelection, drawOverlayCanvas, prepareGeoTIFFPreview, selectorOptionsForGeoTIFF } from "../lib/geotiff";
import type { Renderer } from "../types";

const SOURCE_ID = "qlgis-geotiff-source";
const LAYER_ID = "qlgis-geotiff-layer";
const BOUNDS_SOURCE_ID = "qlgis-geotiff-bounds-source";
const BOUNDS_FILL_LAYER_ID = "qlgis-geotiff-bounds-fill";
const BOUNDS_LINE_LAYER_ID = "qlgis-geotiff-bounds-line";

export const renderGeoTIFFPreview: Renderer = async ({ bootstrap, clearBanner, map, setFacts, setMeta, setSelectors, setStatus, showBanner }) => {
  window.__QLGISNativeLog__?.("info", "starting GeoTIFF renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();

  const response = await fetch(bootstrap.dataURL);
  window.__QLGISNativeLog__?.("info", "GeoTIFF bytes fetched", `ok=${response.ok} status=${response.status}`);
  const overlay = await prepareGeoTIFFPreview(await response.arrayBuffer());
  let activeSelection = overlay.defaultSelection;
  window.__QLGISNativeLog__?.(
    "info",
    "GeoTIFF overlay prepared",
    JSON.stringify({ fitBounds: overlay.fitBounds, height: overlay.height, renderMode: overlay.renderMode, selection: activeSelection, width: overlay.width })
  );

  removeGeoTIFFLayers(map);
  setFacts(overlay.facts);
  applySelection(map, overlay, activeSelection);
  setMeta({
    description: describeGeoTIFFSelection(overlay, activeSelection),
    eyebrow: "GEOTIFF",
    title: bootstrap.displayName
  });
  setSelectors(
    overlay.bands.length > 1
      ? [{
          label: "Raster Variable",
          onChange: (value) => {
            activeSelection = value;
            applySelection(map, overlay, activeSelection);
            setMeta({
              description: describeGeoTIFFSelection(overlay, activeSelection),
              eyebrow: "GEOTIFF",
              title: bootstrap.displayName
            });
          },
          options: selectorOptionsForGeoTIFF(overlay),
          value: activeSelection
        }]
      : []
  );
  if (overlay.warnings.length > 0) {
    showBanner(overlay.warnings.join(" "));
  }
  window.__QLGISNativeLog__?.("info", "GeoTIFF source and layer added");

  if (overlay.fitBounds) {
    map.fitBounds(boundsToMapLibre(overlay.fitBounds), { animate: false, padding: 40 });
    window.__QLGISNativeLog__?.("info", "GeoTIFF map fit applied", JSON.stringify(overlay.fitBounds));
  }
  setStatus(null);

  return () => {
    setSelectors([]);
    removeGeoTIFFLayers(map);
  };
};

function removeGeoTIFFLayers(map: RendererMap): void {
  removeBoundsOverlay(map, BOUNDS_SOURCE_ID, BOUNDS_FILL_LAYER_ID, BOUNDS_LINE_LAYER_ID);

  if (map.getLayer(LAYER_ID)) {
    map.removeLayer(LAYER_ID);
  }

  if (map.getSource(SOURCE_ID)) {
    map.removeSource(SOURCE_ID);
  }
}

type RendererMap = Parameters<Renderer>[0]["map"];

function applySelection(map: RendererMap, overlay: Awaited<ReturnType<typeof prepareGeoTIFFPreview>>, selection: string): void {
  removeGeoTIFFLayers(map);

  if (overlay.renderMode !== "raster" || !overlay.coordinates || !overlay.fitBounds) {
    if (overlay.fitBounds) {
      addBoundsOverlay(map, BOUNDS_SOURCE_ID, BOUNDS_FILL_LAYER_ID, BOUNDS_LINE_LAYER_ID, overlay.fitBounds);
    }
    return;
  }

  const canvas = drawOverlayCanvas(overlay, selection);
  const imageURL = canvas.toDataURL("image/png");

  map.addSource(SOURCE_ID, {
    coordinates: overlay.coordinates,
    type: "image",
    url: imageURL
  });
  map.addLayer({
    id: LAYER_ID,
    paint: {
      "raster-opacity": 0.86,
      "raster-resampling": "linear"
    },
    source: SOURCE_ID,
    type: "raster"
  });
}
