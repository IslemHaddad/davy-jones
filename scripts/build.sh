#!/usr/bin/env bash
# Builds the whole app into a single production binary:
#   npm run build  -> backend/web/dist  (embedded into the Go binary)
#   go build       -> bin/davy-jones
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Installing frontend dependencies"
npm ci

echo "==> Building frontend (-> backend/web/dist)"
npm run build

echo "==> Building Go binary (-> bin/davy-jones)"
mkdir -p bin
(cd backend && go build -o "$ROOT_DIR/bin/davy-jones" .)

echo "==> Done: bin/davy-jones"
