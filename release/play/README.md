# Google Play listing (full build)

`fastlane/metadata/android/` is the camera-free F-Droid flavor's listing and says
there is no camera permission. The Play app is the full build, which declares
CAMERA for Look and hold by head or eyes, so its listing uses these files
instead: `short_description.txt` (80 characters at most) and
`full_description.txt` (4000 at most). Keep the game list in step with both.

`feature-graphic.png` is the 1024×500 feature graphic approved on
2026-11-14: eight real board captures (Slant, Towers, Constellations,
Horologist; Tents, Shoo, Hexsweeper's sphere, Bridges) on plain `#141414`, no
text. `tools/compose-play-feature-graphic.sh` rebuilds it from the iPhone
captures made by `tools/capture-store-panels.cjs`. The rebuild matches except
for resampling noise in about 0.3% of pixels.
