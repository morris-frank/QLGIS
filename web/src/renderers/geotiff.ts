import { boundsToMapLibre } from "../lib/bounds";
import { describeGeoTIFFSelection, drawOverlayCanvas, prepareGeoTIFFOverlay, selectorOptionsForGeoTIFF } from "../lib/geotiff";
import type { Renderer } from "../types";

const SOURCE_ID = "qlgis-geotiff-source";
const LAYER_ID = "qlgis-geotiff-layer";

export const renderGeoTIFFPreview: Renderer = async ({ bootstrap, clearBanner, map, setMeta, setSelector, setStatus }) => {
  window.__QLGISNativeLog__?.("info", "starting GeoTIFF renderer", bootstrap.displayName);
  setStatus(`Loading ${bootstrap.displayName}…`);
  clearBanner();

  const response = await fetch(bootstrap.dataURL);
  window.__QLGISNativeLog__?.("info", "GeoTIFF bytes fetched", `ok=${response.ok} status=${response.status}`);
  const overlay = await prepareGeoTIFFOverlay(await response.arrayBuffer());
  let activeSelection = overlay.defaultSelection;
  window.__QLGISNativeLog__?.(
    "info",
    "GeoTIFF overlay prepared",
    JSON.stringify({ coordinates: overlay.coordinates, fitBounds: overlay.fitBounds, height: overlay.height, selection: activeSelection, width: overlay.width })
  );

  removeGeoTIFFLayers(map);
  applySelection(map, overlay, activeSelection);
  setMeta({
    description: describeGeoTIFFSelection(overlay, activeSelection),
    eyebrow: "GEOTIFF",
    title: bootstrap.displayName
  });
  setSelector(
    overlay.bands.length > 1
      ? {
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
        }
      : null
  );
  window.__QLGISNativeLog__?.("info", "GeoTIFF source and layer added");

  map.fitBounds(boundsToMapLibre(overlay.fitBounds), { animate: false, padding: 40 });
  window.__QLGISNativeLog__?.("info", "GeoTIFF map fit applied", JSON.stringify(overlay.fitBounds));
  setStatus(null);

  return () => {
    setSelector(null);
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

function applySelection(map: RendererMap, overlay: Awaited<ReturnType<typeof prepareGeoTIFFOverlay>>, selection: string): void {
  const canvas = drawOverlayCanvas(overlay, selection);
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
}
