/*
 * Minimal Primitives for Android. The whole browser collection is bundled as
 * assets and served from a virtual HTTPS origin by WebViewAssetLoader, so the
 * library's catalog fetch, ES modules and localStorage work as they do on the
 * web. Nothing is loaded from the network.
 */

@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package minimalprimitives.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var container: FrameLayout
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var backCallback: OnBackInvokedCallback? = null
    private var pageShown = false
    private var rendererGone = false
    private var cameraRequest: PermissionRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(UrlPolicy.ASSET_HOST)
            .addPathHandler("/assets/", CollectionAssets(WebViewAssetLoader.AssetsPathHandler(this)))
            .build()
        webView = createWebView()
        container = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.shell_background))
            addView(
                webView,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
            )
            setOnApplyWindowInsetsListener { view, insets ->
                padToSafeArea(view, insets)
                insets
            }
        }
        setContentView(container)
        layoutIntoCutouts()
        keepScreenImmersive()
        holdSplashUntilPageShown()

        val restored = savedInstanceState?.let { webView.restoreState(it) } != null
        if (!restored) webView.loadUrl(UrlPolicy.START_URL)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = OnBackInvokedCallback(::handleBack).also { callback ->
                onBackInvokedDispatcher.registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    callback,
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        setBackgroundColor(getColor(R.color.shell_background))
        isFocusable = true
        isFocusableInTouchMode = true
        overScrollMode = View.OVER_SCROLL_NEVER
        // Games own every gesture: no long-press text selection or menus.
        isLongClickable = false
        isHapticFeedbackEnabled = false
        setOnLongClickListener { true }

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            setGeolocationEnabled(false)
            safeBrowsingEnabled = false
        }

        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        webViewClient = CollectionClient()
        webChromeClient = CameraClient()
    }

    /**
     * Look and hold by head or eyes asks the page for the camera. Only the
     * camera, and only for the bundled collection, is passed on to Android's
     * own permission prompt; everything else a page asks for is refused.
     */
    private inner class CameraClient : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            val camera = PermissionRequest.RESOURCE_VIDEO_CAPTURE
            // The fdroid flavor has no camera input and no CAMERA permission.
            if (!BuildConfig.CAMERA_INPUT || request.origin.host != UrlPolicy.ASSET_HOST || camera !in request.resources) {
                request.deny()
                return
            }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(arrayOf(camera))
                return
            }
            cameraRequest?.deny()
            cameraRequest = request
            requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_REQUEST_CODE)
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (cameraRequest == request) cameraRequest = null
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_REQUEST_CODE) return
        val request = cameraRequest ?: return
        cameraRequest = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            request.deny()
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        keepScreenImmersive()
    }

    override fun onPause() {
        webView.pauseTimers()
        webView.onPause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) keepScreenImmersive()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        keepScreenImmersive()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (!rendererGone) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() {
        handleBack()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback?.let(onBackInvokedDispatcher::unregisterOnBackInvokedCallback)
            backCallback = null
        }
        container.removeView(webView)
        webView.stopLoading()
        webView.webViewClient = WebViewClient()
        webView.destroy()
        super.onDestroy()
    }

    /**
     * Back follows the collection: it closes the scores dialog, then inside a
     * game it presses the game's own Home control (which saves the board and
     * Undo before showing the library), from the accessible grid it returns to
     * all games, and from the library it leaves.
     */
    private fun handleBack() {
        if (rendererGone) {
            leaveApp()
            return
        }
        webView.evaluateJavascript(BACK_SCRIPT) { result ->
            when (result?.trim('"')) {
                "dialog", "home", "grid", "loading" -> Unit
                "stuck" -> webView.evaluateJavascript(LIBRARY_SCRIPT, null)
                else -> leaveApp()
            }
        }
    }

    private fun leaveApp() {
        // Android 12 and later keep a root activity alive on Back; match that.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) moveTaskToBack(true) else finish()
    }

    private fun holdSplashUntilPageShown() {
        val started = SystemClock.uptimeMillis()
        container.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (!pageShown && SystemClock.uptimeMillis() - started < SPLASH_LIMIT_MS) return false
                container.viewTreeObserver.removeOnPreDrawListener(this)
                return true
            }
        })
    }

    private fun layoutIntoCutouts() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            } else {
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }

    private fun keepScreenImmersive() {
        val activityWindow = window ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activityWindow.setDecorFitsSystemWindows(false)
            activityWindow.insetsController?.let { controller ->
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsets.Type.systemBars())
            }
        } else {
            activityWindow.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    /** The page draws edge to edge but never under a cutout, a visible bar or the keyboard. */
    private fun padToSafeArea(view: View, insets: WindowInsets) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val safe = insets.getInsets(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime(),
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val cutout = insets.displayCutout
            view.setPadding(
                maxOf(insets.systemWindowInsetLeft, cutout?.safeInsetLeft ?: 0),
                maxOf(insets.systemWindowInsetTop, cutout?.safeInsetTop ?: 0),
                maxOf(insets.systemWindowInsetRight, cutout?.safeInsetRight ?: 0),
                maxOf(insets.systemWindowInsetBottom, cutout?.safeInsetBottom ?: 0),
            )
        } else {
            view.setPadding(
                insets.systemWindowInsetLeft,
                insets.systemWindowInsetTop,
                insets.systemWindowInsetRight,
                insets.systemWindowInsetBottom,
            )
        }
    }

    private fun openInBrowser(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_browser_message, Toast.LENGTH_LONG).show()
        }
    }

    private inner class CollectionClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            assetLoader.shouldInterceptRequest(url)?.let { return it }
            // Anything else on http(s) is answered here and never reaches a network.
            return when (url.scheme?.lowercase()) {
                "http", "https" -> notFound()
                else -> null
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            when (UrlPolicy.classify(request.url.toString())) {
                UrlDecision.ALLOW_LOCAL -> false
                UrlDecision.OPEN_EXTERNAL -> {
                    if (request.hasGesture()) openInBrowser(request.url)
                    true
                }
                UrlDecision.BLOCK -> true
            }

        override fun onPageFinished(view: WebView, url: String?) {
            pageShown = true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            rendererGone = true
            Toast.makeText(this@MainActivity, R.string.webview_restart_message, Toast.LENGTH_LONG).show()
            recreate()
            return true
        }
    }

    /** Serves only www/ from the APK's assets, with types WebView needs for fonts and text. */
    private class CollectionAssets(
        private val assets: WebViewAssetLoader.AssetsPathHandler,
    ) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            if (!path.startsWith("www/")) return notFound()
            val response = assets.handle(path) ?: return null
            if (response.data == null) return notFound()
            val extension = path.substringAfterLast('/').substringAfterLast('.', "").lowercase()
            MIME_TYPES[extension]?.let { response.mimeType = it }
            if (extension in UTF8_TYPES) response.encoding = "utf-8"
            return response
        }
    }

    private companion object {
        const val SPLASH_LIMIT_MS = 1500L
        const val CAMERA_REQUEST_CODE = 41

        val MIME_TYPES = mapOf(
            "woff2" to "font/woff2",
            "woff" to "font/woff",
            "ttf" to "font/ttf",
            "otf" to "font/otf",
            "txt" to "text/plain",
            "md" to "text/markdown",
            "mjs" to "text/javascript",
            "wasm" to "application/wasm",
            "task" to "application/octet-stream",
        )
        val UTF8_TYPES = setOf("html", "htm", "js", "mjs", "css", "json", "svg", "txt", "md")

        fun notFound() = WebResourceResponse(
            "text/plain",
            "utf-8",
            404,
            "Not Found",
            emptyMap(),
            ByteArrayInputStream(ByteArray(0)),
        )

        /**
         * Reports what Back should do. Inside a game it clicks the game's Home
         * control (#minimal-home, added by the collection's hooks), the same
         * path a tap on Home takes, so the board and Undo are saved first.
         */
        const val BACK_SCRIPT = """(function () {
  var open = document.querySelector('dialog[open]');
  if (open) { open.close(); return 'dialog'; }
  var player = document.getElementById('player');
  if (!player || player.hidden) {
    var grid = document.getElementById('accessible'), back = document.getElementById('access-back');
    if (grid && !grid.hidden && back) { back.click(); return 'grid'; }
    return 'library';
  }
  var frame = player.querySelector('iframe'), doc = null;
  try { doc = frame && frame.contentDocument; } catch (e) {}
  var home = doc && doc.getElementById('minimal-home');
  if (home) { home.click(); return 'home'; }
  return doc && doc.readyState === 'complete' ? 'stuck' : 'loading';
})()"""

        /** A game that loaded without its Home control has nothing to save: show the library. */
        const val LIBRARY_SCRIPT = """(function () {
  try {
    for (var i = sessionStorage.length - 1; i >= 0; i--) {
      var key = sessionStorage.key(i);
      if (key && key.slice(-9) === ':selected') sessionStorage.removeItem(key);
    }
  } catch (e) {}
  location.replace(location.pathname);
})()"""
    }
}
