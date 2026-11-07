#!/bin/bash
# Builds Minimal Primitives for iPhone and iPad and uploads it to TestFlight: ios/scripts/testflight.sh BUILD_NUMBER
# Each upload needs a build number higher than the last. Run from napoleon's logged-in session (signing needs
# the login keychain). By Luke Steuber.
set -euo pipefail
build="${1:?build number}"
cd "$(dirname "$0")/../.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_OPT_OUT_USAGE=1
/opt/homebrew/bin/python3 tools/build.py
# Xcode's IPA step runs rsync from PATH and needs Apple's: Homebrew's rsync 3.x rejects its options.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin
rm -rf ios/www && cp -R build/html ios/www
cd ios
xcodegen generate --quiet
fastlane profiles
fastlane archive build:"$build"
fastlane upload
