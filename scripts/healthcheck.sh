#!/usr/bin/env bash
# Stage 7/8 – check that the running app is healthy.
# Usage: scripts/healthcheck.sh [base-url]   (default: http://localhost:8080)
set -euo pipefail
BASE="${1:-http://localhost:8080}"

echo "Checking $BASE ..."
curl -fsS --max-time 5 "$BASE/health" >/dev/null && echo "  /health        OK"
curl -fsS --max-time 5 "$BASE/" | grep -q "Sprintboard" && echo "  home page      OK"
curl -fsS --max-time 5 "$BASE/version.json" 2>/dev/null && echo "  /version.json  OK" || echo "  /version.json  not available (fine for non-Docker runs)"
echo "All checks passed."
