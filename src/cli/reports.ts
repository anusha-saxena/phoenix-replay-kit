import { basename } from 'node:path';
import type { CandleFixture, Coverage } from '../data/types.js';
import type { OrderbookFixture } from '../data/orderbook.js';
import type { DeepReadonly } from '../replay/events.js';
import type { ReplayResult } from '../replay/runner.js';
import type { ComparisonResult } from '../compare/types.js';

const title = 'Strategy Replay Kit built on Phoenix Rise SDK\n─────────────────────────────────────────';

const number = (value: number) => value.toLocaleString('en-US');

const utc = (ms: number) => new Date(ms).toISOString();

const rowTime = (ms: number) => utc(ms).replace('T', ' ').replace('.000Z', '');

const oneLine = (text: string) => text.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, 110);

function coverageWarnings(coverage: DeepReadonly<Coverage> | undefined): string[] {
  const warnings: string[] = [];
  if (!coverage) return warnings;

  if (coverage.leadingMissingBars) {
    warnings.push(`WARNING: ${number(coverage.leadingMissingBars)} leading candles missing.`);
  }
  if (coverage.internalMissingBars) {
    warnings.push(`WARNING: ${number(coverage.internalMissingBars)} internal candles missing.`);
  }
  if (coverage.trailingMissingBars) {
    warnings.push(`WARNING: ${number(coverage.trailingMissingBars)} trailing candles missing.`);
  }

  return warnings;
}

export function createInspectionReport(fixture: CandleFixture) {
  const limitations = [
    'Availability uses nominal candle close; exact publication latency is unknown.',
  ];

  if (fixture.meta.legacyOriginalMeta) {
    limitations.push(
      'Legacy fixture adapted in memory; original file is unchanged. SDK version is unknown.',
    );
  }

  return {
    schemaVersion: 1 as const,
    metadata: fixture.meta,
    finalizedBars: fixture.bars.length,
    firstCandleStartMs: fixture.bars[0]!.time,
    lastCandleStartMs: fixture.bars.at(-1)!.time,
    firstAvailableAtMs: fixture.bars[0]!.time + fixture.meta.timeframeMs,
    lastAvailableAtMs: fixture.bars.at(-1)!.time + fixture.meta.timeframeMs,
    warnings: coverageWarnings(fixture.meta.integrity.coverage),
    limitations,
  };
}

export function formatInspection(
  report: ReturnType<typeof createInspectionReport>,
  path: string,
): string {
  const meta = report.metadata;

  return [
    title,
    `Market: ${meta.symbol}-PERP`,
    `Timeframe: ${meta.timeframe}`,
    `Dataset: ${basename(path)}`,
    `Source: ${meta.source} / ${meta.method}`,
    `API: ${meta.apiUrl}`,
    `Schema: ${meta.schemaVersion} (${meta.legacyOriginalMeta ? 'legacy adapter' : 'versioned'})`,
    `SDK: ${meta.sdkPackage} ${meta.sdkVersion}`,
    `Fetched at: ${utc(meta.fetchedAtMs)}`,
    `Requested: ${utc(meta.requestedFromMs)} → ${utc(meta.requestedToMs)}`,
    `Evaluation cutoff: ${utc(meta.evaluationCutoffMs)}`,
    `First/last candle start: ${utc(report.firstCandleStartMs)} → ${utc(report.lastCandleStartMs)}`,
    `Actual close coverage: ${utc(report.firstAvailableAtMs)} → ${utc(report.lastAvailableAtMs)}`,
    `Finalized bars: ${number(report.finalizedBars)}; pages: ${meta.pageCount}`,
    `Collection: ${meta.integrity.outOfOrder} out-of-order; ${meta.integrity.duplicatesRemoved} duplicates removed; ${meta.integrity.excludedNonFinal} non-final excluded; ${meta.integrity.excludedAfterCutoff} after-cutoff excluded`,
    `Internal gaps: ${meta.integrity.coverage.internalGaps.length}`,
    `Coverage: ${meta.integrity.coverage.complete ? 'complete' : 'incomplete'} (${number(
      meta.integrity.coverage.expectedBars,
    )} expected closed buckets)`,
    ...report.warnings,
    ...report.limitations,
  ].join('\n');
}

function strategyLabel(strategy: ComparisonResult['baseline']): string {
  const config = strategy.configuration;

  if (strategy.name.startsWith('rsi-') && typeof config.period === 'number') {
    const funding = config.maxFundingRatePercentage === undefined ? '' : `; funding max ${config.maxFundingRatePercentage} percentage points, missing=${config.missingFundingPolicy}`;
    return `RSI(${config.period}), buy threshold ${config.buyThreshold}, sell threshold ${config.sellThreshold}, ${config.priceField} (${strategy.name})${funding}`;
  }

  const configText = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

  return oneLine(`${strategy.name}${configText ? ` (${configText})` : ''}`);
}

