#!/usr/bin/env zsh

set -euo pipefail

ROOT=${0:A:h:h}
PROJECT_PATH="${PROJECT_PATH:-$ROOT/QLGIS.xcodeproj}"
SCHEME="${SCHEME:-QLGIS}"
CONFIGURATION="${CONFIGURATION:-Release}"
DESTINATION="${DESTINATION:-platform=macOS}"
EXPORT_OPTIONS_PLIST="${EXPORT_OPTIONS_PLIST:-$ROOT/Config/ExportOptions.DeveloperID.plist}"
RELEASE_ROOT="${RELEASE_ROOT:-$ROOT/build/release}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$RELEASE_ROOT/$SCHEME.xcarchive}"
EXPORT_PATH="${EXPORT_PATH:-$RELEASE_ROOT/export}"
APP_PATH="$EXPORT_PATH/$SCHEME.app"
ZIP_PATH="${ZIP_PATH:-$RELEASE_ROOT/$SCHEME-macOS.zip}"
NOTARY_ZIP_PATH="${NOTARY_ZIP_PATH:-$RELEASE_ROOT/$SCHEME-notarization.zip}"
NOTARYTOOL_PROFILE="${NOTARYTOOL_PROFILE:-}"
ALLOW_PROVISIONING_UPDATES="${ALLOW_PROVISIONING_UPDATES:-0}"

if [[ ! -f "$PROJECT_PATH/project.pbxproj" ]]; then
  echo "Project not found at $PROJECT_PATH" >&2
  exit 1
fi

if [[ ! -f "$EXPORT_OPTIONS_PLIST" ]]; then
  echo "Export options plist not found at $EXPORT_OPTIONS_PLIST" >&2
  exit 1
fi

mkdir -p "$RELEASE_ROOT"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH" "$ZIP_PATH" "$NOTARY_ZIP_PATH"

xcode_args=(
  -project "$PROJECT_PATH"
  -scheme "$SCHEME"
  -configuration "$CONFIGURATION"
  -destination "$DESTINATION"
)

if [[ "$ALLOW_PROVISIONING_UPDATES" == "1" ]]; then
  xcode_args+=(-allowProvisioningUpdates)
fi

echo "Archiving $SCHEME..."
xcodebuild "${xcode_args[@]}" archive -archivePath "$ARCHIVE_PATH"

echo "Exporting archive..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected exported app at $APP_PATH" >&2
  exit 1
fi

if [[ -n "$NOTARYTOOL_PROFILE" ]]; then
  echo "Preparing notarization payload..."
  ditto -c -k --keepParent "$APP_PATH" "$NOTARY_ZIP_PATH"

  echo "Submitting for notarization with profile $NOTARYTOOL_PROFILE..."
  xcrun notarytool submit "$NOTARY_ZIP_PATH" --keychain-profile "$NOTARYTOOL_PROFILE" --wait

  echo "Stapling notarization ticket..."
  xcrun stapler staple "$APP_PATH"
fi

echo "Creating release zip..."
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "Assessing exported app..."
spctl --assess --type execute --verbose "$APP_PATH"

echo
echo "Archive: $ARCHIVE_PATH"
echo "App:     $APP_PATH"
echo "Zip:     $ZIP_PATH"

if [[ -n "$NOTARYTOOL_PROFILE" ]]; then
  echo "Notarization: completed and stapled"
else
  echo "Notarization: skipped (set NOTARYTOOL_PROFILE to enable)"
fi
