import Foundation

public struct PreviewBootstrap: Codable, Equatable {
    public let kind: PreviewFileKind
    public let displayName: String
    public let dataURL: String
    public let styleURL: String
    public let supplementalInfo: PreviewSupplementalInfo?

    public init(kind: PreviewFileKind, displayName: String, dataURL: String, styleURL: String, supplementalInfo: PreviewSupplementalInfo? = nil) {
        self.kind = kind
        self.displayName = displayName
        self.dataURL = dataURL
        self.styleURL = styleURL
        self.supplementalInfo = supplementalInfo
    }

    public static func make(fileURL: URL, dataURL: URL, styleURL: URL, supplementalInfo: PreviewSupplementalInfo? = nil) throws -> PreviewBootstrap {
        let kind = try PreviewFileKind.detect(from: fileURL)
        return PreviewBootstrap(
            kind: kind,
            displayName: fileURL.lastPathComponent,
            dataURL: dataURL.absoluteString,
            styleURL: styleURL.absoluteString,
            supplementalInfo: supplementalInfo
        )
    }
}
