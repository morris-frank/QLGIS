import XCTest
@testable import QLGISCore

final class PreviewDataResponseBuilderTests: XCTestCase {
    func testResponseBuilderReturnsDataAndMimeType() throws {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("geojson")
        try Data("{\"type\":\"FeatureCollection\",\"features\":[]}".utf8).write(to: tempURL)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        let response = try PreviewDataResponseBuilder.makeResponse(for: tempURL, kind: .geojson)

        XCTAssertEqual(response.mimeType, "application/geo+json")
        XCTAssertEqual(response.suggestedFilename, tempURL.lastPathComponent)
        XCTAssertFalse(response.data.isEmpty)
    }

    func testEmptyFilesAreRejected() throws {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("tif")
        try Data().write(to: tempURL)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        XCTAssertThrowsError(try PreviewDataResponseBuilder.makeResponse(for: tempURL, kind: .geotiff))
    }
}

