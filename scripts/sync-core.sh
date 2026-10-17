#!/usr/bin/env bash
# Copy @trueqr/core sources into Guardian (Studio builds guardian/ as its own workspace). Never hand-edit the copy.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf guardian/app/agent/src/core && cp -r packages/core/src guardian/app/agent/src/core
