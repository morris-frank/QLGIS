import { boundsToMapLibre } from "../lib/bounds";
import { drawOverlayCanvas, prepareGeoTIFFOverlay } from "../lib/geotiff";
import type { Renderer } from "../types";

const SOURCE_ID = "qlgis-geotiff-source";
const LAYER_ID = "qlgis-geotiff-layer";

export const renderGeoTIFFPreview: Renderer = async ({ bootstrap, clearBanner, map, setStatus, showBanner }) => {
  window.__QLGISNativeLog__?.("info", "starting GeoTIFF renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();

  const response = await fetch(bootstrap.dataURL);
  window.__QLGISNativeLog__?.("info", "GeoTIFF bytes fetched", `ok=${response.ok} status=${response.status}`);
  const overlay = await prepareGeoTIFFOverlay(await response.arrayBuffer());
  window.__QLGISNativeLog__?.(
    "info",
    "GeoTIFF overlay prepared",
    JSON.stringify({ coordinates: overlay.coordinates, fitBounds: overlay.fitBounds, height: overlay.height, mode: overlay.mode, width: overlay.width })
  );
  const canvas = drawOverlayCanvas(overlay);
  const imageURL = canvas.toDataURL("image/png");

  removeGeoTIFFLayers(map);
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
  window.__QLGISNativeLog__?.("info", "GeoTIFF source and layer added");

  map.fitBounds(boundsToMapLibre(overlay.fitBounds), { animate: false, padding: 40 });
  window.__QLGISNativeLog__?.("info", "GeoTIFF map fit applied", JSON.stringify(overlay.fitBounds));
  setStatus(null);
  showBanner(`${bootstrap.displayName} rendered as a ${overlay.mode.toUpperCase()} raster overlay.`);

  return () => {
    removeGeoTIFFLayers(map);
  };
};

function removeGeoTIFFLayers(map: RendererMap): void {
  if (map.getLayer(LAYER_ID)) {
    map.removeLayer(LAYER_ID);
  }

  if (map.getSource(SOURCE_ID)) {
    map.removeSource(SOURCE_ID);
  }
}

type RendererMap = Parameters<Renderer>[0]["map"];
