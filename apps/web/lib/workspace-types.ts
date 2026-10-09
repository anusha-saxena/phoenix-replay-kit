import type {
  runWorkspace,
  listStrategies,
  discoverCapabilities,
  Snapshot,
  StrategySelection,
} from "../../../src/index.js";
export type Template = ReturnType<typeof listStrategies>[number];
export type Capabilities = Awaited<ReturnType<typeof discoverCapabilities>>;
export type Selection = StrategySelection;
export type ChartPoint = {
  candleStartMs: number | null;
  sequence: number;
  signal: string;
  diagnostics: Record<string, number>;
};
export type WorkspaceResult = Omit<
  ReturnType<typeof runWorkspace>,
  "manifest" | "traces"
> & {
  chart: ChartPoint[][];
  pagination: {
    differenceLimit: number;
    replayDecisionLimit: number;
    exportContainsAll: boolean;
  };
};
export type RunInput = {
  snapshot: Snapshot;
  baseline: Selection;
  candidate?: Selection;
  assertions?: Record<string, number | boolean>;
};
export type { Snapshot };
