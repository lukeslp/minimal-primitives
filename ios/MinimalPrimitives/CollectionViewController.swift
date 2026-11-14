// The web view that plays the collection, and the rules for what it may load.
// By Luke Steuber.
import UIKit
import WebKit
import UniformTypeIdentifiers

/// Serves the bundled collection (the app's `www` folder) on its own origin.
final class CollectionSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "minimal"
    static let host = "collection"
    static let start = URL(string: "\(scheme)://\(host)/index.html")!
    private let root = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == Self.host else { return fail(task, 404) }
        var path = url.path
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else { return fail(task, 404) }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ status: Int) {
        let response = HTTPURLResponse(url: task.request.url ?? Self.start, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
        task.didReceive(response)
        task.didReceive(Data())
        task.didFinish()
    }
}

final class CollectionViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    // iPhone Duo: the fold and hinge reach the collection and every game frame (DuoBridge.swift, duo-fold.js).
    private var duo: DuoBridge!

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(CollectionSchemeHandler(), forURLScheme: CollectionSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        duo = DuoBridge(configuration: config)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view = webView
        duo.attach(to: webView)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        #if DEBUG
        // Checks only, for a simulator that cannot fold: -MPDuoSimulate book|laptop reports a
        // made-up fold (a 24 pt band across the middle) so the layouts can be photographed.
        if let pose = UserDefaults.standard.string(forKey: "MPDuoSimulate") { duo.simulated = Self.simulatedFold(pose, in: view.bounds.size) }
        #endif
        duo.refresh()
    }

    #if DEBUG
    private static func simulatedFold(_ pose: String, in size: CGSize) -> [String: Any] {
        let band = 24.0, w = Double(size.width), h = Double(size.height)
        let fold: [String: Double] = pose == "laptop"
            ? ["x": 0, "y": (h - band) / 2, "width": w, "height": band]
            : ["x": (w - band) / 2, "y": 0, "width": band, "height": h]
        return ["hinge": true, "status": "partially-open", "angle": 110.0, "fold": fold, "reserved": fold]
    }
    #endif

    override func viewDidLoad() {
        super.viewDidLoad()
        var start = CollectionSchemeHandler.start
        #if DEBUG
        // Checks can open one page directly: -MPStart games/glance/index.html
        if let path = UserDefaults.standard.string(forKey: "MPStart"), let url = URL(string: path, relativeTo: start) { start = url }
        #endif
        webView.load(URLRequest(url: start))
    }

    // Only the bundled collection loads inside the app; web links open in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == CollectionSchemeHandler.scheme && url.host == CollectionSchemeHandler.host { return decisionHandler(.allow) }
        if url.scheme == "about" { return decisionHandler(.allow) }
        if (url.scheme == "https" || url.scheme == "http") && action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    // The camera, for Look and hold by head or eyes, only for the bundled
    // collection. iOS's own camera prompt (NSCameraUsageDescription) still asks
    // the player once; the page is not asked again on every visit, as on Android.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == CollectionSchemeHandler.scheme && origin.host == CollectionSchemeHandler.host && type == .camera ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        duo.resend()
        #if DEBUG
        // Checks only: -MPDuoProbe <game id> opens that game and logs the fold state the game frame sees.
        if let game = UserDefaults.standard.string(forKey: "MPDuoProbe"), webView.url?.path == "/index.html" {
            let probe = """
            const wait = ms => new Promise(r => setTimeout(r, ms));
            for (let i = 0; i < 40 && !document.querySelector('.tile[data-game="' + game + '"]'); i++) await wait(250);
            document.querySelector('.tile[data-game="' + game + '"]')?.click();
            await wait(3000);
            const f = document.querySelector('#player iframe'), w = f?.contentWindow, d = f?.contentDocument;
            const attrs = el => el ? Object.fromEntries([...el.attributes].filter(a => a.name.startsWith('data-duo') || a.name === 'style').map(a => [a.name, a.value])) : null;
            return JSON.stringify({ top: attrs(document.documentElement), player: document.getElementById('player').dataset.duo || null,
              frame: f && f.getBoundingClientRect().toJSON(), child: attrs(d?.documentElement), childShim: !!w?.DuoFold && w.DuoFold.document === d,
              proxies: [...document.querySelectorAll('#duo-pane .duo-proxy')].map(b => b.getAttribute('aria-label')), size: [innerWidth, innerHeight] });
            """
            webView.callAsyncJavaScript(probe, arguments: ["game": game], in: nil, in: .page) { result in
                let text = (try? result.get() as? String) ?? "nil"
                let out = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("duo-probe.json")
                try? text.write(to: out, atomically: true, encoding: .utf8)
                NSLog("MinimalPrimitives duo probe: %@", text)
            }
        }
        // Checks only: run with -MPProbe YES (and -MPProbeCamera YES to try the camera).
        guard UserDefaults.standard.bool(forKey: "MPProbe") else { return }
        let camera = UserDefaults.standard.bool(forKey: "MPProbeCamera")
        // Probe for the camera question: is the collection a secure context with mediaDevices?
        let probe = """
        const out = {secure: window.isSecureContext, media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), href: location.href};
        try { localStorage.setItem('probe', '1'); out.storage = localStorage.getItem('probe') === '1'; } catch (e) { out.storage = String(e); }
        try { const r = await fetch('catalog.json'); out.games = (await r.json()).length; } catch (e) { out.games = String(e); }
        if (camera) { try { const s = await navigator.mediaDevices.getUserMedia({video: true}); out.camera = 'granted'; s.getTracks().forEach(t => t.stop()); } catch (e) { out.camera = e.name; } }
        // A camera game: start its camera and see whether MediaPipe gets going.
        const wait = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 40 && !window.__glance; i++) await wait(250);
        if (window.__glance) {
          const b = document.querySelector('#camera-start'); if (b) b.click();
          for (let i = 0; i < 120; i++) { out.phase = __glance.input && __glance.input.phase; if (['calibrating', 'camera'].includes(out.phase)) break; await wait(500); }
          out.errors = (window.__errors || []).slice(0, 3);
        }
        return JSON.stringify(out);
        """
        webView.callAsyncJavaScript(probe, arguments: ["camera": camera], in: nil, in: .page) { result in
            let text = (try? result.get() as? String) ?? "nil"
            let out = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("probe.json")
            try? text.write(to: out, atomically: true, encoding: .utf8)
            NSLog("MinimalPrimitives probe: %@", text)
        }
        #endif
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
