#!/usr/bin/env bash
# One-time setup of the AlmaEd recorder on the Oracle server (Ubuntu 24.04, ARM), as user ubuntu:
#   SITE_URL=https://alma-ed-1.vercel.app RECORDER_SECRET=... bash setup.sh
# Then sign the recorder Gmail in once with login.sh. Everything here is free software.
set -euo pipefail
: "${SITE_URL:?}" "${RECORDER_SECRET:?}"

sudo apt-get update -qq
sudo apt-get install -y -qq xvfb pulseaudio ffmpeg x11vnc git curl > /dev/null
if ! command -v node > /dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null
  sudo apt-get install -y -qq nodejs > /dev/null
fi

cd "$HOME"
[ -d almaed-recorder ] || git clone -q https://github.com/Ravi00007777/almaed-recorder.git
cd almaed-recorder && git pull -q && npm ci --no-audit --no-fund
npx playwright install --with-deps chromium > /dev/null

mkdir -p "$HOME/recorder-profile" "$HOME/.config/systemd/user"
umask 077
cat > "$HOME/.config/almaed-recorder.env" <<ENV
SITE_URL=$SITE_URL
RECORDER_SECRET=$RECORDER_SECRET
PROFILE_DIR=$HOME/recorder-profile
ENV

cat > "$HOME/.config/systemd/user/almaed-recorder.service" <<UNIT
[Unit]
Description=AlmaEd class recorder
After=network-online.target

[Service]
WorkingDirectory=$HOME/almaed-recorder
EnvironmentFile=$HOME/.config/almaed-recorder.env
ExecStartPre=-/usr/bin/pulseaudio --start --exit-idle-time=-1
ExecStart=/usr/bin/node agent.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

# Keep the user's services running without anyone logged in, and after reboots.
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable almaed-recorder > /dev/null
echo "Installed. Next: sign the recorder Gmail in with login.sh, then: systemctl --user start almaed-recorder"
