import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { listStrategies } from "../strategy/registry.js";
import { runWorkspace } from "../workspace/evaluate.js";
import {
  snapshotCollector,
  discoverCapabilities,
} from "../workspace/phoenix-data.js";

// handles workspace subcommands
export async function workspaceCli(args: string[]): Promise<number> {
  const command = args[0];

  // handle quick info commands
  if (command === "strategies" || command === "capabilities") {
    if (args.length !== 1) {
      throw new Error(`${command} takes no flags`);
    }

    let payload;
    if (command === "strategies") {
      payload = listStrategies();
    } else {
      payload = await discoverCapabilities();
    }

    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  // configure flags depending on whether we fetch or run workspace
  let cliOptions: Record<string, { type: "string" }>;
  if (command === "fetch") {
    cliOptions = {
      request: { type: "string" },
      out: { type: "string" },
    };
  } else {
    cliOptions = {
      manifest: { type: "string" },
      out: { type: "string" },
    };
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: cliOptions,
    tokens: true,
  });

  const values = parsed.values;
  const tokens = parsed.tokens;

  // check for duplicate flags passed in
  const names: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "option") {
      names.push(t.name);
    }
  }

  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) {
    throw new Error("Duplicate options");
  }

  let path: string | undefined;
  if (command === "fetch") {
    path = values.request;
  } else {
    path = values.manifest;
  }

  if (typeof path !== "string" || !path) {
    if (command === "fetch") {
      throw new Error("Use fetch --request request.json --out snapshot.json");
    } else {
      throw new Error("Use workspace --manifest manifest.json [--out report.json]");
    }
  }

  const fileRaw = await readFile(path, "utf8");
  const input: unknown = JSON.parse(fileRaw);

  // fetch branch
  if (command === "fetch") {
    if (!values.out) {
      throw new Error("Fetch requires --out");
    }

    const snapshot = await snapshotCollector.collect(input);
    const formattedSnapshot = JSON.stringify(snapshot, null, 2) + "\n";
    await writeFile(values.out, formattedSnapshot, { flag: "wx" });

    const logInfo = {
      snapshotId: snapshot.id,
      bars: snapshot.fixture.bars.length,
      path: values.out,
    };
    console.log(JSON.stringify(logInfo));
    return 0;
  }

  // schema check for workspace manifest
  const manifestSchema = z
    .object({
      schemaVersion: z.literal(1),
      snapshot: z.unknown(),
      baseline: z.unknown(),
      candidate: z.unknown().optional(),
      assertions: z.unknown().optional(),
    })
    .strict();

  const manifest = manifestSchema.parse(input);

  const request = {
    snapshot: manifest.snapshot,
    baseline: manifest.baseline,
    candidate: manifest.candidate,
    assertions: manifest.assertions,
  };

  const result = runWorkspace(request);
  const output = JSON.stringify(result, null, 2);

  if (values.out) {
    await writeFile(values.out, output + "\n", { flag: "wx" });
  }

  console.log(output);

  if (result.assertion?.passed === false) {
    return 1;
  }

  return 0;
}