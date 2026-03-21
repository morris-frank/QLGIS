import maplibregl, { Map } from "maplibre-gl";
import { renderGeoJSONPreview } from "./renderers/geojson";
import { renderGeoTIFFPreview } from "./renderers/geotiff";
import "./styles.css";
import type { Cleanup, PreviewBootstrap, Renderer } from "./types";

const renderers: Record<PreviewBootstrap["kind"], Renderer> = {
  geojson: renderGeoJSONPreview,
  geotiff: renderGeoTIFFPreview
};

const statusElement = document.querySelector<HTMLDivElement>("#status");
const bannerElement = document.querySelector<HTMLDivElement>("#banner");

let mapPromise: Promise<Map> | null = null;
let activeCleanup: Cleanup | null = null;

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

    activeCleanup = await renderer({
      bootstrap,
      clearBanner,
      map,
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
      attributionControl: true,
      container: "map",
      style: styleURL
    });

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
