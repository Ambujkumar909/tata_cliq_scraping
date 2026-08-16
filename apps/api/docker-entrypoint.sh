#!/bin/sh
# PriceLens API entrypoint.
#
# Ajio's PDP tier needs a HEADED browser (headless is fingerprinted and
# refused), so when AJIO_BROWSER_COOKIES=true we start a virtual display and
# run under it. Everything else about the container is unchanged, and a missing
# Xvfb is not fatal — the app degrades to "Ajio specs unavailable".
set -e

if [ "$AJIO_BROWSER_COOKIES" = "true" ] && command -v Xvfb >/dev/null 2>&1; then
  export DISPLAY="${DISPLAY:-:99}"
  Xvfb "$DISPLAY" -screen 0 1366x768x24 -nolisten tcp >/dev/null 2>&1 &
  # Give the server a moment to accept connections before Chrome asks.
  sleep 1
  echo "[entrypoint] virtual display ready on $DISPLAY"
elif [ "$AJIO_BROWSER_COOKIES" = "true" ]; then
  echo "[entrypoint] AJIO_BROWSER_COOKIES=true but Xvfb is missing —"
  echo "[entrypoint] rebuild with: docker compose build --build-arg WITH_BROWSER=true api"
fi

exec "$@"
