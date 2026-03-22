#!/bin/zsh

set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-QLGIS.xcodeproj}"
SCHEME="${SCHEME:-QLGIS}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DESTINATION="${DESTINATION:-platform=macOS}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$PWD/build/DerivedData}"
APP_NAME="${APP_NAME:-QLGIS.app}"
INSTALL_ROOT="${INSTALL_ROOT:-$HOME/Applications}"
INSTALL_APP_PATH="${INSTALL_APP_PATH:-$INSTALL_ROOT/$APP_NAME}"
EXTENSION_BUNDLE_ID="${EXTENSION_BUNDLE_ID:-com.mauricefrank.QLGIS.QLGISPreviewExtension}"

echo "==> Building ${SCHEME} (${CONFIGURATION})"
xcodebuild \
  -project "${PROJECT_PATH}" \
  -scheme "${SCHEME}" \
  -configuration "${CONFIGURATION}" \
  -destination "${DESTINATION}" \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  build

BUILT_APP_PATH="${DERIVED_DATA_PATH}/Build/Products/${CONFIGURATION}/${APP_NAME}"

if [[ ! -d "${BUILT_APP_PATH}" ]]; then
  echo "Built app not found at ${BUILT_APP_PATH}" >&2
  exit 1
fi

echo "==> Installing to ${INSTALL_APP_PATH}"
mkdir -p "${INSTALL_ROOT}"
rm -rf "${INSTALL_APP_PATH}"
cp -R "${BUILT_APP_PATH}" "${INSTALL_APP_PATH}"

echo "==> Launching app once for registration"
open "${INSTALL_APP_PATH}"
sleep 2

echo "==> Enabling Quick Look extension"
pluginkit -e use -i "${EXTENSION_BUNDLE_ID}" || true

echo "==> Resetting Quick Look caches"
qlmanage -r
qlmanage -r cache

echo "==> Restarting Finder and Quick Look UI"
killall Finder 2>/dev/null || true
killall QuickLookUIService 2>/dev/null || true

echo "==> Installed app"
echo "${INSTALL_APP_PATH}"
echo
echo "Preview targets currently supported by QLGIS:"
echo "  - public.geojson"
echo "  - com.mauricefrank.geotiff"
echo
echo "Use .geojson directly."
echo "Use .geotiff for raster previews, or scripts/preview_geotiff.sh for existing .tif/.tiff files."
