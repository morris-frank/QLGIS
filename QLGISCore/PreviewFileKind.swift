import Foundation
import UniformTypeIdentifiers

public enum PreviewFileKind: String, Codable, Equatable, CaseIterable {
    case geojson
    case geotiff
    case pmtiles

    public static func detect(from fileURL: URL) throws -> PreviewFileKind {
        let values = try? fileURL.resourceValues(forKeys: [.contentTypeKey])
        if let contentType = values?.contentType {
            if contentType.identifier == "public.geojson" {
                return .geojson
            }
            if contentType.identifier == "com.mauricefrank.pmtiles" {
                return .pmtiles
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
        case "pmtiles":
            return .pmtiles
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
        case .pmtiles:
            return "application/vnd.pmtiles"
        }
    }
}
