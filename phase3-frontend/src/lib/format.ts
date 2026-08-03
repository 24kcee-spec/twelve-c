export function money(value: number, currency: "USD" | "ZIG"): string {
  const rounded = Math.round(value * 100) / 100;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "USD" ? `$${formatted}` : `ZiG ${formatted}`;
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
