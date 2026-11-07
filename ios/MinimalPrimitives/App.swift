// Minimal Primitives for iPhone, iPad and Mac (Mac Catalyst). By Luke Steuber.
// The whole browser collection is bundled in the app and served to a
// WKWebView from the app itself, so the library's catalog fetch, ES modules
// and localStorage work as they do on the web. Nothing is loaded from the
// network; outside links open in the browser.
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Collection", sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

/// One window holding the collection. UIKit requires the scene life cycle on
/// the Mac (and soon on iOS), so the window comes from the scene, not the app.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        #if targetEnvironment(macCatalyst)
        // A phone-shaped window by default; the games lay themselves out at any size.
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 360, height: 560)
        windowScene.titlebar?.titleVisibility = .hidden
        #endif
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = CollectionViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
