import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const exec = promisify(execFile);
const fixture = resolve(
  "data/fixtures/candles/sol-5m-1790869255065-1791474055065.json",
);
let temp: string;
let packageRoot: string;

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "phoenix-package-"));
  await exec(process.execPath, ["scripts/build.mjs"]);
  const packed = await exec("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    temp,
    "--cache",
    join(temp, "cache"),
  ]);
  const info = JSON.parse(packed.stdout)[0] as {
    filename: string;
    files: { path: string }[];
  };
  expect(info.files.some((file) => file.path === "dist/src/cli.js")).toBe(true);
  expect(info.files.some((file) => file.path === "dist/src/index.d.ts")).toBe(
    true,
  );
  expect(
    info.files.some(
      (file) =>
        /^(data|tests|reports|node_modules)\//.test(file.path) ||
        file.path.includes(".env"),
    ),
  ).toBe(false);
  await exec("tar", ["-xzf", join(temp, info.filename), "-C", temp]);
  packageRoot = join(temp, "package");

  await mkdir(join(temp, "node_modules"), { recursive: true });
  for (const dependency of ["zod", "@ellipsis-labs"])
    await symlink(
      resolve("node_modules", dependency),
      join(temp, "node_modules", dependency),
    );

  await mkdir(join(temp, "node_modules", ".bin"), { recursive: true });
  await symlink(
    join(packageRoot, "dist/src/cli.js"),
    join(temp, "node_modules/.bin/phoenix-replay"),
  );
}, 30000);
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function cli(args: string[]) {
  try {
    const result = await exec(
      join(temp, "node_modules/.bin/phoenix-replay"),
      args,
      { cwd: temp, maxBuffer: 2 * 1024 * 1024 },
    );
    return { code: 0, ...result };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
}

describe("built and packed distribution", () => {
  it("has an executable bin, help, version and inspect outside the repository", async () => {
    const pkg = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    expect(pkg.bin["phoenix-replay"]).toBe("dist/src/cli.js");
    expect((await cli(["--help"])).code).toBe(0);
    expect((await cli(["--version"])).stdout.trim()).toBe(pkg.version);
    const result = await cli(["inspect", "--data", fixture]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Finalized bars: 1,883");
  });

  it("runs packaged JS strategies for replay and comparison", async () => {
    const baseline = join(packageRoot, "dist/strategies/rsi-v1.js");
    const candidate = join(packageRoot, "dist/strategies/rsi-v2.js");
    const replay = await cli([
      "replay",
      "--data",
      fixture,
      "--strategy",
      baseline,
      "--format",
      "json",
    ]);
    expect(replay.code).toBe(0);
    expect(JSON.parse(replay.stdout).counts).toEqual({
      BUY: 22,
      SELL: 23,
      HOLD: 1838,
    });
    const compare = await cli([
      "compare",
      "--data",
      fixture,
      "--baseline",
      baseline,
      "--candidate",
      candidate,
      "--format",
      "json",
    ]);
    expect(compare.code).toBe(0);
    expect(JSON.parse(compare.stdout).changedDecisions).toBe(24);
    const assertion = await cli([
      "compare",
      "--data",
      fixture,
      "--baseline",
      baseline,
      "--candidate",
      baseline,
      "--max-changed-decisions",
      "0",
    ]);
    expect(assertion.code).toBe(0);
  });

  it("loads custom .mjs modules with spaces and explains the .ts restriction", async () => {
    const module = join(temp, "my strategy.mjs");
    await writeFile(
      module,
      'export default () => ({ name: "custom hold", onEvent: () => ({ signal: "HOLD" }) });',
    );
    const result = await cli([
      "replay",
      "--data",
      fixture,
      "--strategy",
      "my strategy.mjs",
      "--format",
      "json",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).counts.HOLD).toBe(1883);
    const ts = join(temp, "strategy.ts");
    await writeFile(
      ts,
      'export default () => ({ name: "typed", onEvent: () => ({ signal: "HOLD" }) });',
    );
    const rejected = await cli(["replay", "--data", fixture, "--strategy", ts]);
    expect(rejected.code).toBe(2);
    expect(rejected.stderr).toContain("Built CLI supports .js/.mjs");
  });

  it("runs funding and sampled books through the packaged CLI", async () => {
    const funding = await cli([
      "compare",
      "--data",
      fixture,
      "--funding",
      resolve("data/fixtures/funding/sol-funding-assumed-1h.json"),
      "--baseline",
      join(packageRoot, "dist/strategies/rsi-v1.js"),
      "--candidate",
      join(packageRoot, "dist/strategies/rsi-funding-filter.js"),
      "--format",
      "json",
    ]);
    expect(funding.code).toBe(0);
    const report = JSON.parse(funding.stdout);
    expect(report).toMatchObject({
      inputEvents: 2039,
      changedDecisions: 2,
      eventCounts: { candle_closed: 1883, funding_rate: 156 },
    });
    expect(
      report.warnings.some((warning: string) =>
        warning.includes("Assumption-based"),
      ),
    ).toBe(true);
    const book = await cli([
      "compare",
      "--data",
      resolve("data/fixtures/orderbook/sol-sampled-book.json"),
      "--data-kind",
      "orderbook",
      "--baseline",
      join(packageRoot, "dist/strategies/book-v1.js"),
      "--candidate",
      join(packageRoot, "dist/strategies/book-v2.js"),
      "--format",
      "json",
    ]);
    expect(book.code).toBe(0);
    expect(JSON.parse(book.stdout)).toMatchObject({
      inputEvents: 60,
      changedDecisions: 0,
    });
  });
});
