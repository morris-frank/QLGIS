import Foundation

public struct PreviewFact: Codable, Equatable {
    public let label: String
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

public struct PreviewSupplementalInfo: Codable, Equatable {
    public let facts: [PreviewFact]
    public let bounds: [Double]?

    public init(facts: [PreviewFact], bounds: [Double]? = nil) {
        self.facts = facts
        self.bounds = bounds
    }

    public static func basic(fileURL: URL, kind: PreviewFileKind) -> PreviewSupplementalInfo {
        var facts = [PreviewFact(label: "Format", value: kind.displayLabel)]

        if let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
           let fileSize = values.fileSize {
            facts.append(PreviewFact(label: "File Size", value: ByteCountFormatter.string(fromByteCount: Int64(fileSize), countStyle: .file)))
        }

        return PreviewSupplementalInfo(facts: facts)
    }
}
