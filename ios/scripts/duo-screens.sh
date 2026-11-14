#!/bin/sh
# Photograph the app on an iPhone Duo simulator in whatever pose Device Hub has it in.
# By Luke Steuber.
#
#   ios/scripts/duo-screens.sh <simulator udid> <label> [game id]
#
# Fold the simulator first in Device Hub (Closed, Partially Open, Open; Option-drag
# the slider for an angle): simctl cannot fold it. The app restarts, opens the game
# if one is named (a debug build's -MPDuoProbe), and the active display is saved to
# artifacts/duo/<label>.png with the fold state the page saw in <label>.json.
set -eu
udid=$1 label=$2 game=${3:-}
bundle=com.oneimpossiblethingatatime.minimalprimitives
out=artifacts/duo
mkdir -p "$out"
data=$(xcrun simctl get_app_container "$udid" "$bundle" data)
rm -f "$data/Documents/duo-probe.json"
if [ -n "$game" ]; then
  xcrun simctl launch --terminate-running-process "$udid" "$bundle" -MPDuoProbe "$game" >/dev/null
else
  # The home screen: probe a game id that doesn't exist, so it only reports the fold.
  xcrun simctl launch --terminate-running-process "$udid" "$bundle" -MPDuoProbe none >/dev/null
fi
i=0
while [ ! -f "$data/Documents/duo-probe.json" ] && [ $i -lt 70 ]; do sleep 0.5; i=$((i + 1)); done
sleep 1
cp "$data/Documents/duo-probe.json" "$out/$label.json" 2>/dev/null || echo '{}' > "$out/$label.json"
# The inner display (LCD-1) is lit whenever the phone is open at all.
if xcrun devicectl device info displays --device "$udid" 2>/dev/null | grep -A12 'name: LCD-1' | grep -q 'active: true'; then
  display=LCD-1
else
  display=1
fi
xcrun simctl io "$udid" screenshot --display="$display" "$out/$label.png" >/dev/null
echo "$out/$label.png ($display): $(cat "$out/$label.json")"
