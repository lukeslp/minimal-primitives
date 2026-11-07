package minimalprimitives.android

import java.net.URI

internal enum class UrlDecision {
    ALLOW_LOCAL,
    OPEN_EXTERNAL,
    BLOCK,
}

/**
 * Decides where a navigation may go. Only the bundled collection on the
 * virtual asset origin loads inside the WebView; web links open in the
 * phone's browser; everything else is refused.
 */
internal object UrlPolicy {
    const val ASSET_HOST = "appassets.androidplatform.net"
    const val COLLECTION_PATH = "/assets/www/"
    const val START_URL = "https://$ASSET_HOST${COLLECTION_PATH}index.html"

    fun classify(rawUrl: String?): UrlDecision {
        if (rawUrl.isNullOrBlank()) return UrlDecision.BLOCK
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return UrlDecision.BLOCK
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return UrlDecision.BLOCK
        val host = uri.host
        return when {
            host.isNullOrEmpty() -> UrlDecision.BLOCK
            host.equals(ASSET_HOST, ignoreCase = true) ->
                if (scheme == "https" && isCollection(uri)) UrlDecision.ALLOW_LOCAL else UrlDecision.BLOCK
            else -> UrlDecision.OPEN_EXTERNAL
        }
    }

    private fun isCollection(uri: URI): Boolean =
        (uri.port == -1 || uri.port == 443) &&
            uri.rawPath?.startsWith(COLLECTION_PATH) == true &&
            uri.path?.contains("..") != true
}
