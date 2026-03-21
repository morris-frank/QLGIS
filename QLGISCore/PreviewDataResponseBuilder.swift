import Foundation

public struct PreviewDataResponse: Equatable {
    public let mimeType: String
    public let data: Data
    public let suggestedFilename: String
}

public enum PreviewDataResponseBuilder {
    public static func makeResponse(for fileURL: URL, kind: PreviewFileKind) throws -> PreviewDataResponse {
        let data = try Data(contentsOf: fileURL)
        guard !data.isEmpty else {
            throw PreviewError.emptyFileData
        }

        return PreviewDataResponse(
            mimeType: kind.mimeType,
            data: data,
            suggestedFilename: fileURL.lastPathComponent
        )
    }
}

