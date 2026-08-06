"use client";

function moneyInput({
  value,
  onChange,
  accent,
}: {
  value: number;
  onChange: (v: number) => void;
  accent: "usd" | "zig";
}) {
  const display = value === 0 ? "" : String(value);
  return (
    <input
      type="number"
      step="0.01"
      min={0}
      value={display}
      placeholder="0.00"
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={`w-28 rounded border border-line bg-surface px-2 py-1 text-right font-mono text-sm tabular-nums text-ink outline-none placeholder:text-ink-faint/50 ${
        accent === "usd" ? "focus:border-usd" : "focus:border-zig"
      }`}
    />
  );
}

export function CurrencyPairInput({
  label,
  usdValue,
  zigValue,
  onUsdChange,
  onZigChange,
}: {
  label: string;
  usdValue: number;
  zigValue: number;
  onUsdChange: (v: number) => void;
  onZigChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line py-2 last:border-b-0">
      <span className="text-sm text-ink-soft">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs text-usd">USD</span>
        {moneyInput({ value: usdValue, onChange: onUsdChange, accent: "usd" })}
      </div>
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs text-zig">ZiG</span>
        {moneyInput({ value: zigValue, onChange: onZigChange, accent: "zig" })}
      </div>
    </div>
  );
}
