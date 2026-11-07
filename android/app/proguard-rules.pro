# No JavaScript interface is exposed to the page. Keep WebView client callbacks
# so their platform entry points stay obvious after optimization.
-keepclassmembers class * extends android.webkit.WebViewClient {
    public *;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public *;
}
