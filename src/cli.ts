#!/usr/bin/env node
import { validateSnapshot } from "./workspace/snapshot.js";
import { validateCandleFixture } from "./data/candle-loader.js";
import { evaluateSnapshot } from "./workspace/evaluate.js";
import { compareReplayResults } from "./compare/compare-replays.js";
import { workspaceCli } from "./cli/workspace.js";
import { strategyFactory, listStrategies } from "./strategy/registry.js";
import { ENGINE_VERSION, strategyIdentity } from "./workspace/evaluate.js";
import { datasetIdentity } from "./replay/timeline.js";
import { checkAssertions } from "./workspace/evaluate.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadCandleFixture } from "./data/candle-loader.js";
import { loadFundingFixture } from "./data/funding.js";
import { loadOrderbookFixture } from "./data/orderbook.js";
import {
  createFundingReplayEvents,
  createOrderbookReplayEvents,
} from "./replay/multi-source.js";
import { createCandleReplayEvents } from "./replay/timeline.js";
import { runReplay } from "./replay/runner.js";
import { compareStrategies } from "./compare/compare-replays.js";
import { HELP, parseCliOptions } from "./cli/options.js";
import { loadStrategyModule } from "./cli/load-strategy.js";
import {
  createInspectionReport,
  formatInspection,
  formatComparison,
  formatReplay,
  createBookInspectionReport,
  formatBookInspection,
} from "./cli/reports.js";

