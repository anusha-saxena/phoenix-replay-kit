import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

test("workspace replays EMA, compares templates, inspects diagnostics and exports a reproducible manifest", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/workspace/capabilities", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: {
          code: "UPSTREAM",
          message: "Offline test: market discovery unavailable",
        },
      },
    }),
  );
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Build, replay",
  );
  await expect(page.getByLabel("Strategy template")).toHaveValue("ema-cross");
  await page.getByRole("button", { name: "Load Demo dataset" }).click();
  await expect(page.getByText("Snapshot ready")).toContainText("SOL");
  await expect(
    page.getByText("132 trailing candles missing", { exact: false }),
  ).toBeVisible();
  const first = page.waitForResponse(
    (r) =>
      r.url().endsWith("/workspace/replay") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run replay", exact: true }).click();
  const result = await (await first).json();
  await expect(
    page.getByRole("region", { name: "Workspace results" }),
  ).toContainText(`${result.report.totalDecisions} decisions replayed`);
  await page.getByLabel("Compare original and updated strategies").check();
  await expect(page.getByText("Settings changed. Results")).toBeVisible();
  const compared = page.waitForResponse((r) =>
    r.url().endsWith("/workspace/compare"),
  );
  await page
    .getByRole("button", { name: "Compare strategies", exact: true })
    .click();
  const comparison = await (await compared).json();
  expect(comparison.report.changedDecisions).toBeGreaterThan(0);
  await expect(
    page.getByRole("region", { name: "Workspace results" }),
  ).toContainText(`${comparison.report.changedDecisions} changed decisions`);
  await page.locator(".workspace-timeline tbody button").first().click();
  await expect(
    page.getByRole("heading", { name: /Selected candle/ }),
  ).toBeVisible();
  await expect(page.locator(".workspace-dataset").last()).toContainText(
    "previousSpread",
  );
  await expect(page.getByTestId("workspace-chart")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download replay manifest" }).click();
  const file = await downloaded;
  const manifest = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(manifest.snapshot.id).toBe(comparison.snapshot.id);
  expect(manifest.baseline.id).toBe("ema-cross");

  const replay = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "workspace",
      "--manifest",
      (await file.path())!,
    ],
    { cwd: resolve("../.."), maxBuffer: 8_000_000 },
  );
  expect(JSON.parse(replay.stdout).reportId).toBe(comparison.reportId);
  await page
    .getByRole("button", { name: "Show full history", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("workspace.png"),
    fullPage: true,
  });
});
test("safe rule builder runs through the backend and reports unavailable market data without fallback", async ({
  page,
}) => {
  await page.route("**/api/workspace/capabilities", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: {
          code: "UPSTREAM",
          message: "Offline test: market discovery unavailable",
        },
      },
    }),
  );
  await page.goto("/workspace");
  await page.getByLabel("Strategy template").selectOption("declarative");
  await expect(page.getByText("First match wins")).toBeVisible();
  await page.getByText("Advanced JSON rules", { exact: false }).click();
  await page
    .getByLabel("Strategy declarative JSON")
    .fill('{"name":"unsafe","rules":[],"code":"process.exit()"}');
  await page.getByRole("button", { name: "Apply JSON", exact: true }).click();
  await expect(
    page.locator(".workspace-strategy").getByRole("alert"),
  ).toContainText("rules");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Load Demo dataset" }).click();
  const replay = page.waitForResponse((r) =>
    r.url().endsWith("/workspace/replay"),
  );
  await page.getByRole("button", { name: "Run replay", exact: true }).click();
  const result = await (await replay).json();
  expect(result.strategies[0].id).toBe("declarative");
  expect(result.report.counts.BUY).toBeGreaterThan(0);
  await page.getByLabel("Dataset mode").selectOption("historical");
  await expect(
    page.getByText("Offline test: market discovery unavailable"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fetch market data" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run replay", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Data settings changed. Fetch")).toBeVisible();
});

test("real SDK historical and latest snapshots run through the complete workspace", async ({
  page,
}) => {
  test.skip(
    !process.env.PHOENIX_NETWORK_CHECK,
    "Explicit network integration; offline CI does not call Phoenix",
  );
  test.setTimeout(90000);
  await page.goto("/workspace");
  await page.getByLabel("Dataset mode").selectOption("historical");
  await expect(page.getByLabel("Phoenix market")).toBeEnabled({
    timeout: 15000,
  });
  await page.getByLabel("Phoenix market").selectOption("SOL");
  await page.getByRole("button", { name: "Last 2 hours", exact: true }).click();
  const historical = page.waitForResponse(
    (r) => r.url().endsWith("/workspace/dataset"),
    { timeout: 30000 },
  );
  await page
    .getByRole("button", { name: "Fetch market data", exact: true })
    .click();
  const historicalResponse = await historical;
  expect(historicalResponse.status()).toBe(200);
  const snapshot = await historicalResponse.json();
  expect(snapshot.mode).toBe("historical");
  expect(snapshot.fixture.meta.sdkVersion).toBe("0.5.38");
  expect(snapshot.fixture.bars.length).toBeGreaterThan(21);
  const replay = page.waitForResponse((r) =>
    r.url().endsWith("/workspace/replay"),
  );
  await page.getByRole("button", { name: "Run replay", exact: true }).click();
  const result = await (await replay).json();
  expect(result.snapshot.id).toBe(snapshot.id);
  expect(result.evaluation.evaluationEvents).toBeGreaterThan(0);
  await page.getByLabel("Compare original and updated strategies").check();
  const compare = page.waitForResponse((r) =>
    r.url().endsWith("/workspace/compare"),
  );
  await page
    .getByRole("button", { name: "Compare strategies", exact: true })
    .click();
  const compared = await (await compare).json();
  expect(compared.snapshot.id).toBe(snapshot.id);
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download replay manifest", exact: true })
    .click();
  const file = await exported;
  const offline = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "workspace",
      "--manifest",
      (await file.path())!,
    ],
    { cwd: resolve("../.."), maxBuffer: 8_000_000 },
  );
  expect(JSON.parse(offline.stdout).reportId).toBe(compared.reportId);
  await page.getByLabel("Dataset mode").selectOption("latest");
  const latest = page.waitForResponse(
    (r) => r.url().endsWith("/workspace/dataset"),
    { timeout: 30000 },
  );
  await page
    .getByRole("button", { name: "Fetch market data", exact: true })
    .click();
  const freshResponse = await latest;
  expect(freshResponse.status()).toBe(200);
  const fresh = await freshResponse.json();
  expect(fresh.mode).toBe("latest");
  expect(fresh.id).not.toBe(snapshot.id);
  const freshReplay = page.waitForResponse((r) =>
    r.url().endsWith("/workspace/compare"),
  );
  await page
    .getByRole("button", { name: "Compare strategies", exact: true })
    .click();
  const freshResult = await (await freshReplay).json();
  expect(freshResult.snapshot.id).toBe(fresh.id);
  expect(freshResult.evaluation.evaluationEvents).toBeGreaterThan(0);
});
