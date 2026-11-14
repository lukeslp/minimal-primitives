#!/bin/bash
# App Store frames from tools/capture-store-panels.cjs output: one full screen, or a 2x2 grid of four real screens.
# Usage: tools/compose-store-frames.sh PANEL_DIR OUT_DIR W H   (iPhone 6.9" 1320 2868, iPad 13" 2064 2752;
# the 6.3" set is the 6.9" frames resized to 1206x2622). Needs ImageMagick 7.
set -euo pipefail
P=$1; O=$2; W=$3; H=$4; G=$(( W * 36 / 1320 )); mkdir -p "$O"
CW=$(( (W - 3*G) / 2 )); CH=$(( CW * H / W )); TOP=$(( (H - 2*CH - G) / 2 ))
single(){ magick "$P/$2.png" -resize "${W}x${H}!" "$O/$1.png"; }
grid(){ out=$1 bg=$2; shift 2; local args=() i=0
  for name in "$@"; do x=$(( G + (i%2)*(CW+G) )); y=$(( TOP + (i/2)*(CH+G) ))
    args+=( \( "$P/$name.png" -resize "${CW}x${CH}!" -bordercolor '#8a8a8a' -border 1 \) -geometry +$((x-1))+$((y-1)) -composite ); i=$((i+1)); done
  magick -size ${W}x${H} "xc:$bg" "${args[@]}" -alpha off "$O/$out.png"; }
single 01-slant-color slant-color-dark
single 02-shoo-minimal shoo-solved
single 03-tilt-3d tilt3d-dark
grid   04-dark '#141414' akari-dark bridges-dark galaxies-dark delve-dark
grid   05-hexsweeper-three-ways '#141414' hex-infinite-dark hex-classic-light hex-sphere-dark hex-infinite-light
grid   06-light '#ecebe7' slant-color-light towers-light tents-light balance-light
grid   07-access '#141414' access-look-akari access-switch-bridges glance nod
single 08-hexsweeper-sphere hex-sphere-light
grid   09-mixed '#ecebe7' cast-solved horologist-light constellations-dark notan-light
single 10-library library-light
