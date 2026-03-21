import type { Map } from "maplibre-gl";

export type PreviewKind = "geojson" | "geotiff";

export interface PreviewBootstrap {
  kind: PreviewKind;
  displayName: string;
  dataURL: string;
  styleURL: string;
}

export type BoundsTuple = [number, number, number, number];
export type QuadCoordinates = [[number, number], [number, number], [number, number], [number, number]];

export interface RendererContext {
  bootstrap: PreviewBootstrap;
  clearBanner: () => void;
  map: Map;
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
