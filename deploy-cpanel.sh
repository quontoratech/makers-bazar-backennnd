#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${HOME}/apps/makers-bazar/backend"
NODE_BIN_DIR="${CPANEL_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin}"

cd "${APP_ROOT}"
git pull --ff-only origin main

if [[ -x "${NODE_BIN_DIR}/node" && -x "${NODE_BIN_DIR}/npm" ]]; then
  # Bypass CloudLinux's interactive wrapper while retaining the Node.js 22 selected in cPanel.
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi

npm install
npm run build
mkdir -p tmp
touch tmp/restart.txt

curl --fail --silent --show-error https://api.themakersbazar.com/health
printf '\nBackend deployment completed.\n'
