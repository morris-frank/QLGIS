import maplibregl, { Map } from "maplibre-gl";
import { renderGeoJSONPreview } from "./renderers/geojson";
import { renderGeoTIFFPreview } from "./renderers/geotiff";
import { renderPMTilesPreview } from "./renderers/pmtiles";
import "./styles.css";
import type { Cleanup, PreviewBootstrap, Renderer, PreviewMeta, SelectorConfig } from "./types";

const renderers: Record<PreviewBootstrap["kind"], Renderer> = {
  geojson: renderGeoJSONPreview,
  geotiff: renderGeoTIFFPreview,
  pmtiles: renderPMTilesPreview
};

const mapElement = document.querySelector<HTMLDivElement>("#map");
const metaEyebrowElement = document.querySelector<HTMLDivElement>("#meta-eyebrow");
const metaTitleElement = document.querySelector<HTMLDivElement>("#meta-title");
const metaDescriptionElement = document.querySelector<HTMLDivElement>("#meta-description");
const selectorGroupElement = document.querySelector<HTMLLabelElement>("#selector-group");
const selectorLabelElement = document.querySelector<HTMLSpanElement>("#selector-label");
const selectorInputElement = document.querySelector<HTMLSelectElement>("#selector-input");
const statusElement = document.querySelector<HTMLDivElement>("#status");
const bannerElement = document.querySelector<HTMLDivElement>("#banner");

let mapPromise: Promise<Map> | null = null;
let activeCleanup: Cleanup | null = null;
let selectorOnChange: ((value: string) => void) | null = null;
let resizeObserverAttached = false;

window.__QLGISNativeLog__ = logToNative;

window.QLGISPreview = {
  render: renderPreview
};

logToNative("info", "web preview bootstrap loaded");

if (window.__QLGIS_BOOTSTRAP__) {
  logToNative("info", "found bootstrap payload on initial load");
  void renderPreview(window.__QLGIS_BOOTSTRAP__);
} else {
  setStatus("Waiting for preview data…");
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

    const map = await ensureMap(bootstrap.styleURL);
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }

    setMeta({
      description: defaultDescription(bootstrap.kind),
      eyebrow: bootstrap.kind.toUpperCase(),
      title: bootstrap.displayName
    });
    setSelector(null);
    clearBanner();

    activeCleanup = await renderer({
      bootstrap,
      clearBanner,
      map,
      setMeta,
      setSelector,
      setStatus,
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
      map.resize();
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

function setSelector(config: SelectorConfig | null): void {
  if (!selectorGroupElement || !selectorLabelElement || !selectorInputElement) {
    return;
  }

  selectorOnChange = null;
  selectorInputElement.replaceChildren();

  if (!config || config.options.length < 2) {
    selectorGroupElement.hidden = true;
    return;
  }

  selectorGroupElement.hidden = false;
  selectorLabelElement.textContent = config.label;

  for (const option of config.options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    selectorInputElement.appendChild(element);
  }

  selectorInputElement.value = config.value;
  selectorOnChange = config.onChange;
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

function defaultDescription(kind: PreviewBootstrap["kind"]): string {
  switch (kind) {
    case "geojson":
      return "Inspecting vector features on top of the basemap.";
    case "geotiff":
      return "Inspecting raster coverage on top of the basemap.";
    case "pmtiles":
      return "Inspecting tiled content from a PMTiles archive.";
  }
}

selectorInputElement?.addEventListener("change", (event) => {
  const nextValue = (event.target as HTMLSelectElement).value;
  selectorOnChange?.(nextValue);
});
