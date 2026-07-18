#!/usr/bin/env node
import { runMcpServer } from "./server.js";

export { createDevTentMcpServer, runMcpServer } from "./server.js";
export {
  createMcpContext,
  matchSiteFromPath,
  resolveDevTentRoot,
  resolveSitePath,
  pathsEqual,
  isPathInside,
  normalizeFsPath,
} from "./context.js";
export {
  validateServiceAction,
  validateSslAction,
  validateIsolateAction,
} from "./handlers.js";

async function main(): Promise<void> {
  await runMcpServer();
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("index.ts") ||
    process.argv[1].includes("@devtent/mcp") ||
    process.argv[1].includes("packages/mcp") ||
    process.argv[1].includes("packages\\mcp"));

if (isDirect) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
