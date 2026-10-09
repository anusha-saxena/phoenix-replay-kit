import { cp, mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "phoenix-studio-production-"));
let child;
try {
  await cp(new URL("../.next/standalone/", import.meta.url), temp, {
    recursive: true,
  });
  await cp(
    new URL("../.next/static/", import.meta.url),
    join(temp, "apps/web/.next/static"),
    { recursive: true },
  );

  await rm(join(temp, "data"), { recursive: true, force: true });
  await rm(join(temp, "src"), { recursive: true, force: true });
  child = spawn(process.execPath, [join(temp, "apps/web/server.js")], {
    cwd: temp,
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3081" },
    stdio: "pipe",
  });
  let log = "";
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const base = "http://127.0.0.1:3081";
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null)
      throw new Error(`Production server exited: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, `Production server did not start: ${log}`);
  const demo = await (await fetch(`${base}/api/demo`)).json();
  const canonical = JSON.parse(
    await readFile(
      new URL(
        "../../../data/fixtures/candles/sol-5m-1790869255065-1791474055065.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(demo.candles, canonical.bars);
  assert.equal(demo.meta.integrity.coverage.trailingMissingBars, 132);
  const baseline = {
    period: 14,
    buyThreshold: 30,
    sellThreshold: 70,
    priceField: "close",
  };
  const candidate = { ...baseline, buyThreshold: 25 };
  async function compare(configs) {
    const response = await fetch(`${base}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configs),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const result = await compare({ baseline, candidate });
  assert.equal(result.report.changedDecisions, 24);
  assert.equal(result.report.dataset.datasetId, demo.datasetId);
  assert.deepEqual(await compare({ baseline, candidate }), result);
  assert.equal(
    (await compare({ baseline, candidate: baseline })).report.changedDecisions,
    0,
  );

  async function workspace(action, body) {
    const response = await fetch(`${base}/api/workspace/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const snapshot = await workspace("dataset", { mode: "demo" });
  const selection = {
    id: "ema-cross",
    params: { fastPeriod: 9, slowPeriod: 21 },
  };
  const workspaceInput = {
    snapshot,
    baseline: selection,
    candidate: selection,
    assertions: { exactEquivalence: true },
  };
  const workspaceResult = await workspace("compare", workspaceInput);
  assert.equal(workspaceResult.report.changedDecisions, 0);
  assert.equal(workspaceResult.assertion.passed, true);
  assert.equal(
    (await workspace("export", workspaceInput)).reportId,
    workspaceResult.reportId,
  );
  assert.equal((await fetch(`${base}/workspace`)).status, 200);
  const templates = await (
    await fetch(`${base}/api/workspace/strategies`)
  ).json();
  assert.equal(templates.strategies.length, 3);
  const html = await (await fetch(base)).text();
  const asset =
    html.match(/src="([^"]+\/_next\/static\/[^"]+\.js)"/)?.[1] ??
    html.match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
  assert(asset, "No client JavaScript asset in production HTML");
  assert.equal((await fetch(new URL(asset, base))).status, 200);
  console.log(
    "Isolated standalone production: canonical OHLC, 132 warning, default 24, identical 0, deterministic responses client assets and workspace snapshot replay/export passed.",
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(temp, { recursive: true, force: true });
}
