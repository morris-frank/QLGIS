import type { Map } from "maplibre-gl";

export type PreviewKind = "geojson" | "geotiff" | "pmtiles";

export interface PreviewBootstrap {
  kind: PreviewKind;
  displayName: string;
  dataURL: string;
  styleURL: string;
}

export type BoundsTuple = [number, number, number, number];
export type QuadCoordinates = [[number, number], [number, number], [number, number], [number, number]];

export interface PreviewMeta {
  eyebrow: string;
  title: string;
  description?: string;
}

export interface SelectorOption {
  label: string;
  value: string;
}

export interface SelectorConfig {
  label: string;
  onChange: (value: string) => void;
  options: SelectorOption[];
  value: string;
}

export interface RendererContext {
  bootstrap: PreviewBootstrap;
  clearBanner: () => void;
  map: Map;
  setMeta: (meta: PreviewMeta) => void;
  setSelector: (config: SelectorConfig | null) => void;
  setStatus: (message: string | null) => void;
  showBanner: (message: string) => void;
}

export type Cleanup = () => void;
export type Renderer = (context: RendererContext) => Promise<Cleanup>;

declare global {
  interface Window {
    __QLGIS_BOOTSTRAP__?: PreviewBootstrap;
    __QLGISNativeLog__?: (level: string, message: string, details?: string) => void;
    QLGISPreview?: {
      render: (bootstrap: PreviewBootstrap) => Promise<void>;
    };
  }
}
