import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Strategy, StrategyFactory } from "../strategy/types.js";

// helper to load a strategy file dynamically
export async function loadStrategyModule(
  filePath: string,
): Promise<StrategyFactory> {
  const path = resolve(filePath);

  try {
    // check file extension for typescript
    const extension = extname(path);
    const typescript = [".ts", ".mts", ".cts"].includes(extension);

    if (typescript && import.meta.url.endsWith(".js")) {
      throw new Error(
        "Built CLI supports .js/.mjs strategies. Compile your strategy or use node --import tsx src/cli.ts for TypeScript development.",
      );
    }

    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      throw new Error("Path is not a file");
    }

    const fileUrl = pathToFileURL(path).href;
    const module = (await import(fileUrl)) as {
      default?: unknown;
    };

    if (typeof module.default !== "function") {
      throw new Error("Module must default-export a strategy factory");
    }

    const factory = module.default as StrategyFactory;

    // generate hash from file content
    const fileBytes = await readFile(path);
    const hasher = createHash("sha256");
    hasher.update(fileBytes);
    const sourceHash = hasher.digest("hex");

    return () => {
      const strategy: Strategy = factory();

      // validation check on the returned strategy
      let validName = false;
      if (typeof strategy?.name === "string" && strategy.name.trim() !== "") {
        validName = true;
      }

      if (!strategy || !validName || typeof strategy.onEvent !== "function") {
        throw new Error(
          `Strategy ${path} must return { name, onEvent } synchronously`,
        );
      }

      let stratId = strategy.id;
      if (!stratId) {
        stratId = `local:${sourceHash}`;
      }

      let stratVersion = strategy.version;
      if (!stratVersion) {
        stratVersion = sourceHash;
      }

      let initFn = undefined;
      if (strategy.initialize) {
        initFn = strategy.initialize.bind(strategy);
      }

      let finalizeFn = undefined;
      if (strategy.finalize) {
        finalizeFn = strategy.finalize.bind(strategy);
      }

      return {
        ...strategy,
        name: strategy.name,
        sourceHash: sourceHash,
        id: stratId,
        version: stratVersion,
        onEvent: strategy.onEvent.bind(strategy),
        ...(initFn ? { initialize: initFn } : {}),
        ...(finalizeFn ? { finalize: finalizeFn } : {}),
      };
    };
  } catch (error) {
    let msg = String(error);
    if (error instanceof Error) {
      msg = error.message;
    }
    throw new Error(`Cannot load strategy ${path}: ${msg}`);
  }
}