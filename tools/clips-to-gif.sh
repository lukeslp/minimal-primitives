#!/bin/bash
# Turns tools/capture-clips.cjs recordings into the itch formats: a 480 px looping
# GIF (12 fps, 64 colors, as the first Tilt and Horologist clips), an H.264 MP4
# and a poster frame. Needs ffmpeg:
#   tools/clips-to-gif.sh release/clips
# Luke Steuber.
set -euo pipefail
dir="${1:?clips folder}"
for json in "$dir"/*.json; do
  n=$(basename "$json" .json)
  start=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["start"])' "$json")
  secs=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["seconds"])' "$json")
  ffmpeg -loglevel error -y -ss "$start" -t "$secs" -i "$dir/$n.webm" -an -vf "fps=30,scale=720:720" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$dir/$n.mp4"
  ffmpeg -loglevel error -y -i "$dir/$n.mp4" -vf "fps=12,scale=480:480:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer" "$dir/$n.gif"
  ffmpeg -loglevel error -y -ss 3 -i "$dir/$n.mp4" -frames:v 1 "$dir/$n-poster.jpg"
  printf '%s  %s bytes\n' "$n.gif" "$(wc -c < "$dir/$n.gif" | tr -d ' ')"
done
