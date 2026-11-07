package minimalprimitives.android

import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {
    @Test
    fun collectionPagesStayInsideTheApp() {
        for (url in listOf(
            UrlPolicy.START_URL,
            "https://appassets.androidplatform.net/assets/www/index.html#game=hexsweeper%3Asphere",
            "https://appassets.androidplatform.net/assets/www/games/akari/index.html?minimal=x&look=dark",
            "https://APPASSETS.androidplatform.net/assets/www/catalog.json",
        )) {
            assertEquals(url, UrlDecision.ALLOW_LOCAL, UrlPolicy.classify(url))
        }
    }

    @Test
    fun outsideLinksOpenInTheBrowser() {
        for (url in listOf(
            "https://oneimpossiblethingatatime.com/",
            "https://lukesteuber.com",
            "https://datapoems.io",
            "http://example.com/path",
        )) {
            assertEquals(url, UrlDecision.OPEN_EXTERNAL, UrlPolicy.classify(url))
        }
    }

    @Test
    fun otherAssetPathsAndSchemesAreBlocked() {
        for (url in listOf(
            "http://appassets.androidplatform.net/assets/www/index.html",
            "https://appassets.androidplatform.net/res/drawable/x.png",
            "https://appassets.androidplatform.net/assets/www/../other.html",
            "https://appassets.androidplatform.net:8443/assets/www/index.html",
            "file:///android_asset/www/index.html",
            "file:///sdcard/private.txt",
            "content://example/data",
            "javascript:alert(1)",
            "intent://scan/#Intent;scheme=zxing;end",
            "data:text/html,hello",
            "not a url",
            "",
            null,
        )) {
            assertEquals(url.toString(), UrlDecision.BLOCK, UrlPolicy.classify(url))
        }
    }
}
