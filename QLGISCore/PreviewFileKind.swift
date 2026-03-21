import Foundation
import UniformTypeIdentifiers

public enum PreviewFileKind: String, Codable, Equatable, CaseIterable {
    case geojson
    case geotiff

    public static func detect(from fileURL: URL) throws -> PreviewFileKind {
        let values = try? fileURL.resourceValues(forKeys: [.contentTypeKey])
        if let contentType = values?.contentType {
            if contentType.identifier == "public.geojson" {
                return .geojson
            }
            if contentType.conforms(to: .tiff) {
                return .geotiff
            }
        }

        switch fileURL.pathExtension.lowercased() {
        case "geojson":
            return .geojson
        case "geotiff", "geotif", "tif", "tiff":
            return .geotiff
        default:
            throw PreviewError.unsupportedContentType(fileURL.pathExtension)
        }
    }

    public var mimeType: String {
        switch self {
        case .geojson:
            return "application/geo+json"
        case .geotiff:
            return "image/tiff"
        }
    }
}
