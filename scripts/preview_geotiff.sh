#!/usr/bin/env zsh

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/preview_geotiff.sh /absolute/path/to/file.tif" >&2
  exit 1
fi

input_path=${1:A}
if [[ ! -f "$input_path" ]]; then
  echo "File not found: $input_path" >&2
  exit 1
fi

temp_root=$(mktemp -d "${TMPDIR:-/tmp}/qlgis-geotiff-preview.XXXXXX")
cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT INT TERM

preview_name="${input_path:t:r}.geotiff"
preview_path="$temp_root/$preview_name"
ln -s "$input_path" "$preview_path"

qlmanage -p "$preview_path"
