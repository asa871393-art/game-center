#!/usr/bin/env bash
#
# Builds the committed HEAD in a Linux container and deploys it to Netlify production
# (https://game-center-lounge.netlify.app).
#
#   bash scripts/deploy-netlify.sh
#
# The build runs in Docker because @netlify/plugin-nextjs fails to bundle the edge middleware on
# Windows paths. The container clones the repo, so only committed code ships: uncommitted changes
# and the gitignored .env (which may point at the local emulator) never leave this machine.
# Production reads its env vars from the Netlify site settings.
#
# Needs Docker running and a `netlify login` token in %APPDATA%/netlify/Config/config.json.
set -euo pipefail

SITE_ID="f8784cef-07b4-44fd-bbd8-36f069370a20"
NODE_IMAGE="node:24.15.0-bookworm"
NETLIFY_CLI="netlify-cli@23.15.1"

# Docker on Windows needs a C:/... path for the bind mount; `pwd -W` gives one in Git Bash.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && (pwd -W 2>/dev/null || pwd))"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Note: uncommitted changes are not deployed; deploying HEAD $(git -C "$ROOT" rev-parse --short HEAD)."
fi

NETLIFY_AUTH_TOKEN="$(node -e "const c=require(process.env.APPDATA+'/netlify/Config/config.json');const u=Object.values(c.users||{})[0];if(!u||!u.auth||!u.auth.token){process.exit(1)}process.stdout.write(u.auth.token)")" \
  || { echo "No Netlify token found; run 'npx netlify-cli login' first." >&2; exit 1; }
export NETLIFY_AUTH_TOKEN

MSG="$(git -C "$ROOT" log -1 --format=%s)"
export MSG

MSYS_NO_PATHCONV=1 docker run --rm \
  -e NETLIFY_AUTH_TOKEN \
  -e NETLIFY_SITE_ID="$SITE_ID" \
  -e MSG \
  -v "$ROOT:/src:ro" \
  "$NODE_IMAGE" \
  bash -c "git config --global --add safe.directory '*' \
    && git clone -q /src /app \
    && cd /app \
    && npm ci --no-audit --no-fund \
    && npx -y $NETLIFY_CLI deploy --prod --message \"\$MSG\""
