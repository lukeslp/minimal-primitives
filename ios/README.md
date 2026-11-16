# Minimal Primitives for iOS

A small native shell that plays the Minimal Primitives collection exactly as the
browser build makes it, like the Android app. Builds go out through TestFlight and App Store Connect.

- `CollectionSchemeHandler` serves the app's bundled `www` folder (a copy of
  `build/html`) on its own origin, `minimal://collection/`. WebKit treats it as a
  secure context, so the library's catalog fetch, ES modules, localStorage and
  the camera work as they do on the web (checked in the iOS 26.5 simulator:
  `isSecureContext` true, `navigator.mediaDevices.getUserMedia` present).
- Nothing loads from the network. Web links open in Safari; anything else is
  refused.
- The camera, for Look and hold by head or eyes, is offered only to the bundled
  collection, and iOS asks the player first (`NSCameraUsageDescription`).
- Identity: `com.oneimpossiblethingatatime.minimalprimitives`, version 0.5.7 (build 25), matching Android,
  team 596T7J7FB6, iPhone and iPad.

## Build

```sh
python3 tools/build.py
rm -rf ios/www && cp -R build/html ios/www
cd ios && xcodegen generate
xcodebuild -project MinimalPrimitives.xcodeproj -scheme MinimalPrimitives \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

The app icon comes from the Hexsweeper Sphere tile, as on Android:
`swift ios/tools/draw-icons.swift` from the repository root redraws it into
`Assets.xcassets`.

The loader is the Minimal index's opening. The launch screen is its first frame,
the ground alone: `LaunchBackground`, white in light appearance and black in
dark, which is also the web view's color before the first paint. The web layer
plays the rest: `web/library-theme.js` follows the phone's appearance and
decides before the first paint whether the opening plays, so its ground is
drawn at once, and `web/collection.js` brings in the name, the eight
primitives, then moves the name up to become the title. A tap or key skips to
the title; reduced motion (the system's or the library's Motion setting), the
Checkerboard theme and a return to a game go straight to the library. A theme
picked in the library's settings that differs from the phone's appearance
shows the launch color for a moment first: the launch screen can only follow
the phone.

iPhone Duo: `DuoBridge.swift` and `duo-fold.js` tell the collection where the
fold is; the layouts and checks are in `docs/iphone-duo.md`.

Still to check on a real phone: the camera, VoiceOver and a hardware keyboard.
