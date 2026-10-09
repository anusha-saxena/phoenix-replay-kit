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
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#000000",
        fontSize: 14,
      },
      timeScale: { timeVisible: true, minBarSpacing: 0.05 },
      grid: { vertLines: { visible: false }, horzLines: { color: "#e5e5e5" } },
    });
    const price = graph.addSeries(CandlestickSeries, {
      upColor: "#000000",
      downColor: "#666666",
      borderVisible: false,
      wickUpColor: "#000000",
      wickDownColor: "#666666",
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
              color: side ? "#000000" : "#666666",
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
          color: "#000000",
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
