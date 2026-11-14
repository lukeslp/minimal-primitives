# Google Play listing (full build)

`fastlane/metadata/android/` is the camera-free F-Droid flavor's listing and says
there is no camera permission. The Play app is the full build, which declares
CAMERA for Look and hold by head or eyes, so its listing uses these files
instead: `short_description.txt` (80 characters at most) and
`full_description.txt` (4000 at most). Keep the game list in step with both.
