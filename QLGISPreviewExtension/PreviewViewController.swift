import Cocoa
import OSLog
import QuickLookUI
import WebKit
import QLGISCore

final class PreviewViewController: NSViewController, QLPreviewingController {
    private static let webLogHandlerName = "qlgisLog"
    private let logger = Logger(subsystem: "com.mauricefrank.QLGIS", category: "PreviewViewController")
    private let schemeHandler = PreviewSchemeHandler()
    private lazy var webView: WKWebView = makeWebView()
    private lazy var fallbackLabel: NSTextField = {
        let label = NSTextField(labelWithString: "")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        label.alignment = .center
        label.maximumNumberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.font = NSFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = .secondaryLabelColor
        return label
    }()

    private var webShellLoaded = false
    private var webShellContinuation: CheckedContinuation<Void, Error>?
    private var supplementalInfoTask: Task<Void, Never>?

    override func loadView() {
        view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        view.addSubview(webView)
        view.addSubview(fallbackLabel)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            fallbackLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            fallbackLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            fallbackLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 520)
        ])
    }

    func preparePreviewOfFile(at url: URL) async throws {
        do {
            supplementalInfoTask?.cancel()
            let previewBundle = Bundle(for: Self.self)
            let dataURL = try PreviewConfiguration.previewDataURL()
            let styleURL = try PreviewConfiguration.styleURL(bundle: previewBundle)
            let kind = try PreviewFileKind.detect(from: url)
            let response = try PreviewDataResponseBuilder.makeResponse(for: url, kind: kind)
            let initialSupplementalInfo = PreviewSupplementalInfo.basic(fileURL: url, kind: kind)
            let bootstrap = PreviewBootstrap(
                kind: kind,
                displayName: url.lastPathComponent,
                dataURL: dataURL.absoluteString,
                styleURL: styleURL.absoluteString,
                supplementalInfo: initialSupplementalInfo
            )

            await MainActor.run {
                self.title = bootstrap.displayName
                self.schemeHandler.updateCurrentPreview(response: response)
                self.showFallback(nil)
            }

            try await ensureWebShellLoaded(bundle: previewBundle)
            try await injectBootstrap(bootstrap)
            startSupplementalInfoTask(fileURL: url, kind: kind, initialInfo: initialSupplementalInfo)
        } catch {
            logger.error("Preview preparation failed for \(url.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            await MainActor.run {
                self.showFallback(error.localizedDescription)
            }
        }
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        userContentController.add(self, name: Self.webLogHandlerName)
        configuration.userContentController = userContentController
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: PreviewConfiguration.previewScheme)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
#if DEBUG
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
#endif
        return webView
    }

    @MainActor
    private func ensureWebShellLoaded(bundle: Bundle) async throws {
        if webShellLoaded {
            return
        }

        let indexURL = try PreviewConfiguration.webIndexURL(bundle: bundle)
        let rootURL = try PreviewConfiguration.webRootURL(bundle: bundle)

        try await withCheckedThrowingContinuation { continuation in
            webShellContinuation = continuation
            webView.loadFileURL(indexURL, allowingReadAccessTo: rootURL)
        }
    }

    @MainActor
    private func injectBootstrap(_ bootstrap: PreviewBootstrap) async throws {
        let encoder = JSONEncoder()
        let data = try encoder.encode(bootstrap)
        guard let payload = String(data: data, encoding: .utf8) else {
            throw PreviewError.invalidPreviewDataURL
        }

        let script = """
        (() => {
            window.__QLGIS_BOOTSTRAP__ = \(payload);
            if (window.QLGISPreview && typeof window.QLGISPreview.render === "function") {
                void window.QLGISPreview.render(window.__QLGIS_BOOTSTRAP__);
            }
            return true;
        })();
        """

        try await webView.evaluateJavaScript(script)
    }

    @MainActor
    private func injectSupplementalInfo(_ supplementalInfo: PreviewSupplementalInfo) async throws {
        let encoder = JSONEncoder()
        let data = try encoder.encode(supplementalInfo)
        guard let payload = String(data: data, encoding: .utf8) else {
            throw PreviewError.invalidPreviewDataURL
        }

        let script = """
        (() => {
            if (window.QLGISPreview && typeof window.QLGISPreview.updateSupplementalInfo === "function") {
                window.QLGISPreview.updateSupplementalInfo(\(payload));
            }
            return true;
        })();
        """

        try await webView.evaluateJavaScript(script)
    }

    private func startSupplementalInfoTask(fileURL: URL, kind: PreviewFileKind, initialInfo: PreviewSupplementalInfo) {
        supplementalInfoTask = Task { [weak self] in
            let supplementalInfo = await Task.detached(priority: .utility) {
                GDALSupplementalInfoLoader.load(for: fileURL, kind: kind, fallback: initialInfo)
            }.value

            guard !Task.isCancelled,
                  let self,
                  let supplementalInfo,
                  supplementalInfo != initialInfo else {
                return
            }

            do {
                try await injectSupplementalInfo(supplementalInfo)
            } catch {
                logger.error("Failed to inject supplemental info for \(fileURL.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    @MainActor
    private func showFallback(_ message: String?) {
        fallbackLabel.stringValue = message ?? ""
        fallbackLabel.isHidden = message == nil
        webView.isHidden = message != nil
    }
}

extension PreviewViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        _ = webView
        _ = navigation
        webShellLoaded = true
        webShellContinuation?.resume()
        webShellContinuation = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        _ = webView
        _ = navigation
        webShellLoaded = false
        showFallback(error.localizedDescription)
        webShellContinuation?.resume(throwing: error)
        webShellContinuation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.webView(webView, didFail: navigation, withError: error)
    }
}

extension PreviewViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        _ = userContentController

        guard message.name == Self.webLogHandlerName else {
            return
        }

        guard let payload = message.body as? [String: Any] else {
            logger.error("Received malformed web log payload.")
            return
        }

        let level = String(describing: payload["level"] ?? "info").lowercased()
        let messageText = String(describing: payload["message"] ?? "")
        let detailsText = String(describing: payload["details"] ?? "")
        let composedText = detailsText.isEmpty ? messageText : "\(messageText) | \(detailsText)"
        NSLog("[QLGISWeb] %@", composedText)

        switch level {
        case "error":
            logger.error("\(composedText, privacy: .public)")
        case "warning":
            logger.warning("\(composedText, privacy: .public)")
        default:
            logger.log("\(composedText, privacy: .public)")
        }
    }
}