// main entry point for the cli script
async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // handle help flag
  if (args.length === 0 || args[0] === "--help" || args[1] === "--help") {
    console.log(HELP);
    return 0;
  }

  // check version
  if (args.length === 1 && args[0] === "--version") {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const fileContent = await readFile(pkgUrl, "utf8");
    const pkg = JSON.parse(fileContent) as {
      version: string;
    };
    console.log(pkg.version);
    return 0;
  }

  // pass to workspace router if matches commands
  const workspaceCmds = ["workspace", "fetch", "strategies", "capabilities"];
  if (workspaceCmds.includes(args[0]!)) {
    return workspaceCli(args);
  }

  // helper to get strategy instance
  async function loadStrategy(value: string) {
    const registry = listStrategies();
    let found = false;
    for (let i = 0; i < registry.length; i++) {
      if (registry[i]!.id === value) {
        found = true;
        break;
      }
    }

    if (found) {
      return strategyFactory({ id: value });
    } else {
      return loadStrategyModule(value);
    }
  }

  const options = parseCliOptions(args);

  // load raw input if dealing with candles
  let rawInput: unknown = null;
  if (options.dataKind === "candles") {
    try {
      const dataStr = await readFile(options.data, "utf8");
      rawInput = JSON.parse(dataStr);
    } catch (error) {
      let msg = String(error);
      if (error instanceof Error) {
        msg = error.message;
      }
      throw new Error(`Cannot load candle fixture ${options.data}: ${msg}`);
    }
  }

  // check if it is a saved snapshot
  let savedSnapshot = null;
  if (rawInput && typeof rawInput === "object" && "fixture" in rawInput) {
    savedSnapshot = validateSnapshot(rawInput);
  }

  const candleInput = () => {
    if (savedSnapshot) {
      return Promise.resolve(validateCandleFixture(savedSnapshot.fixture));
    }
    return loadCandleFixture(options.data);
  };

  if (savedSnapshot && options.funding) {
    throw new Error("Snapshot replay cannot merge additional funding data");
  }

  let funding = null;
  if (options.funding) {
    funding = await loadFundingFixture(options.funding);
  }

  let report: object;
  let text: string;
  let exitCode = 0;
  let strategies: ReturnType<typeof strategyIdentity>[] = [];
  let evaluation: ReturnType<typeof evaluateSnapshot>["evaluation"] | null = null;

  // inspect command branch
  if (options.command === "inspect") {
    if (options.dataKind === "orderbook") {
      const fixture = await loadOrderbookFixture(options.data, options.symbol);
      const inspection = createBookInspectionReport(fixture);
      report = inspection;
      text = formatBookInspection(inspection, options.data);
    } else {
      const fixture = await candleInput();
      const inspection = createInspectionReport(fixture);
      report = inspection;
      text = formatInspection(inspection, options.data);

      if (funding) {
        if (funding.meta.symbol !== fixture.meta.symbol) {
          throw new Error("Candle/funding symbol mismatch");
        }
        const warning = `Assumption-based funding: ${funding.meta.recordCount} records; timestamp + ${funding.meta.availability.lagMs}ms lag. Units interpreted from field name; publication time and coverage unknown.`;
        report = {
          ...inspection,
          funding: funding.meta,
          warnings: [...inspection.warnings, warning],
        };
        text = text + `\nWARNING: ${warning}`;
      }
    }
  } else {
    // create events for replay or compare
    let events;
    if (options.dataKind === "orderbook") {
      const bookFix = await loadOrderbookFixture(options.data, options.symbol);
      events = createOrderbookReplayEvents(bookFix);
    } else if (funding) {
      const candleFix = await candleInput();
      events = createFundingReplayEvents(candleFix, funding);
    } else {
      const candleFix = await candleInput();
      events = createCandleReplayEvents(candleFix);
    }

    if (options.command === "replay") {
      const strategy = await loadStrategy(options.strategy!);
      let evaluated = null;
      if (savedSnapshot) {
        evaluated = evaluateSnapshot(savedSnapshot, [strategy]);
      }

      let result;
      if (evaluated) {
        result = evaluated.results[0]!;
      } else {
        result = runReplay({ events: events, strategy: strategy });
      }

      strategies = [strategyIdentity(strategy())];
      if (evaluated) {
        evaluation = evaluated.evaluation;
      } else {
        evaluation = null;
      }

      report = {
        schemaVersion: 1,
        ...result,
      };
      text = formatReplay(result, options.data, options.maxRows);
    } else {
      // compare command
      const baseline = await loadStrategy(options.baseline!);
      const candidate = await loadStrategy(options.candidate!);

      let evaluated = null;
      if (savedSnapshot) {
        evaluated = evaluateSnapshot(savedSnapshot, [baseline, candidate]);
      }

      let comparison;
      if (evaluated) {
        comparison = compareReplayResults(
          evaluated.results[0]!,
          evaluated.results[1]!,
        );
      } else {
        comparison = compareStrategies({
          events: events,
          baseline: baseline,
          candidate: candidate,
        });
      }

      strategies = [
        strategyIdentity(baseline()),
        strategyIdentity(candidate()),
      ];
      if (evaluated) {
        evaluation = evaluated.evaluation;
      } else {
        evaluation = null;
      }

      report = comparison;
      text = formatComparison(comparison, options.data, options.maxRows);

      // check if any assertions were provided
      const assertionKeys = Object.keys(options.assertions);
      if (assertionKeys.length > 0) {
        const assertions = checkAssertions(comparison, options.assertions);
        if (assertions.passed) {
          exitCode = 0;
        } else {
          exitCode = 1;
        }
        text =
          text +
          `\nRegression assertions: ${assertions.passed ? "PASS" : "FAIL"} ${assertions.failures.join(", ")}`;
        report = {
          ...comparison,
          assertions: assertions,
        };
      }

      if (options.maxChangedDecisions !== undefined) {
        const passed =
          comparison.changedDecisions <= options.maxChangedDecisions;
        const assertion = {
          maximum: options.maxChangedDecisions,
          changedDecisions: comparison.changedDecisions,
          passed: passed,
        };
        report = {
          ...report,
          assertion: assertion,
        };

        const passStr = passed ? "PASS" : "FAIL";
        text =
          text +
          `\n\nRegression assertion: ${passStr} (${comparison.changedDecisions} changes; maximum ${options.maxChangedDecisions})`;
        if (!passed) {
          exitCode = 1;
        }
      }
    }
  }

  // append metadata to report if not inspect
  if (options.command !== "inspect") {
    let snapId = null;
    if (savedSnapshot) {
      snapId = savedSnapshot.id;
    }

    const content = {
      ...report,
      engineVersion: ENGINE_VERSION,
      strategies: strategies,
      evaluation: evaluation,
      snapshotId: snapId,
    };
    report = {
      ...content,
      reportId: datasetIdentity(content),
    };
  }

  let output = "";
  if (options.format === "json") {
    output = JSON.stringify(report, null, 2);
  } else {
    output = text;
  }

  // write output to file if requested
  if (options.out) {
    const outDir = dirname(options.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(options.out, output + "\n", { flag: "wx" });
  }

  console.log(output);

  return exitCode;
}

// run main
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    let errMessage = String(error);
    if (error instanceof Error) {
      errMessage = error.message;
    }
    console.error(`Error: ${errMessage}`);
    process.exitCode = 2;
  });