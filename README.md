# QLGIS

QLGIS is a macOS 12+ Quick Look preview extension for geospatial data.

## Initial Support

- GeoJSON (`.geojson`)
- GeoTIFF (`.geotiff`, plus `.tif` and `.tiff` when Quick Look routes them to the extension)

## Setup

1. Copy `Config/Secrets.template.xcconfig` to `Config/Secrets.xcconfig`.
2. Fill in `MAPTILER_API_KEY` with a valid MapTiler API key.
3. Run `npm install` inside `web/`.
4. Open `QLGIS.xcodeproj`, choose a signing team, and build the `QLGIS` app.
5. Run the app once so macOS registers the bundled preview extension.
6. If Finder keeps showing an older preview, run `qlmanage -r && qlmanage -r cache`, then `killall Finder QuickLookUIService`.
7. For a stable local dev install, run `scripts/install_local.sh`. This builds the app, copies it to `~/Applications/QLGIS.app`, enables the extension, and resets Finder and Quick Look.

## Development

- `ruby scripts/generate_xcodeproj.rb` regenerates the Xcode project.
- `python3 scripts/generate_fixtures.py` regenerates the test and demo fixtures.
- `npm test` inside `web/` runs the browser-side unit tests.
- `scripts/release.sh` archives, exports, zips, and optionally notarizes a Developer ID release build.

## Manual Preview Testing

- Finder: select a fixture and press `Space`.
- Command line: `qlmanage -p Fixtures/polygon.geojson`
- GeoTIFF command line helper: `scripts/preview_geotiff.sh Fixtures/rgb_4326.tif`
- If macOS keeps classifying a GeoTIFF as `public.tiff`, Finder and plain `qlmanage -p file.tif` will stay on the system TIFF preview. Use the `.geotiff` fixture aliases or `scripts/preview_geotiff.sh` to force the same bytes through the QLGIS preview extension.

## Release

1. Set a real signing team in Xcode and use a valid Developer ID Application certificate.
2. Keep `Config/Secrets.xcconfig` populated and `web/node_modules` installed.
3. Archive and export locally with `scripts/release.sh`.
4. To notarize during the same run, create a notarytool keychain profile and set `NOTARYTOOL_PROFILE=<profile-name>`.

### GitHub Actions Release Automation

The workflow at `.github/workflows/release.yml` builds, signs, notarizes, and publishes a GitHub Release when you push a tag like `v1.0.0`. It can also be run manually with the `release_tag` input.

Repository secrets required by the workflow:

- `MAPTILER_API_KEY`
- `BUILD_CERTIFICATE_BASE64` as a base64-encoded Developer ID Application `.p12`
- `P12_PASSWORD`
- `KEYCHAIN_PASSWORD` for the temporary CI keychain
- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

The workflow creates `Config/Secrets.xcconfig`, imports the Developer ID certificate into a temporary keychain, stores notarization credentials with `notarytool`, runs `scripts/release.sh`, and uploads the resulting zip to the GitHub Release for that tag.

Example:

```sh
scripts/release.sh
NOTARYTOOL_PROFILE=qlgis-notary scripts/release.sh

git tag v1.0.0
git push origin v1.0.0
```

The export options used by the release script live in `Config/ExportOptions.DeveloperID.plist`.
