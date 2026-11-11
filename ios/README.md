# Minimal Primitives for iOS

A small native shell that plays the Minimal Primitives
collection exactly as the browser build makes it, like the Android app. Not
published anywhere; the first build goes to TestFlight only, once approved.

- `CollectionSchemeHandler` serves the app's bundled `www` folder (a copy of
  `build/html`) on its own origin, `minimal://collection/`. WebKit treats it as a
  secure context, so the library's catalog fetch, ES modules, localStorage and
  the camera work as they do on the web (checked in the iOS 26.5 simulator:
  `isSecureContext` true, `navigator.mediaDevices.getUserMedia` present).
- Nothing loads from the network. Web links open in Safari; anything else is
  refused.
- The camera, for Look and hold by head or eyes, is offered only to the bundled
  collection, and iOS asks the player first (`NSCameraUsageDescription`).
- Identity: `com.oneimpossiblethingatatime.minimalprimitives`, version 0.3.0 (5), matching Android,
  team 596T7J7FB6, iPhone and iPad.

## Build

```sh
python3 tools/build.py
rm -rf ios/www && cp -R build/html ios/www
cd ios && xcodegen generate
xcodebuild -project MinimalPrimitives.xcodeproj -scheme MinimalPrimitives \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

The app icon and launch image come from the Hexsweeper Sphere tile, as on
Android: `swift ios/tools/draw-icons.swift` from the repository root redraws
them into `Assets.xcassets`.

Still to do: a real phone with its camera, VoiceOver and a hardware keyboard,
and a TestFlight archive.
