#!/usr/bin/env python3

from pathlib import Path

import numpy as np
from PIL import Image, TiffImagePlugin


ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "Fixtures"

MODEL_PIXEL_SCALE = 33550
MODEL_TIEPOINT = 33922
MODEL_TRANSFORMATION = 34264
GEO_KEY_DIRECTORY = 34735


def ensure_dir() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)


def write_geojson() -> None:
    (FIXTURES / "point.geojson").write_text(
        """{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {"name": "Point fixture"},
      "geometry": {"type": "Point", "coordinates": [4.899, 52.372]}
    }
  ]
}
""",
        encoding="utf-8",
    )

    (FIXTURES / "line.geojson").write_text(
        """{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {"name": "Line fixture"},
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [4.84, 52.35],
          [4.92, 52.37],
          [5.01, 52.41]
        ]
      }
    }
  ]
}
""",
        encoding="utf-8",
    )

    (FIXTURES / "polygon.geojson").write_text(
        """{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {"name": "Polygon fixture"},
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [4.90, 52.35],
            [5.05, 52.35],
            [5.05, 52.42],
            [4.90, 52.42],
            [4.90, 52.35]
          ]
        ]
      }
    }
  ]
}
""",
        encoding="utf-8",
    )


def geokey_directory() -> tuple[int, ...]:
    return (
        1,
        1,
        0,
        4,
        1024,
        0,
        1,
        2,
        1025,
        0,
        1,
        1,
        2048,
        0,
        1,
        4326,
        2054,
        0,
        1,
        9102,
    )


def save_tiff(path: Path, image: Image.Image, tags: TiffImagePlugin.ImageFileDirectory_v2) -> None:
    image.save(path, format="TIFF", tiffinfo=tags)


def write_grayscale_geotiff() -> None:
    data = np.array([[0, 90], [180, 255]], dtype=np.uint8)
    image = Image.fromarray(data, mode="L")

    tags = TiffImagePlugin.ImageFileDirectory_v2()
    tags[MODEL_PIXEL_SCALE] = (0.1, 0.1, 0.0)
    tags[MODEL_TIEPOINT] = (0.0, 0.0, 0.0, 4.8, 52.4, 0.0)
    tags[GEO_KEY_DIRECTORY] = geokey_directory()

    save_tiff(FIXTURES / "grayscale_4326.tif", image, tags)


def write_rgb_geotiff() -> None:
    data = np.array(
        [
            [[255, 0, 0], [0, 255, 0]],
            [[0, 0, 255], [255, 255, 0]],
        ],
        dtype=np.uint8,
    )
    image = Image.fromarray(data, mode="RGB")

    tags = TiffImagePlugin.ImageFileDirectory_v2()
    tags[MODEL_PIXEL_SCALE] = (0.05, 0.05, 0.0)
    tags[MODEL_TIEPOINT] = (0.0, 0.0, 0.0, 5.0, 52.5, 0.0)
    tags[GEO_KEY_DIRECTORY] = geokey_directory()

    save_tiff(FIXTURES / "rgb_4326.tif", image, tags)


def write_unsupported_geotiff() -> None:
    data = np.array([[32, 128], [200, 240]], dtype=np.uint8)
    image = Image.fromarray(data, mode="L")

    tags = TiffImagePlugin.ImageFileDirectory_v2()
    tags[MODEL_TRANSFORMATION] = (
        1.0,
        0.1,
        0.0,
        4.8,
        0.0,
        -1.0,
        0.0,
        52.4,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    )
    tags[GEO_KEY_DIRECTORY] = geokey_directory()

    save_tiff(FIXTURES / "unsupported_rotated.tif", image, tags)


def mirror_geotiff_aliases() -> None:
    for path in FIXTURES.glob("*.tif"):
        alias_path = path.with_suffix(".geotiff")
        alias_path.write_bytes(path.read_bytes())


def main() -> None:
    ensure_dir()
    write_geojson()
    write_grayscale_geotiff()
    write_rgb_geotiff()
    write_unsupported_geotiff()
    mirror_geotiff_aliases()


if __name__ == "__main__":
    main()
