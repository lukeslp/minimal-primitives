#!/bin/sh
# Sign an unsigned Minimal Primitives fdroid release APK with the established upstream key, the
# way F-Droid's reproducible-build check expects: v2 and v3 only, and the
# existing ZIP alignment preserved, so the signed file is the unsigned build
# plus a signing block. Run it through the release toolkit, which supplies the
# four MINIMAL_PRIMITIVES_RELEASE_* variables from the Keychain for this process only:
#
#   scripts/android-release with-signing --profile minimal-primitives -- \
#     fdroid/sign-upstream.sh app-fdroid-release-unsigned.apk minimal-primitives-0.4.0.apk
#
# Passwords are read by apksigner from the environment, never from arguments.
set -eu
in=${1:?unsigned APK}
out=${2:?signed APK to create}
tools=${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools/36.0.0}
: "${MINIMAL_PRIMITIVES_RELEASE_STORE_FILE:?run through android-release with-signing --profile minimal-primitives}"
: "${MINIMAL_PRIMITIVES_RELEASE_KEY_ALIAS:?}" "${MINIMAL_PRIMITIVES_RELEASE_STORE_PASSWORD:?}" "${MINIMAL_PRIMITIVES_RELEASE_KEY_PASSWORD:?}"
[ ! -e "$out" ] || { echo "Refusing to overwrite $out" >&2; exit 1; }
"$tools/apksigner" sign \
  --ks "$MINIMAL_PRIMITIVES_RELEASE_STORE_FILE" --ks-key-alias "$MINIMAL_PRIMITIVES_RELEASE_KEY_ALIAS" \
  --ks-pass env:MINIMAL_PRIMITIVES_RELEASE_STORE_PASSWORD --key-pass env:MINIMAL_PRIMITIVES_RELEASE_KEY_PASSWORD \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
  --v4-signing-enabled false --alignment-preserved true \
  --out "$out" "$in"
"$tools/apksigner" verify --print-certs "$out" | grep -E 'Signer #1 certificate (DN|SHA-256)'
