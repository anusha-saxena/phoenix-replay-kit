import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";
const serverRoot = new URL("../.next/standalone/apps/web/", import.meta.url);
await cp(
  new URL("../.next/static/", import.meta.url),
  new URL(".next/static/", serverRoot),
  { recursive: true },
);
const child = spawn(
  process.execPath,
  [new URL("server.js", serverRoot).pathname],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