private enum GDALSupplementalInfoLoader {
    private static let executableCandidates = [
        "/opt/homebrew/bin/gdal",
        "/usr/local/bin/gdal",
        "/usr/bin/gdal"
    ]

    static func load(for fileURL: URL, kind: PreviewFileKind, fallback: PreviewSupplementalInfo) -> PreviewSupplementalInfo? {
        guard let executablePath = executableCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            return nil
        }

        do {
            let data = try runGDALInfo(executablePath: executablePath, fileURL: fileURL)
            return parse(data: data, kind: kind, fallback: fallback)
        } catch {
            return nil
        }
    }

    private static func runGDALInfo(executablePath: String, fileURL: URL) throws -> Data {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = ["info", "--output-format", "json", "--input", fileURL.path]

        let standardOutput = Pipe()
        let standardError = Pipe()
        process.standardOutput = standardOutput
        process.standardError = standardError

        try process.run()
        process.waitUntilExit()

        let output = standardOutput.fileHandleForReading.readDataToEndOfFile()
        if process.terminationStatus != 0 || output.isEmpty {
            let errorOutput = standardError.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: errorOutput, encoding: .utf8) ?? "GDAL info failed."
            throw NSError(domain: "QLGIS.GDAL", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: message])
        }

        return output
    }

    private static func parse(data: Data, kind: PreviewFileKind, fallback: PreviewSupplementalInfo) -> PreviewSupplementalInfo? {
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        var facts = fallback.facts
        appendFact(label: "Driver", value: driverLabel(payload), to: &facts)
        appendFact(label: "Size", value: rasterSize(payload), to: &facts)
        appendFact(label: "Layers", value: layerSummary(payload), to: &facts)
        appendFact(label: "Features", value: featureSummary(payload), to: &facts)
        appendFact(label: "CRS", value: crsLabel(payload), to: &facts)
        appendFact(label: "Bands", value: bandSummary(payload), to: &facts)

        let bounds = bounds(payload, kind: kind)
        if let bounds {
            appendFact(label: "Bounds", value: format(bounds: bounds), to: &facts)
        }

        return PreviewSupplementalInfo(facts: facts, bounds: bounds)
    }

    private static func appendFact(label: String, value: String?, to facts: inout [PreviewFact]) {
        guard let value, !value.isEmpty else {
            return
        }

        if let index = facts.firstIndex(where: { $0.label == label }) {
            facts[index] = PreviewFact(label: label, value: value)
        } else {
            facts.append(PreviewFact(label: label, value: value))
        }
    }

    private static func driverLabel(_ payload: [String: Any]) -> String? {
        payload["driverLongName"] as? String ?? payload["driverShortName"] as? String
    }

    private static func rasterSize(_ payload: [String: Any]) -> String? {
        guard let values = payload["size"] as? [Any], values.count >= 2 else {
            return nil
        }

        return "\(numberString(values[0])) × \(numberString(values[1]))"
    }

    private static func layerSummary(_ payload: [String: Any]) -> String? {
        guard let layers = payload["layers"] as? [[String: Any]], !layers.isEmpty else {
            return nil
        }

        let names = layers.compactMap { $0["name"] as? String }.filter { !$0.isEmpty }
        guard !names.isEmpty else {
            return String(layers.count)
        }

        let preview = names.prefix(3).joined(separator: ", ")
        return names.count > 3 ? "\(preview), +\(names.count - 3) more" : preview
    }

    private static func featureSummary(_ payload: [String: Any]) -> String? {
        guard let layers = payload["layers"] as? [[String: Any]], !layers.isEmpty else {
            return nil
        }

        let total = layers.reduce(0) { partialResult, layer in
            partialResult + (layer["featureCount"] as? Int ?? 0)
        }
        return total > 0 ? String(total) : nil
    }

    private static func crsLabel(_ payload: [String: Any]) -> String? {
        if let epsg = epsgCode((payload["stac"] as? [String: Any])?["proj:projjson"] as? [String: Any]) ?? (payload["stac"] as? [String: Any])?["proj:epsg"] as? Int {
            return "EPSG:\(epsg)"
        }

        if let epsg = epsgCode(payload["coordinateSystem"] as? [String: Any]) {
            return "EPSG:\(epsg)"
        }

        if let layers = payload["layers"] as? [[String: Any]] {
            for layer in layers {
                let geometryFields = layer["geometryFields"] as? [[String: Any]] ?? []
                for geometryField in geometryFields {
                    if let epsg = epsgCode(geometryField["coordinateSystem"] as? [String: Any]) {
                        return "EPSG:\(epsg)"
                    }
                }
            }
        }

        return nil
    }

    private static func epsgCode(_ coordinateSystem: [String: Any]?) -> Int? {
        if let projJSON = coordinateSystem?["projjson"] as? [String: Any],
           let id = projJSON["id"] as? [String: Any],
           (id["authority"] as? String)?.uppercased() == "EPSG",
           let code = id["code"] as? Int {
            return code
        }

        return nil
    }

    private static func bandSummary(_ payload: [String: Any]) -> String? {
        guard let bands = payload["bands"] as? [[String: Any]], !bands.isEmpty else {
            return nil
        }

        let descriptions = bands.prefix(4).map { band -> String in
            let color = (band["colorInterpretation"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let type = (band["type"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return [color, type].compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }.joined(separator: " ")
        }.filter { !$0.isEmpty }

        guard !descriptions.isEmpty else {
            return String(bands.count)
        }

        let preview = descriptions.joined(separator: " | ")
        return bands.count > descriptions.count ? "\(preview) | +\(bands.count - descriptions.count) more" : preview
    }

    private static func bounds(_ payload: [String: Any], kind: PreviewFileKind) -> [Double]? {
        if let polygonBounds = polygonBounds((payload["wgs84Extent"] as? [String: Any])?["coordinates"]) {
            return polygonBounds
        }

        if let corners = payload["cornerCoordinates"] as? [String: Any],
           let upperLeft = point(corners["upperLeft"]),
           let lowerRight = point(corners["lowerRight"]) {
            let candidate = [upperLeft.0, lowerRight.1, lowerRight.0, upperLeft.1]
            return validGeographicBounds(candidate) ? candidate : nil
        }

        if let layers = payload["layers"] as? [[String: Any]] {
            for layer in layers {
                let geometryFields = layer["geometryFields"] as? [[String: Any]] ?? []
                for geometryField in geometryFields {
                    if let extent = geometryField["extent"] as? [Double], extent.count == 4,
                       validGeographicBounds(extent) {
                        return extent
                    }
                }
            }
        }

        if kind == .geotiff,
           let geoTransform = payload["geoTransform"] as? [Double],
           geoTransform.count >= 6,
           geoTransform[2] == 0,
           geoTransform[4] == 0,
           let values = payload["size"] as? [Double],
           values.count >= 2 {
            let minX = geoTransform[0]
            let maxY = geoTransform[3]
            let maxX = minX + geoTransform[1] * values[0]
            let minY = maxY + geoTransform[5] * values[1]
            let candidate = [minX, minY, maxX, maxY]
            return validGeographicBounds(candidate) ? candidate : nil
        }

        return nil
    }

    private static func polygonBounds(_ coordinates: Any?) -> [Double]? {
        guard let polygons = coordinates as? [[[Any]]],
              let ring = polygons.first else {
            return nil
        }

        var minX = Double.infinity
        var minY = Double.infinity
        var maxX = -Double.infinity
        var maxY = -Double.infinity

        for coordinate in ring {
            guard coordinate.count >= 2,
                  let x = coordinate[0] as? Double,
                  let y = coordinate[1] as? Double else {
                continue
            }

            minX = min(minX, x)
            minY = min(minY, y)
            maxX = max(maxX, x)
            maxY = max(maxY, y)
        }

        let candidate = [minX, minY, maxX, maxY]
        return validGeographicBounds(candidate) ? candidate : nil
    }

    private static func point(_ value: Any?) -> (Double, Double)? {
        guard let coordinates = value as? [Double], coordinates.count >= 2 else {
            return nil
        }

        return (coordinates[0], coordinates[1])
    }

    private static func validGeographicBounds(_ bounds: [Double]) -> Bool {
        guard bounds.count == 4,
              bounds.allSatisfy({ $0.isFinite }),
              bounds[0] >= -180,
              bounds[2] <= 180,
              bounds[1] >= -90,
              bounds[3] <= 90,
              bounds[0] < bounds[2],
              bounds[1] < bounds[3] else {
            return false
        }

        return true
    }

    private static func format(bounds: [Double]) -> String {
        bounds.map { String(format: "%.4f", $0) }.joined(separator: ", ")
    }

    private static func numberString(_ value: Any) -> String {
        if let intValue = value as? Int {
            return String(intValue)
        }
        if let doubleValue = value as? Double {
            return String(Int(doubleValue.rounded()))
        }
        return String(describing: value)
    }
}
