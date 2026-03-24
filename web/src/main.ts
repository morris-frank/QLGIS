import maplibregl, { Map } from "maplibre-gl";
import { addBoundsOverlay, removeBoundsOverlay } from "./lib/boundsOverlay";
import { renderGeoPackagePreview } from "./renderers/geopackage";
import { renderGeoJSONPreview } from "./renderers/geojson";
import { renderGeoTIFFPreview } from "./renderers/geotiff";
import { renderPMTilesPreview } from "./renderers/pmtiles";
import "./styles.css";
import type { BoundsTuple, Cleanup, FactItem, PreviewBootstrap, PreviewMeta, PreviewSupplementalInfo, Renderer, SelectorConfig } from "./types";

const renderers: Record<PreviewBootstrap["kind"], Renderer> = {
  geopackage: renderGeoPackagePreview,
  geojson: renderGeoJSONPreview,
  geotiff: renderGeoTIFFPreview,
  pmtiles: renderPMTilesPreview
};

const mapElement = document.querySelector<HTMLDivElement>("#map");
const metaEyebrowElement = document.querySelector<HTMLDivElement>("#meta-eyebrow");
const metaTitleElement = document.querySelector<HTMLDivElement>("#meta-title");
const metaDescriptionElement = document.querySelector<HTMLDivElement>("#meta-description");
const selectorsElement = document.querySelector<HTMLDivElement>("#selectors");
const factsElement = document.querySelector<HTMLDListElement>("#facts");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const bannerElement = document.querySelector<HTMLDivElement>("#banner");
const SUPPLEMENTAL_BOUNDS_SOURCE_ID = "qlgis-supplemental-bounds-source";
const SUPPLEMENTAL_BOUNDS_FILL_LAYER_ID = "qlgis-supplemental-bounds-fill";
const SUPPLEMENTAL_BOUNDS_LINE_LAYER_ID = "qlgis-supplemental-bounds-line";

let mapPromise: Promise<Map> | null = null;
let activeCleanup: Cleanup | null = null;
let activeMap: Map | null = null;
let currentSupplementalInfo: PreviewSupplementalInfo | null = null;
let resizeObserverAttached = false;
let supplementalInfoDismissed = false;

window.__QLGISNativeLog__ = logToNative;

window.QLGISPreview = {
  render: renderPreview,
  updateSupplementalInfo
};

logToNative("info", "web preview bootstrap loaded");

if (window.__QLGIS_BOOTSTRAP__) {
  logToNative("info", "found bootstrap payload on initial load");
  void renderPreview(window.__QLGIS_BOOTSTRAP__);
} else {
  setStatus("QLGIS preview shell ready.");
}

