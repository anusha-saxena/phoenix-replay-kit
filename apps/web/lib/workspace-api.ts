import { z } from "zod";
import rawFixture from "./demo-fixture.json" with { type: "json" };
import {
  createSnapshot,
  listStrategies,
  parseStrategySelection,
  strategyFactory,
  runWorkspace,
  LIMITS,
  validateCandleFixture,
} from "../../../src/index.js";
import {
  DataError,
  discoverCapabilities,
  snapshotCollector,
} from "../../../src/workspace/phoenix-data.js";
import { workspaceRequestSchema } from "../../../src/workspace/evaluate.js";
export async function workspaceGet(action: string) {
  try {
    if (action === "strategies")
      return Response.json({
        strategies: listStrategies(),
        declarative: {
          supported: true,
          operators: [
            "gt",
            "lt",
            "gte",
            "lte",
            "crossAbove",
            "crossBelow",
            "and",
            "or",
          ],
          outputTypes: ["BUY", "SELL", "HOLD"],
        },
      });
    if (action === "capabilities")
      return Response.json(await discoverCapabilities(), {
        headers: { "Cache-Control": "no-store" },
      });
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Unknown workspace resource" } },
      { status: 404 },
    );
  } catch (error) {
    return apiError(error);
  }
}
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > LIMITS.maxBodyBytes)
    throw new DataError("TOO_LARGE", "Request exceeds 2 MB");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > LIMITS.maxBodyBytes) {
        await reader.cancel();
        throw new DataError("TOO_LARGE", "Request exceeds 2 MB");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const requests = new Map<string, { start: number; count: number }>();
function allowRequest(request: Request) {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const entry = requests.get(key);
  if (entry && now - entry.start < 60000) return ++entry.count <= 60;
  if (requests.size >= 400) requests.delete(requests.keys().next().value!);
  requests.set(key, { start: now, count: 1 });
  return true;
}
export async function workspacePost(action: string, request: Request) {
  if (!allowRequest(request))
    return Response.json(
      {
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests; retry in a minute",
        },
      },
      { status: 429 },
    );
  try {
    const body = await readBody(request);
    if (action === "dataset") {
      if (
        body &&
        typeof body === "object" &&
        "mode" in body &&
        body.mode === "demo"
      ) {
        z.object({ mode: z.literal("demo") })
          .strict()
          .parse(body);
        const fixture = validateCandleFixture(rawFixture);
        return Response.json(
          createSnapshot(
            fixture,
            "demo",
            fixture.meta.requestedFromMs,
            fixture.meta.requestedToMs,
          ),
        );
      }
      return Response.json(await snapshotCollector.collect(body));
    }
    if (action === "validate") {
      const selection = parseStrategySelection(body);
      const instance = strategyFactory(selection)();
      return Response.json({
        valid: true,
        selection,
        warmupBars: instance.warmupBars,
        requiredInputs: instance.requiredInputs,
      });
    }
    if (["replay", "compare", "export", "detail"].includes(action)) {
      const parsed = z
        .object({
          snapshot: z.unknown(),
          baseline: z.unknown(),
          candidate: z.unknown().optional(),
          assertions: z.unknown().optional(),
          sequence: z.number().int().min(0).optional(),
        })
        .strict()
        .parse(body);
      const { sequence, ...input } = parsed;
      const checked = workspaceRequestSchema.parse(input);
      if (action === "replay" && checked.candidate !== undefined)
        throw new Error("Single replay accepts only baseline");
      if (action === "compare" && checked.candidate === undefined)
        throw new Error("Comparison requires candidate");
      const result = runWorkspace(checked);
      if (action === "detail") {
        if (sequence === undefined) throw new Error("Detail requires sequence");
        return Response.json({
          decisions: result.traces.map(
            (trace) => trace.find((d) => d.sequence === sequence) ?? null,
          ),
        });
      }
      if (action === "export") {
        const content = JSON.stringify(result);
        if (Buffer.byteLength(content) > 4_000_000)
          throw new DataError(
            "TOO_LARGE",
            "Export exceeds 4 MB; choose a smaller window",
          );
        return new Response(content, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="phoenix-report.json"',
          },
        });
      }
      const { manifest: _, traces, report, ...metadata } = result;
      return Response.json({
        ...metadata,
        report:
          "diffs" in report
            ? {
                ...report,
                diffs: report.diffs.slice(0, 1000),
                totalDiffs: report.diffs.length,
              }
            : { ...report, decisions: report.decisions.slice(0, 200) },
        chart: traces.map((trace) =>
          trace.map((d) => ({
            candleStartMs: d.candleStartMs,
            signal: d.signal,
            sequence: d.sequence,
            diagnostics: Object.fromEntries(
              Object.entries(d.diagnostics ?? {}).filter(
                ([key, value]) =>
                  ["rsi", "fastEma", "slowEma"].includes(key) &&
                  typeof value === "number",
              ),
            ),
          })),
        ),
        pagination: {
          differenceLimit: 1000,
          replayDecisionLimit: 200,
          exportContainsAll: true,
        },
      });
    }
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Unknown workspace action" } },
      { status: 404 },
    );
  } catch (error) {
    return apiError(error);
  }
}
function apiError(error: unknown) {
  if (error instanceof DataError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      {
        status: {
          UPSTREAM: 502,
          TIMEOUT: 504,
          UNSUPPORTED: 422,
          BUSY: 429,
          TOO_LARGE: 413,
        }[error.code],
      },
    );
  return Response.json(
    {
      error: {
        code: "INVALID_INPUT",
        message:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .slice(0, 5)
                .join("; ")
            : error instanceof Error
              ? error.message.slice(0, 240)
              : "Invalid request",
      },
    },
    { status: 400 },
  );
}
