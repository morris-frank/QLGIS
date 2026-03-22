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
            let previewBundle = Bundle(for: Self.self)
            let dataURL = try PreviewConfiguration.previewDataURL()
            let styleURL = try PreviewConfiguration.styleURL(bundle: previewBundle)
            let kind = try PreviewFileKind.detect(from: url)
            let response = try PreviewDataResponseBuilder.makeResponse(for: url, kind: kind)
            let bootstrap = PreviewBootstrap(
                kind: kind,
                displayName: url.lastPathComponent,
                dataURL: dataURL.absoluteString,
                styleURL: styleURL.absoluteString
            )

            await MainActor.run {
                self.title = bootstrap.displayName
                self.schemeHandler.updateCurrentPreview(response: response)
                self.showFallback(nil)
            }

            try await ensureWebShellLoaded(bundle: previewBundle)
            try await injectBootstrap(bootstrap)
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
