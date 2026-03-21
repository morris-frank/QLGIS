import Foundation
import WebKit
import QLGISCore

final class PreviewSchemeHandler: NSObject, WKURLSchemeHandler {
    private struct CurrentPreview {
        let response: PreviewDataResponse
    }

    private let stateQueue = DispatchQueue(label: "QLGIS.PreviewSchemeHandler")
    private var currentPreview: CurrentPreview?

    func updateCurrentPreview(response: PreviewDataResponse) {
        stateQueue.sync {
            currentPreview = CurrentPreview(response: response)
        }
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        do {
            let requestURL = try validatedRequestURL(from: urlSchemeTask.request)
            let preview = try currentPreviewState()

            let headerFields = [
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                "Content-Disposition": contentDispositionHeaderValue(for: preview.response.suggestedFilename),
                "Content-Length": String(preview.response.data.count),
                "Content-Type": preview.response.mimeType
            ]

            let urlResponse = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: headerFields
            ) ?? URLResponse(
                url: requestURL,
                mimeType: preview.response.mimeType,
                expectedContentLength: preview.response.data.count,
                textEncodingName: nil
            )

            urlSchemeTask.didReceive(urlResponse)
            urlSchemeTask.didReceive(preview.response.data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        _ = urlSchemeTask
    }

    private func validatedRequestURL(from request: URLRequest) throws -> URL {
        guard let requestURL = request.url,
              requestURL.scheme == PreviewConfiguration.previewScheme,
              requestURL.host == PreviewConfiguration.previewHost,
              requestURL.path == PreviewConfiguration.previewPath else {
            throw PreviewError.invalidPreviewDataURL
        }

        return requestURL
    }

    private func currentPreviewState() throws -> CurrentPreview {
        try stateQueue.sync {
            guard let currentPreview else {
                throw PreviewError.invalidPreviewDataURL
            }
            return currentPreview
        }
    }

    private func contentDispositionHeaderValue(for suggestedFilename: String) -> String {
        let sanitizedFilename = suggestedFilename.replacingOccurrences(of: "\"", with: "")
        return "inline; filename=\"\(sanitizedFilename)\""
    }
}
