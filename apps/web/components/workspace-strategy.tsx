"use client";
import { useState } from "react";
import type { Selection, Template } from "../lib/workspace-types";
import type { DeclarativeSpec, Operand } from "../../../src/index.js";
const initialSpec: DeclarativeSpec = {
  name: "My RSI rules",
  rules: [
    {
      when: {
        op: "crossAbove",
        left: { kind: "rsi", period: 14, field: "close" },
        right: { kind: "constant", value: 30 },
      },
      signal: "BUY",
    },
    {
      when: {
        op: "crossBelow",
        left: { kind: "rsi", period: 14, field: "close" },
        right: { kind: "constant", value: 70 },
      },
      signal: "SELL",
    },
  ],
};
export default function WorkspaceStrategy({
  label,
  selection,
  templates,
  onChange,
}: {
  label: string;
  selection: Selection;
  templates: Template[];
  onChange: (selection: Selection) => void;
}) {
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const template = templates.find((t) => t.id === selection.id);
  const fields = template?.parameterSchema.properties as
    | Record<
        string,
        {
          type?: string;
          enum?: string[];
          minimum?: number;
          maximum?: number;
          description?: string;
        }
      >
    | undefined;
  return (
    <section className="workspace-strategy">
      <h3>{label}</h3>
      <label>
        Strategy template
        <select
          value={selection.id}
          onChange={(event) => {
            const id = event.target.value;
            onChange(
              id === "declarative"
                ? { id, spec: structuredClone(initialSpec) }
                : {
                    id: id as Exclude<Selection["id"], "declarative">,
                    params: { ...templates.find((t) => t.id === id)!.defaults },
                  },
            );
          }}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="declarative">Custom rule builder</option>
        </select>
      </label>
      {selection.id !== "declarative" ? (
        <>
          <p className="muted">{template?.description}</p>
          <div className="workspace-fields">
            {Object.entries(fields ?? {}).map(([key, schema]) => (
              <label key={key}>
                {key.replace(/([A-Z])/g, " $1")}
                {schema.enum ? (
                  <select
                    value={selection.params[key]}
                    onChange={(e) =>
                      onChange({
                        ...selection,
                        params: { ...selection.params, [key]: e.target.value },
                      })
                    }
                  >
                    {schema.enum.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={schema.minimum}
                    max={schema.maximum}
                    step={schema.type === "integer" ? 1 : "any"}
                    value={selection.params[key] ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...selection,
                        params: {
                          ...selection.params,
                          [key]:
                            e.target.value === "" ? "" : Number(e.target.value),
                        },
                      })
                    }
                  />
                )}
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            Rules run in order. First match wins; otherwise HOLD. No JavaScript
            is executed.
          </p>
          <label>
            Strategy name
            <input
              value={selection.spec.name}
              maxLength={80}
              onChange={(e) =>
                onChange({
                  ...selection,
                  spec: { ...selection.spec, name: e.target.value },
                })
              }
            />
          </label>
          {selection.spec.rules.map((rule, index) => {
            if ("conditions" in rule.when)
              return (
                <p key={index}>
                  Rule {index + 1}: {rule.when.op.toUpperCase()} group — edit in
                  JSON below.
                </p>
              );
            const condition = rule.when;
            function change(
              left: Operand,
              right: Operand,
              op = condition.op,
              signal = rule.signal,
            ) {
              if (selection.id !== "declarative") return;
              onChange({
                ...selection,
                spec: {
                  ...selection.spec,
                  rules: selection.spec.rules.map((r, i) =>
                    i === index ? { when: { op, left, right }, signal } : r,
                  ),
                },
              });
            }
            return (
              <fieldset key={index}>
                <legend>Rule {index + 1}</legend>
                <div className="workspace-fields">
                  <label>
                    Indicator
                    <select
                      value={condition.left.kind}
                      onChange={(e) =>
                        change(
                          e.target.value === "price"
                            ? { kind: "price", field: "close" }
                            : {
                                kind: e.target.value as "rsi" | "ema",
                                period: 14,
                                field: "close",
                              },
                          condition.right,
                        )
                      }
                    >
                      <option value="rsi">RSI</option>
                      <option value="ema">EMA</option>
                      <option value="price">Price</option>
                    </select>
                  </label>
                  {"period" in condition.left && (
                    <label>
                      Period
                      <input
                        type="number"
                        min={2}
                        max={200}
                        value={condition.left.period}
                        onChange={(e) =>
                          change(
                            {
                              ...condition.left,
                              period: Number(e.target.value),
                            } as Operand,
                            condition.right,
                          )
                        }
                      />
                    </label>
                  )}
                  <label>
                    Operator
                    <select
                      value={condition.op}
                      onChange={(e) =>
                        change(
                          condition.left,
                          condition.right,
                          e.target.value as typeof condition.op,
                        )
                      }
                    >
                      {[
                        "crossAbove",
                        "crossBelow",
                        "gt",
                        "lt",
                        "gte",
                        "lte",
                      ].map((op) => (
                        <option key={op}>{op}</option>
                      ))}
                    </select>
                  </label>
                  {condition.right.kind === "constant" && (
                    <label>
                      Value
                      <input
                        type="number"
                        step="any"
                        value={condition.right.value}
                        onChange={(e) =>
                          change(condition.left, {
                            kind: "constant",
                            value: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    Signal
                    <select
                      value={rule.signal}
                      onChange={(e) =>
                        change(
                          condition.left,
                          condition.right,
                          condition.op,
                          e.target.value as typeof rule.signal,
                        )
                      }
                    >
                      <option>BUY</option>
                      <option>SELL</option>
                      <option>HOLD</option>
                    </select>
                  </label>
                </div>
              </fieldset>
            );
          })}
          <details>
            <summary>
              Advanced JSON rules (AND / OR and indicator comparisons)
            </summary>
            <textarea
              aria-label={`${label} declarative JSON`}
              rows={12}
              value={json || JSON.stringify(selection.spec, null, 2)}
              onChange={(e) => setJson(e.target.value)}
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  const spec: unknown = JSON.parse(
                    json || JSON.stringify(selection.spec),
                  );
                  const response = await fetch("/api/workspace/validate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: "declarative", spec }),
                  });
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(result.error?.message ?? "Invalid rules");
                  onChange(result.selection);
                  setJsonError("");
                } catch (error) {
                  setJsonError(
                    error instanceof Error
                      ? error.message
                      : "Enter valid declarative rules",
                  );
                }
              }}
            >
              Apply JSON
            </button>
            {jsonError && <p role="alert">{jsonError}</p>}
          </details>
        </>
      )}
    </section>
  );
}
