import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("understand, edit, replay, and explain a real disagreement", async ({
  page,
  context,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 }).last()).toContainText(
    /strategy/i,
  );
  await expect(page.locator("#overview")).toContainText(
    "historical market data",
  );
  await expect(page.getByText("The problem", { exact: true })).toBeVisible();
  await expect(page.getByText("The solution", { exact: true })).toBeVisible();
  await expect(page.getByTestId("changed-count")).toHaveText("24");
  await expect(page.getByText("22", { exact: true })).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toBeVisible();
  await expect(page.locator(".data-note")).toBeVisible();
  await expect(page.locator(".data-note")).toContainText(/132\s+candles/);
  await expect(page.getByLabel("Show signals")).toHaveValue("Off");
  await expect(page.getByLabel("RSI period").first()).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("studio.png"),
    fullPage: true,
  });

  const updated = page
    .getByRole("group", { name: "Updated strategy", exact: true })
    .first();
  await updated.getByLabel("BUY threshold").fill("30");
  await expect(
    page.getByText("Settings changed. Run comparison to see updated results."),
  ).toBeVisible();
  await expect(page.getByTestId("changed-count")).toHaveText("24");
  let response = page.waitForResponse(
    (r) => r.url().endsWith("/api/compare") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  expect((await (await response).json()).report.changedDecisions).toBe(0);
  await expect(page.getByTestId("changed-count")).toHaveText("0");
  await expect(
    page.getByRole("heading", { name: "No decisions changed." }),
  ).toBeVisible();
  await expect(page.locator(".row-button")).toHaveCount(0);

  await updated.getByLabel("BUY threshold").fill("25");
  response = page.waitForResponse(
    (r) => r.url().endsWith("/api/compare") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const comparison = await (await response).json();
  expect(comparison.report.changedDecisions).toBe(24);
  await expect(page.getByTestId("changed-count")).toHaveText("24");
  await expect(page.locator(".row-button")).toHaveCount(
    comparison.report.diffs.length,
  );
  await expect(
    page.getByText("Settings changed. Run comparison to see updated results."),
  ).not.toBeVisible();

  const first = comparison.report.diffs[0];
  const time = first.timestampUtc.slice(0, 16).replace("T", " ");
  await page.locator(".row-button").first().click();
  const selection = page.getByLabel("Selected decision");
  await expect(selection).toBeVisible();
  await expect(selection).toContainText(
    `${first.baseline.diagnostics.previousRsi.toFixed(2)} to ${first.baseline.diagnostics.rsi.toFixed(2)}`,
  );
  await expect(selection).toContainText("BUY threshold of 30");
  await expect(page.getByTestId("chart-selected-time")).toHaveText(
    `${time} UTC`,
  );
  await expect
    .poll(async () =>
      Number(
        await page.getByTestId("price-chart").getAttribute("data-visible-bars"),
      ),
    )
    .toBeLessThan(60);
  await page.screenshot({
    path: testInfo.outputPath("selected-decision.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Show full history" }).click();
  await expect
    .poll(async () =>
      Number(
        await page.getByTestId("price-chart").getAttribute("data-visible-bars"),
      ),
    )
    .toBeGreaterThan(1800);
  await page.getByLabel("Changed decision types").selectOption("HOLD → BUY");
  await expect(page.locator(".row-button")).toHaveCount(
    comparison.report.diffs.filter(
      (d: { baseline: { signal: string }; candidate: { signal: string } }) =>
        d.baseline.signal === "HOLD" && d.candidate.signal === "BUY",
    ).length,
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const download = await downloadPromise;
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(data).toEqual(comparison);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("details.cli > summary").click();
  await page.getByRole("button", { name: "Copy command" }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "--max-changed-decisions 0",
  );
  expect(browserErrors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("advanced settings, stale downloads and recovery remain usable", async ({
  page,
}) => {
  await page.route("**/api/demo", (route) => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("alert").filter({ hasText: "could not load" }),
  ).toBeVisible();
  await page.unroute("**/api/demo");
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByTestId("changed-count")).toHaveText("24");
  await page.getByText("Advanced strategy settings", { exact: true }).click();
  const settings = page.locator(".advanced-fields").last();
  await settings.getByLabel("RSI period").fill("20");
  await settings.getByLabel("Price field").selectOption("markClose");
  await expect(
    page.getByText("Settings changed. Run comparison to see updated results."),
  ).toBeVisible();
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/compare") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const result = await (await responsePromise).json();
  await expect(page.getByTestId("changed-count")).toHaveText(
    String(result.report.changedDecisions),
  );
  await page.locator(".row-button").first().click();
  await expect(page.getByLabel("Selected decision")).toContainText(
    "RSI(20) using mark close",
  );
  await page
    .getByRole("button", { name: "Make both strategies identical" })
    .click();
  await expect(
    page.getByText("Settings changed. Run comparison to see updated results."),
  ).toBeVisible();
  const staleDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const staleDownload = await staleDownloadPromise;
  expect(
    JSON.parse(await readFile((await staleDownload.path())!, "utf8")),
  ).toEqual(result);
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(page.getByTestId("changed-count")).toHaveText("0");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(page.getByTestId("changed-count")).toHaveText("24");
});
