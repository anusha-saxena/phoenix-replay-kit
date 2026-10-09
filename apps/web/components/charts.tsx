"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  type UTCTimestamp,
  type SeriesMarker,
  type IChartApi,
} from "lightweight-charts";
import type { DemoData, CompareData } from "../lib/engine";
import { utc, rsiValue } from "../lib/presentation";
const seconds = (ms: number) => (ms / 1000) as UTCTimestamp;
const sides = ["baseline", "candidate"] as const;
const labels = { baseline: "Original", candidate: "Updated" };
const colors = { baseline: "#c3b5dd", candidate: "#efaac7" };
export default function Charts({
  demo,
  result,
  selected,
}: {
  demo: DemoData;
  result: CompareData;
  selected: number | null;
}) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const priceChart = useRef<IChartApi | null>(null);
  const [mode, setMode] = useState("Off");
  const [fullHistory, setFullHistory] = useState(true);
  const [hover, setHover] = useState(
    "Move the crosshair over a candle to see its prices and RSI values.",
  );
  useEffect(() => {
    setFullHistory(selected === null);
  }, [selected]);
  useEffect(() => {
    if (!priceRef.current || !rsiRef.current) return;
    const options = {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#141619" },
        textColor: "#d0c6d0",
        attributionLogo: true,
        fontFamily: "Arial, Helvetica, sans-serif",
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#25282e" } },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        minBarSpacing: 0.05,
      },
      localization: {
        timeFormatter: (time: number) => `${utc(time * 1000)} UTC`,
      },
    };
    const price = createChart(priceRef.current, { ...options, height: 250 });
    const rsi = createChart(rsiRef.current, { ...options, height: 170 });
    priceChart.current = price;
    const candles = price.addSeries(CandlestickSeries, {
      upColor: "#b4bfc1",
      downColor: "#727d87",
      wickUpColor: "#b4bfc1",
      wickDownColor: "#727d87",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    candles.setData(
      demo.candles.map((candle) => ({
        time: seconds(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    const selectedStart =
      selected === null ? null : selected - demo.meta.timeframeMs;
    const changed = new Set(result.report.diffs.map((d) => d.eventId));
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    for (const side of sides) {
      if (mode !== labels[side] && mode !== "Differences") continue;

      for (const decision of result.series[side]) {
        if (decision.signal === "HOLD") continue;
        if (mode === "Differences" && !changed.has(decision.eventId)) continue;

        const buy = decision.signal === "BUY";
        markers.push({
          time: seconds(decision.candleStartMs!),
          position: buy ? "belowBar" : "aboveBar",
          shape: buy ? "arrowUp" : "arrowDown",
          color: colors[side],
          size: 0.7,
        });
      }
    }
    if (selectedStart !== null)
      markers.push({
        time: seconds(selectedStart),
        position: "inBar",
        shape: "circle",
        color: colors.candidate,
        size: 2,
      });
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(candles, markers);
    for (const side of sides) {
      const line = rsi.addSeries(LineSeries, {
        color: colors[side],
        lineWidth: 2,
        lineStyle: side === "baseline" ? LineStyle.Solid : LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      line.setData(
        result.series[side].map((decision) =>
          typeof decision.diagnostics?.rsi === "number"
            ? {
                time: seconds(decision.candleStartMs!),
                value: decision.diagnostics.rsi,
              }
            : { time: seconds(decision.candleStartMs!) },
        ),
      );
      for (const threshold of [
        result.configs[side].buyThreshold,
        result.configs[side].sellThreshold,
      ])
        line.createPriceLine({
          price: threshold,
          color: colors[side],
          lineWidth: 1,
          lineStyle: side === "baseline" ? LineStyle.Dashed : LineStyle.Dotted,
          axisLabelVisible: false,
        });
      const decision = result.series[side].find(
        (d) => d.availableAtMs === selected,
      );
      if (decision && typeof decision.diagnostics?.rsi === "number")
        createSeriesMarkers(line, [
          {
            time: seconds(decision.candleStartMs!),
            position: "inBar",
            shape: "circle",
            color: colors[side],
            size: 1.5,
          },
        ]);
    }
    function showHover(time: number) {
      const index = demo.candles.findIndex((c) => c.time === time);
      const candle = demo.candles[index];
      if (!candle) return;
      setHover(
        `Candle start ${utc(time)} UTC · Open ${candle.open.toFixed(2)}, high ${candle.high.toFixed(2)}, low ${candle.low.toFixed(2)}, close ${candle.close.toFixed(2)} · RSI: original ${rsiValue(result.series.baseline[index]?.diagnostics?.rsi)}, updated ${rsiValue(result.series.candidate[index]?.diagnostics?.rsi)}`,
      );
    }
    price.subscribeCrosshairMove((param) => {
      if (param.time) showHover(Number(param.time) * 1000);
    });
    rsi.subscribeCrosshairMove((param) => {
      if (param.time) showHover(Number(param.time) * 1000);
    });
    let syncing = false;
    const sync = (from: IChartApi, to: IChartApi) =>
      from.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || syncing) return;
        const current = to.timeScale().getVisibleLogicalRange();
        if (
          current &&
          Math.abs(current.from - range.from) < 0.001 &&
          Math.abs(current.to - range.to) < 0.001
        )
          return;
        syncing = true;
        to.timeScale().setVisibleLogicalRange(range);
        syncing = false;
      });
    sync(price, rsi);
    sync(rsi, price);
    price.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && priceRef.current)
        priceRef.current.dataset.visibleBars = String(
          Math.ceil(range.to - range.from),
        );
    });

    const frame = requestAnimationFrame(() => {
      if (selectedStart !== null && !fullHistory) {
        const index = demo.candles.findIndex((c) => c.time === selectedStart);
        price.timeScale().setVisibleLogicalRange({
          from: Math.max(0, index - 24),
          to: Math.min(demo.candles.length - 1, index + 24),
        });
      } else price.timeScale().fitContent();
    });
    return () => {
      cancelAnimationFrame(frame);
      priceChart.current = null;
      price.remove();
      rsi.remove();
    };
  }, [demo, result, mode, selected, fullHistory]);
  return (
    <section
      className="charts-section"
      aria-label="Historical price and RSI charts"
    >
      <div className="section-heading">
        <div>
          <h2>Put the decision in context</h2>
          <p>
            {selected === null ? (
              "Select a changed decision above to explore the surrounding prices and RSI."
            ) : (
              <>
                Selected decision:{" "}
                <strong data-testid="chart-selected-time">
                  {utc(selected)} UTC
                </strong>
                .{" "}
                {fullHistory
                  ? "Showing the full history."
                  : "Showing surrounding observations."}
              </>
            )}
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setFullHistory(true);
            priceChart.current?.timeScale().fitContent();
          }}
        >
          Show full history
        </button>
      </div>
      <div className="chart-panel">
        <div className="chart-heading">
          <h3>Recorded SOL prices · USD</h3>
          <label className="inline-label">
            Show signals
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {["Off", "Original", "Updated", "Differences"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
        <div ref={priceRef} data-testid="price-chart" style={{ height: 250 }} />
        <p className="chart-tooltip">{hover}</p>
        <div className="rsi-heading">
          <h3>RSI used by each strategy</h3>
          <p>
            <span className="original-series">
              Original: solid line, RSI({result.configs.baseline.period}),{" "}
              {result.configs.baseline.priceField}
            </span>
            <br />
            <span className="updated-series">
              Updated: dashed line, RSI({result.configs.candidate.period}),{" "}
              {result.configs.candidate.priceField}
            </span>
          </p>
        </div>
        <p className="thresholds">
          Original BUY {result.configs.baseline.buyThreshold} / SELL{" "}
          {result.configs.baseline.sellThreshold} · Updated BUY{" "}
          {result.configs.candidate.buyThreshold} / SELL{" "}
          {result.configs.candidate.sellThreshold}
        </p>
        <div ref={rsiRef} style={{ height: 170 }} />
        <p className="chart-explanation">
          RSI tracks recent price momentum on a scale from 0 to 100. The solid
          line shows the original strategy; the dashed line shows the update.
          The horizontal lines mark their BUY and SELL thresholds. A BUY happens
          when RSI moves from below the BUY line to that line or above it. A
          SELL happens when RSI moves from above the SELL line to that line or
          below it. Staying on one side gives HOLD, not another signal. If only
          the thresholds change, the RSI curves overlap, but the signals can
          still differ. Gaps at the start mean RSI is still warming up.
        </p>
      </div>
      <p className="small chart-note">
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
        .
      </p>
    </section>
  );
}
