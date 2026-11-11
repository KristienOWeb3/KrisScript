#!/usr/bin/env bash
# Pull the latest main, rebuild, restart. Run on the VPS as the kris user.
set -euo pipefail
cd /home/kris/app
git pull --ff-only
npm ci
npm run build
sudo systemctl restart kris-script
sleep 3
systemctl --no-pager status kris-script | head -5
