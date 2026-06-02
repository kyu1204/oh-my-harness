import { createRequire } from "node:module";

// Resolve the installed oh-my-harness version once. Both src (via tsx) and the
// compiled dist sit two levels under the package root next to package.json.
const require = createRequire(import.meta.url);
export const OMH_VERSION = (require("../../package.json") as { version: string }).version;
