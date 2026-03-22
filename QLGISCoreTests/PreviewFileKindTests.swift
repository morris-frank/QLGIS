import XCTest
@testable import QLGISCore

final class PreviewFileKindTests: XCTestCase {
    func testDetectsGeoJSONByExtension() throws {
        let url = URL(fileURLWithPath: "/tmp/sample.geojson")
        XCTAssertEqual(try PreviewFileKind.detect(from: url), .geojson)
    }

    func testDetectsGeoTIFFByExtension() throws {
        let url = URL(fileURLWithPath: "/tmp/sample.tif")
        XCTAssertEqual(try PreviewFileKind.detect(from: url), .geotiff)
    }

    func testDetectsGeoTIFFByGeoTIFFExtension() throws {
        let url = URL(fileURLWithPath: "/tmp/sample.geotiff")
        XCTAssertEqual(try PreviewFileKind.detect(from: url), .geotiff)
    }

    func testDetectsPMTilesByExtension() throws {
        let url = URL(fileURLWithPath: "/tmp/sample.pmtiles")
        XCTAssertEqual(try PreviewFileKind.detect(from: url), .pmtiles)
    }

    func testRejectsUnknownExtensions() {
        let url = URL(fileURLWithPath: "/tmp/sample.shp")
        XCTAssertThrowsError(try PreviewFileKind.detect(from: url))
    }
}
