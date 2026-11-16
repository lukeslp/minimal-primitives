#!/usr/bin/env bash
# Build the 1024x500 Google Play feature graphic from real iPhone captures
# made by tools/capture-store-panels.cjs (1320x2868, one game per file).
# Usage: tools/compose-play-feature-graphic.sh PANELS_DIR OUT.png
# Each board is trimmed from its capture, padded square in its own
# background color, and laid out 4x2 on plain #141414. No text.
set -euo pipefail
panels=${1:?panels directory}; out=${2:?output png}
order=(slant-color-dark towers-light constellations-dark horologist-light
       tents-light shoo-solved hex-sphere-dark bridges-dark)
W=1024 H=500 T=228 G=14
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
gx=$(( (W - 4*T - 3*G) / 2 )); gy=$(( (H - 2*T - G) / 2 ))
args=(); i=0
for f in "${order[@]}"; do
  src="$panels/$f.png"
  bg=$(magick "$src" -format '%[pixel:p{20,1500}]' info:)
  board() { magick "$src" -crop 1320x2200+0+330 +repage -bordercolor "$bg" -border 1 -fuzz 6% -trim +repage "$@"; }
  s=$(board -format '%[fx:round(max(w,h)*1.22)]' info:)
  board -background "$bg" -gravity center -extent "${s}x${s}" -resize "${T}x${T}" "$tmp/$f.png"
  x=$(( gx + (i % 4) * (T + G) )); y=$(( gy + (i / 4) * (T + G) ))
  args+=("$tmp/$f.png" -geometry "+$x+$y" -composite); i=$((i + 1))
done
magick -size "${W}x${H}" xc:'#141414' "${args[@]}" -strip "$out"