window.addEventListener("error", (event) => {
  logToNative("error", "window error", `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  logToNative("error", "unhandled rejection", stringifyError(event.reason));
});

async function renderPreview(bootstrap: PreviewBootstrap): Promise<void> {
  try {
    logToNative("info", "starting preview render", `${bootstrap.kind} ${bootstrap.displayName}`);
    const renderer = renderers[bootstrap.kind];
    if (!renderer) {
      throw new Error(`Unsupported preview kind: ${bootstrap.kind}`);
    }

    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }

    setMeta({
      description: defaultDescription(bootstrap.kind),
      eyebrow: bootstrap.kind.toUpperCase(),
      title: bootstrap.displayName
    });
    setSelectors([]);
    primeSupplementalInfo(bootstrap.supplementalInfo ?? null);
    clearBanner();

    const map = await ensureMap(bootstrap.styleURL);
    activeCleanup = await renderer({
      bootstrap,
      clearBanner,
      dismissSupplementalInfo,
      map,
      setMeta,
      setSelectors,
      setStatus,
      showSupplementalInfo,
      showBanner
    });
  } catch (error) {
    logToNative("error", "preview render failed", stringifyError(error));
    setStatus(null);
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function ensureMap(styleURL: string): Promise<Map> {
  if (mapPromise) {
    return mapPromise;
  }

  setStatus("Loading base map…");

  mapPromise = new Promise<Map>((resolve, reject) => {
    const map = new maplibregl.Map({
      attributionControl: {},
      container: "map",
      style: styleURL
    });
    attachResizeHandling(map);

    map.on("error", (event) => {
      const message = stringifyError(event.error);
      logToNative("error", "map error", message);
      if (message.length > 0) {
        setStatus(null);
        showBanner(message);
      }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.once("load", () => {
      activeMap = map;
      map.resize();
      syncSupplementalInfoPresentation();
      logToNative("info", "base map loaded");
      resolve(map);
    });
    map.once("error", (event) => {
      const error = event.error instanceof Error ? event.error : new Error("Failed to load the MapTiler basemap.");
      logToNative("error", "base map failed to load", stringifyError(error));
      reject(error);
    });
  });

  return mapPromise;
}

function primeSupplementalInfo(info: PreviewSupplementalInfo | null): void {
  currentSupplementalInfo = info;
  supplementalInfoDismissed = false;
  syncSupplementalInfoPresentation();
}

function updateSupplementalInfo(info: PreviewSupplementalInfo): void {
  currentSupplementalInfo = info;
  syncSupplementalInfoPresentation();
}

function showSupplementalInfo(info: PreviewSupplementalInfo): void {
  currentSupplementalInfo = info;
  supplementalInfoDismissed = false;
  syncSupplementalInfoPresentation();
}

function dismissSupplementalInfo(): void {
  supplementalInfoDismissed = true;
  syncSupplementalInfoPresentation();
}

function setMeta(meta: PreviewMeta): void {
  if (metaEyebrowElement) {
    metaEyebrowElement.textContent = meta.eyebrow;
  }

  if (metaTitleElement) {
    metaTitleElement.textContent = meta.title;
  }

  if (metaDescriptionElement) {
    metaDescriptionElement.textContent = meta.description ?? "";
    metaDescriptionElement.hidden = !(meta.description?.trim().length);
  }
}

function setSelectors(configs: SelectorConfig[]): void {
  if (!selectorsElement) {
    return;
  }

  selectorsElement.replaceChildren();

  const visibleConfigs = configs.filter((config) => config.options.length > 1);
  if (visibleConfigs.length === 0) {
    selectorsElement.hidden = true;
    return;
  }

  selectorsElement.hidden = false;
  for (const config of visibleConfigs) {
    const wrapper = document.createElement("label");
    wrapper.className = "selector";

    const label = document.createElement("span");
    label.className = "selector__label";
    label.textContent = config.label;
    wrapper.appendChild(label);

    const input = document.createElement("select");
    input.className = "selector__input";
    input.value = config.value;

    for (const option of config.options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      input.appendChild(element);
    }

    input.value = config.value;
    input.addEventListener("change", (event) => {
      config.onChange((event.target as HTMLSelectElement).value);
    });
    wrapper.appendChild(input);
    selectorsElement.appendChild(wrapper);
  }
}

function setStatus(message: string | null): void {
  if (!statusElement) {
    return;
  }

  const nextMessage = message?.trim() ?? "";
  statusElement.hidden = nextMessage.length === 0;
  statusElement.textContent = nextMessage;
}

function showBanner(message: string): void {
  if (!bannerElement) {
    return;
  }

  bannerElement.hidden = false;
  bannerElement.textContent = message;
}

function clearBanner(): void {
  if (!bannerElement) {
    return;
  }

  bannerElement.hidden = true;
  bannerElement.textContent = "";
}

function setFacts(facts: FactItem[]): void {
  if (!factsElement) {
    return;
  }

  factsElement.replaceChildren();
  if (facts.length === 0) {
    factsElement.hidden = true;
    return;
  }

  for (const fact of facts) {
    const label = document.createElement("dt");
    label.className = "facts__label";
    label.textContent = fact.label;
    factsElement.appendChild(label);

    const value = document.createElement("dd");
    value.className = "facts__value";
    value.textContent = fact.value;
    factsElement.appendChild(value);
  }

  factsElement.hidden = false;
}

function syncSupplementalInfoPresentation(): void {
  const facts = !supplementalInfoDismissed ? currentSupplementalInfo?.facts ?? [] : [];
  setFacts(facts);

  if (!activeMap) {
    return;
  }

  const bounds = !supplementalInfoDismissed ? normalizeBounds(currentSupplementalInfo?.bounds) : null;
  if (bounds) {
    addBoundsOverlay(activeMap, SUPPLEMENTAL_BOUNDS_SOURCE_ID, SUPPLEMENTAL_BOUNDS_FILL_LAYER_ID, SUPPLEMENTAL_BOUNDS_LINE_LAYER_ID, bounds);
  } else {
    removeBoundsOverlay(activeMap, SUPPLEMENTAL_BOUNDS_SOURCE_ID, SUPPLEMENTAL_BOUNDS_FILL_LAYER_ID, SUPPLEMENTAL_BOUNDS_LINE_LAYER_ID);
  }
}

function logToNative(level: string, message: string, details?: string): void {
  const bridge = (window as any).webkit?.messageHandlers?.qlgisLog;
  if (!bridge || typeof bridge.postMessage !== "function") {
    return;
  }

  try {
    bridge.postMessage({ details: details ?? "", level, message });
  } catch {
    // Ignore logging bridge failures so preview rendering continues.
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function attachResizeHandling(map: Map): void {
  if (!mapElement || resizeObserverAttached) {
    return;
  }

  const resizeMap = (): void => {
    requestAnimationFrame(() => {
      map.resize();
    });
  };

  resizeObserverAttached = true;
  new ResizeObserver(resizeMap).observe(mapElement);
  window.addEventListener("resize", resizeMap);
}

function normalizeBounds(bounds: PreviewSupplementalInfo["bounds"]): BoundsTuple | null {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    return null;
  }

  const normalized = bounds.map((value) => Number(value)) as BoundsTuple;
  return normalized.every((value) => Number.isFinite(value)) ? normalized : null;
}

function defaultDescription(kind: PreviewBootstrap["kind"]): string {
  switch (kind) {
    case "geojson":
      return "Inspecting vector features on top of the basemap.";
    case "geotiff":
      return "Inspecting raster coverage on top of the basemap.";
    case "pmtiles":
      return "Inspecting tiled content from a PMTiles archive.";
    case "geopackage":
      return "Inspecting GeoPackage tables and metadata.";
  }
}
