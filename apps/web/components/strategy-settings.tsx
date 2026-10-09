import type { StrategyConfig } from "../lib/config";
export function BuySetting({
  title,
  config,
  onChange,
}: {
  title: string;
  config: StrategyConfig;
  onChange: (value: StrategyConfig) => void;
}) {
  return (
    <fieldset className="strategy-card">
      <legend>{title}</legend>
      <label>
        BUY threshold
        <input
          required
          type="number"
          min="0"
          max="100"
          step="any"
          value={Number.isNaN(config.buyThreshold) ? "" : config.buyThreshold}
          onChange={(e) =>
            onChange({ ...config, buyThreshold: e.target.valueAsNumber })
          }
        />
      </label>
      <p>
        A BUY signal is generated when RSI crosses upward through this value.
      </p>
    </fieldset>
  );
}
export function AdvancedSetting({
  title,
  config,
  onChange,
}: {
  title: string;
  config: StrategyConfig;
  onChange: (value: StrategyConfig) => void;
}) {
  return (
    <fieldset className="advanced-fields">
      <legend>{title}</legend>
      <label>
        RSI period
        <input
          required
          type="number"
          min="2"
          max="200"
          step="1"
          value={Number.isNaN(config.period) ? "" : config.period}
          onChange={(e) =>
            onChange({ ...config, period: e.target.valueAsNumber })
          }
        />
      </label>
      <label>
        SELL threshold
        <input
          required
          type="number"
          min="0"
          max="100"
          step="any"
          value={Number.isNaN(config.sellThreshold) ? "" : config.sellThreshold}
          onChange={(e) =>
            onChange({ ...config, sellThreshold: e.target.valueAsNumber })
          }
        />
      </label>
      <label>
        Price field
        <select
          value={config.priceField}
          onChange={(e) =>
            onChange({
              ...config,
              priceField: e.target.value as StrategyConfig["priceField"],
            })
          }
        >
          <option value="close">Close</option>
          <option value="markClose">Mark close</option>
        </select>
      </label>
    </fieldset>
  );
}