export function formatComparison(report: ComparisonResult, path: string, maxRows = 20): string {
  const lines = [
    title,
    `Market: ${report.symbol ? `${report.symbol}-PERP` : 'none'}`,
    `Timeframe: ${report.dataset?.meta.timeframe ?? 'none'}`,
    `Dataset: ${basename(path)}`,
    report.dataset?.meta.timeframe
      ? `Candles replayed: ${number(report.eventCounts.candle_closed)}`
      : `Snapshots replayed: ${number(report.eventCounts.orderbook_snapshot)}`,
    `Input events: ${number(report.inputEvents)} (${report.eventCounts.funding_rate} funding observations)`,
    'Same canonical input: yes; offline / deterministic replay',
    '',
    `Baseline:  ${strategyLabel(report.baseline)}`,
    `Candidate: ${strategyLabel(report.candidate)}`,
    '',
    '                  Baseline  Candidate',
    ...(['BUY', 'SELL', 'HOLD'] as const).map(
      (signal) =>
        `${signal.padEnd(18)}${number(report.baseline.counts[signal]).padEnd(10)}${number(
          report.candidate.counts[signal],
        )}`,
    ),
    '',
    `Changed decisions: ${number(report.changedDecisions)}`,
    `Comparable: ${number(report.comparableDecisions)}; unchanged: ${number(
      report.unchangedDecisions,
    )}`,
  ];

  if (report.missingBaseline || report.missingCandidate) {
    lines.push(
      `Missing baseline: ${report.missingBaseline}; missing candidate: ${report.missingCandidate} (included in changed count)`,
    );
  }
  if (!report.diffs.length) {
    lines.push('No behavioral changes.');
  } else {
    lines.push('', 'Timestamp (UTC)      Baseline     Candidate    Details');

    for (const diff of report.diffs.slice(0, maxRows)) {
      const before = diff.baseline?.signal ?? 'NO_DECISION';
      const after = diff.candidate?.signal ?? 'NO_DECISION';
      const details = oneLine(
        `${diff.baseline?.reason ?? 'No baseline reason'} → ${
          diff.candidate?.reason ?? 'No candidate reason'
        }`,
      );
      lines.push(`${rowTime(diff.timestampMs)}  ${before.padEnd(13)}${after.padEnd(13)}${details}`);
    }
    if (report.diffs.length > maxRows) {
      lines.push(
        `Showing ${maxRows} of ${report.diffs.length} changes. Use --show-all to see every change.`,
      );
    }
  }
  if (report.dataset) {
    lines.push('', ...coverageWarnings(report.dataset.meta.integrity.coverage));
    lines.push(...report.warnings.filter(warning => !warning.startsWith('Incomplete coverage:')).map(warning => `WARNING: ${warning}`));
  }

  return lines.join('\n');
}

export function formatReplay(
  result: DeepReadonly<ReplayResult>,
  path: string,
  maxRows = 20,
): string {
  const signals = result.decisions.filter((decision) => decision.signal !== 'HOLD');
  const lines = [
    title,
    `Strategy: ${oneLine(result.strategyName)}`,
    `Dataset: ${basename(path)}`,
    `Market: ${result.symbol ?? 'none'}; timeframe: ${result.provenance?.meta.timeframe ?? 'none'}`,
    `Input events: ${number(result.totalEvents)}; decisions: ${number(result.totalDecisions)}`,
    `BUY: ${result.counts.BUY}; SELL: ${result.counts.SELL}; HOLD: ${result.counts.HOLD}`,
    `First decision: ${result.decisions[0] ? utc(result.decisions[0].availableAtMs) : 'none'}`,
    `Last decision: ${
      result.decisions.at(-1) ? utc(result.decisions.at(-1)!.availableAtMs) : 'none'
    }`,
  ];

  if (signals.length) {
    lines.push('', 'Timestamp (UTC)      Signal  Reason');

    for (const decision of signals.slice(0, maxRows)) {
      lines.push(
        `${rowTime(decision.availableAtMs)}  ${decision.signal.padEnd(8)}${oneLine(
          decision.reason ?? '',
        )}`,
      );
    }
    if (signals.length > maxRows) {
      lines.push(`Showing ${maxRows} of ${signals.length} non-HOLD decisions.`);
    }
  } else {
    lines.push('No BUY/SELL decisions.');
  }
  if (result.provenance) {
    lines.push('', ...coverageWarnings(result.provenance.meta.integrity.coverage));
    lines.push(...result.warnings.filter(warning => !warning.startsWith('Incomplete coverage:')).map(warning => `WARNING: ${warning}`));
  }

  return lines.join('\n');
}

export function createBookInspectionReport(fixture: OrderbookFixture) {
  return {
    schemaVersion: 1 as const, metadata: fixture.meta,
    snapshotCount: fixture.snapshots.length,
    warnings: ['Locally sampled Phoenix HTTP order books, not an event-complete L2 feed. Receipt time is not exact exchange event time.'],
  };
}
export function formatBookInspection(report: ReturnType<typeof createBookInspectionReport>, path: string): string {
  return [title, `Market: ${report.metadata.symbol}-PERP`, `Dataset: ${basename(path)}`,
    `Source: ${report.metadata.source} / ${report.metadata.method}`,
    `Snapshots: ${report.snapshotCount}; schema: ${report.schemaVersion}`,
    `Local receipt window: ${utc(report.metadata.firstReceiptMs)} → ${utc(report.metadata.lastReceiptMs)}`,
    `Out-of-order: ${report.metadata.integrity.outOfOrder}; identical duplicates removed: ${report.metadata.integrity.duplicatesRemoved}`,
    ...report.warnings.map(warning => `WARNING: ${warning}`),
  ].join('\n');
}
