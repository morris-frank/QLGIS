import Foundation
import QLGISCore

enum PreviewConfiguration {
    static let previewScheme = "qlgis-preview"
    static let previewHost = "current"
    static let previewPath = "/data"

    static func previewDataURL() throws -> URL {
        guard let url = URL(string: "\(previewScheme)://\(previewHost)\(previewPath)") else {
            throw PreviewError.invalidPreviewDataURL
        }
        return url
    }

    static func styleURL(bundle: Bundle) throws -> URL {
        let rawValue = (bundle.object(forInfoDictionaryKey: "MapTilerAPIKey") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !rawValue.isEmpty, !rawValue.contains("YOUR_MAPTILER_API_KEY") else {
            throw PreviewError.missingMapTilerAPIKey
        }

        guard let encodedKey = rawValue.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://api.maptiler.com/maps/streets-v2/style.json?key=\(encodedKey)") else {
            throw PreviewError.missingMapTilerAPIKey
        }

        return url
    }

    static func webRootURL(bundle: Bundle) throws -> URL {
        guard let resourceURL = bundle.resourceURL else {
            throw PreviewError.missingWebBundle
        }

        let webURL = resourceURL.appendingPathComponent("Web", isDirectory: true)
        guard FileManager.default.fileExists(atPath: webURL.path) else {
            throw PreviewError.missingWebBundle
        }

        return webURL
    }

    static func webIndexURL(bundle: Bundle) throws -> URL {
        let rootURL = try webRootURL(bundle: bundle)
        let indexURL = rootURL.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: indexURL.path) else {
            throw PreviewError.missingWebBundle
        }

        return indexURL
    }
}

