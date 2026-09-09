"use client";

/**
 * Horizontal step tracker for the New QPD calculation wizard (Period ->
 * Income -> Deductions -> Review). A step is only clickable once the person
 * has reached it at least once (`maxReached`) - you can always go back to
 * check earlier answers, but you can't skip ahead of where you've actually
 * gotten to.
 */
export function StepIndicator({
  steps,
  current,
  maxReached,
  onSelect,
}: {
  steps: string[];
  current: number;
  maxReached: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex items-stretch gap-1.5 sm:gap-2" role="tablist" aria-label="Calculation steps">
      {steps.map((label, i) => {
        const reached = i <= maxReached;
        const active = i === current;
        const done = i < current;
        return (
          <li key={label} className="min-w-0 flex-1">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              aria-current={active ? "step" : undefined}
              disabled={!reached}
              onClick={() => reached && onSelect(i)}
              className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left transition duration-150 ease-snap sm:px-2.5 ${
                active
                  ? "border-seal bg-seal-soft"
                  : done
                  ? "border-line bg-usd-soft/50 hover:bg-usd-soft"
                  : reached
                  ? "border-line bg-surface hover:bg-surface-2"
                  : "cursor-not-allowed border-line/60 bg-surface/40 opacity-50"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
                  active ? "bg-seal text-ink" : done ? "bg-usd text-surface" : "bg-ink-faint/20 text-ink-faint"
                }`}
              >
                {done ? "\u2713" : i + 1}
              </span>
              <span
                className={`truncate text-xs font-medium sm:text-sm ${
                  active ? "text-ink" : done ? "text-usd" : "text-ink-soft"
                }`}
              >
                {label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
