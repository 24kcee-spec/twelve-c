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

/** "Aug 3, 2:14 PM" - used to differentiate otherwise-identical history rows
 *  (e.g. several "Annual estimate" entries in the same tax year). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
