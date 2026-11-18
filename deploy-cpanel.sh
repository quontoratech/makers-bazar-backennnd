#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${HOME}/apps/makers-bazar/backend"
NODE_ENV_FILE="${HOME}/nodevenv/apps/makers-bazar/backend/22/bin/activate"

cd "${APP_ROOT}"
git pull --ff-only origin main

if [[ -f "${NODE_ENV_FILE}" ]]; then
  # Use cPanel's selected Node.js binaries without sourcing CloudLinux's interactive-only activation script.
  export PATH="$(dirname "${NODE_ENV_FILE}"):${PATH}"
fi

npm install
npm run build
mkdir -p tmp
touch tmp/restart.txt

curl --fail --silent --show-error https://api.themakersbazar.com/health
printf '\nBackend deployment completed.\n'
