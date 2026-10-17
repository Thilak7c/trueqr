// Copy @trueqr/core sources into Guardian (Studio builds guardian/ as its own workspace). Never hand-edit the copy.
// Usage (any shell): node scripts/sync-core.mjs
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dest = `${root}guardian/app/agent/src/core`;
rmSync(dest, { recursive: true, force: true });
cpSync(`${root}packages/core/src`, dest, { recursive: true });
console.log("synced packages/core/src -> guardian/app/agent/src/core");
