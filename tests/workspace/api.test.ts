import { it, expect } from "vitest";
import {
  workspaceGet,
  workspacePost,
} from "../../apps/web/lib/workspace-api.js";
import { syntheticFixture } from "../helpers/synthetic-fixture.js";
import { createSnapshot } from "../../src/index.js";
const post = (action: string, input: unknown) =>
  workspacePost(
    action,
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
const f = syntheticFixture(
  Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i) * 10),
);
const snapshot = createSnapshot(
  f,
  "historical",
  f.bars[25]!.time,
  f.meta.requestedToMs,
  25,
);
const input = {
  snapshot,
  baseline: { id: "ema-cross", params: { fastPeriod: 3, slowPeriod: 8 } },
};
it("discovers shared templates and validates safe public strategy configurations", async () => {
  const response = await workspaceGet("strategies");
  expect(response.status).toBe(200);
  expect((await response.json()).strategies).toHaveLength(3);
  expect((await post("validate", input.baseline)).status).toBe(200);
  expect(
    (await post("validate", { path: "/tmp/code.ts", code: "process.exit()" }))
      .status,
  ).toBe(400);
  expect((await workspaceGet("missing")).status).toBe(404);
});
it("executes single replay, compares, returns selected diagnostics and exports a complete reproducible report", async () => {
  const replay = await post("replay", input);
  expect(replay.status).toBe(200);
  const result = await replay.json();
  expect(result.report.totalEvents).toBe(55);
  expect(result.chart[0]).toHaveLength(55);
  expect(result.manifest).toBeUndefined();
  const detail = await post("detail", { ...input, sequence: 25 });
  expect(detail.status).toBe(200);
  expect((await detail.json()).decisions[0].diagnostics.fastEma).toBeTypeOf(
    "number",
  );
  const compared = await post("compare", {
    ...input,
    candidate: input.baseline,
    assertions: { exactEquivalence: true },
  });
  expect(compared.status).toBe(200);
  expect((await compared.json()).assertion.passed).toBe(true);
  const exported = await post("export", input);
  expect(exported.status).toBe(200);
  const saved = await exported.json();
  expect(saved.manifest.snapshot.id).toBe(snapshot.id);
  expect(saved.traces[0]).toHaveLength(55);
  expect(saved.reportId).toBe(result.reportId);
});
it("rejects invalid, tampered, oversized or arbitrary-code requests with structured errors", async () => {
  const mutated = JSON.parse(JSON.stringify(snapshot));
  mutated.fixture.bars[0].volume = 5;
  for (const value of [
    { ...input, code: "eval()" },
    { ...input, snapshot: mutated },
    { ...input, baseline: { id: "ema-cross", params: { fastPeriod: 300 } } },
  ]) {
    const response = await post("replay", value);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  }
  const malformed = await workspacePost(
    "replay",
    new Request("http://localhost", { method: "POST", body: "{" }),
  );
  expect(malformed.status).toBe(400);
  const huge = await workspacePost(
    "replay",
    new Request("http://localhost", {
      method: "POST",
      body: " ".repeat(2_000_001),
    }),
  );
  expect(huge.status).toBe(413);
  expect((await post("compare", input)).status).toBe(400);
});
