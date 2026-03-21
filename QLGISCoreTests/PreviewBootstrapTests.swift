import XCTest
@testable import QLGISCore

final class PreviewBootstrapTests: XCTestCase {
    func testBootstrapIncludesKindDisplayNameAndURLs() throws {
        let fileURL = URL(fileURLWithPath: "/tmp/polygon.geojson")
        let dataURL = URL(string: "qlgis-preview://current/data")!
        let styleURL = URL(string: "https://example.com/style.json")!

        let bootstrap = try PreviewBootstrap.make(fileURL: fileURL, dataURL: dataURL, styleURL: styleURL)

        XCTAssertEqual(bootstrap.kind, .geojson)
        XCTAssertEqual(bootstrap.displayName, "polygon.geojson")
        XCTAssertEqual(bootstrap.dataURL, dataURL.absoluteString)
        XCTAssertEqual(bootstrap.styleURL, styleURL.absoluteString)
    }
}

