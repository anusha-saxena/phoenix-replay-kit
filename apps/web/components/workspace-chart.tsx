"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  createSeriesMarkers,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Snapshot, ChartPoint } from "../lib/workspace-types";
export default function WorkspaceChart({
  snapshot,
  chart,
  selected,
}: {
  snapshot: Snapshot;
  chart: ChartPoint[][];
  selected: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const graph = createChart(ref.current, {
      autoSize: true,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: "#17191d" },
        textColor: "#adb0b9",
      },
      timeScale: { timeVisible: true, minBarSpacing: 0.05 },
      grid: { vertLines: { visible: false }, horzLines: { color: "#30333a" } },
    });
    const price = graph.addSeries(CandlestickSeries, {
      upColor: "#b4bfc1",
      downColor: "#727d87",
      borderVisible: false,
      wickUpColor: "#b4bfc1",
      wickDownColor: "#727d87",
    });
    price.setData(
      snapshot.fixture.bars.map((b) => ({
        time: (b.time / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    chart.forEach((points, side) => {
      for (const key of ["fastEma", "slowEma", "rsi"]) {
        const values = points
          .filter(
            (p) =>
              p.candleStartMs !== null &&
              typeof p.diagnostics[key] === "number",
          )
          .map((p) => ({
            time: (p.candleStartMs! / 1000) as UTCTimestamp,
            value: p.diagnostics[key],
          }));
        if (values.length) {
          const line = graph.addSeries(
            LineSeries,
            {
              color: side ? "#91b4f1" : "#b0b8c5",
              lineWidth: key === "fastEma" ? 2 : 1,
              title: `${side ? "Updated" : "Original"} ${key}`,
            },
            key === "rsi" ? 1 : 0,
          );
          line.setData(values);
        }
      }
    });
    if (selected !== null) {
      createSeriesMarkers(price, [
        {
          time: (selected / 1000) as UTCTimestamp,
          position: "aboveBar",
          shape: "circle",
          color: "#91b4f1",
          text: "Selected",
        },
      ]);
      graph
        .timeScale()
        .setVisibleRange({
          from: ((selected - 24 * snapshot.fixture.meta.timeframeMs) /
            1000) as UTCTimestamp,
          to: ((selected + 24 * snapshot.fixture.meta.timeframeMs) /
            1000) as UTCTimestamp,
        });
    } else graph.timeScale().fitContent();
    return () => graph.remove();
  }, [snapshot, chart, selected]);
  return <div ref={ref} data-testid="workspace-chart" />;
}
