#!/usr/bin/env bash
# One-time: signs the recorder Gmail in on this server, so the login stays valid here (Google
# rejects a login copied from another computer). Opens Chromium on a virtual screen you see from
# your Mac through an SSH tunnel:
#   on the Mac:   ssh -i ~/.ssh/almaed_oracle -L 5950:localhost:5950 ubuntu@<server ip> 'bash almaed-recorder/login.sh'
#   then open:    vnc://localhost:5950   (Finder → Go → Connect to Server)
# Sign in at accounts.google.com, open meet.google.com once, then close the VNC window and press
# Ctrl-C in the terminal. The screen is only reachable through the tunnel (no password, localhost only).
set -euo pipefail
systemctl --user stop almaed-recorder 2> /dev/null || true
cd "$HOME/almaed-recorder"
CHROMIUM=$(node -e "import('playwright').then((p) => console.log(p.chromium.executablePath()))")
Xvfb :50 -screen 0 1280x800x24 &
XVFB=$!
trap 'kill $XVFB 2> /dev/null; systemctl --user start almaed-recorder' EXIT
sleep 1
DISPLAY=:50 x11vnc -display :50 -localhost -rfbport 5950 -nopw -forever -quiet &
DISPLAY=:50 "$CHROMIUM" --user-data-dir="$HOME/recorder-profile" --no-first-run --start-maximized https://accounts.google.com/
