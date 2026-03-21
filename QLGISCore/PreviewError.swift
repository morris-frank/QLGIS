import Foundation

public enum PreviewError: LocalizedError, Equatable {
    case unsupportedContentType(String)
    case emptyFileData
    case missingMapTilerAPIKey
    case missingWebBundle
    case invalidPreviewDataURL

    public var errorDescription: String? {
        switch self {
        case .unsupportedContentType(let identifier):
            return "Unsupported preview type: \(identifier)"
        case .emptyFileData:
            return "The previewed file is empty."
        case .missingMapTilerAPIKey:
            return "Missing MAPTILER_API_KEY. Configure Config/Secrets.xcconfig before building."
        case .missingWebBundle:
            return "The bundled web preview assets could not be found."
        case .invalidPreviewDataURL:
            return "The preview data URL is invalid."
        }
    }
}

