import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { syntheticFixture } from "../helpers/synthetic-fixture.js";
import { createSnapshot, runWorkspace } from "../../src/index.js";
const exec = promisify(execFile);
async function cli(args: string[]) {
  try {
    return {
      code: 0,
      ...(await exec(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", ...args],
        { maxBuffer: 4_000_000 },
      )),
    };
  } catch (error) {
    return error as { code: number; stdout: string; stderr: string };
  }
}
it("discovers built-ins, imports snapshots, runs trusted TS examples, replays manifests and uses regression exit codes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phoenix-workspace-"));
  try {
    const fixture = syntheticFixture(
      Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 10),
    );
    const snapshot = createSnapshot(
      fixture,
      "historical",
      fixture.bars[25]!.time,
      fixture.meta.requestedToMs,
      25,
    );
    const data = join(dir, "snapshot.json");
    const manifest = join(dir, "manifest.json");
    await writeFile(data, JSON.stringify(snapshot));
    expect(JSON.parse((await cli(["strategies"])).stdout)).toHaveLength(3);
    const baseline = {
      id: "ema-cross",
      params: { fastPeriod: 3, slowPeriod: 8 },
    };
    const expected = runWorkspace({
      snapshot,
      baseline,
      candidate: baseline,
      assertions: { exactEquivalence: true },
    });
    await writeFile(manifest, JSON.stringify(expected.manifest));
    const replayed = await cli(["workspace", "--manifest", manifest]);
    expect(replayed.code).toBe(0);
    expect(JSON.parse(replayed.stdout).reportId).toBe(expected.reportId);
    const single = await cli([
      "replay",
      "--data",
      data,
      "--strategy",
      "examples/custom-ema-strategy.ts",
      "--format",
      "json",
    ]);
    expect(single.code).toBe(0);
    const replay = JSON.parse(single.stdout);
    expect(replay.totalDecisions).toBe(55);
    expect(replay.strategies[0].id).toBe("custom-ema");
    expect(replay.strategies[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      replay.decisions.every(
        (d: {
          availableAtMs: number;
          diagnostics: { availableAtMs: number };
        }) => d.availableAtMs === d.diagnostics.availableAtMs,
      ),
    ).toBe(true);
    const regression = await cli([
      "compare",
      "--data",
      data,
      "--baseline",
      "ema-cross",
      "--candidate",
      "examples/custom-ema-strategy.ts",
      "--format",
      "json",
      "--exact-equivalence",
    ]);
    expect(regression.code).toBe(1);
    expect(JSON.parse(regression.stdout).assertions.passed).toBe(false);
    const invalid = await cli([
      "compare",
      "--data",
      data,
      "--baseline",
      "ema-cross",
      "--candidate",
      "ema-cross",
      "--max-changed-percent",
      "101",
    ]);
    expect(invalid.code).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
