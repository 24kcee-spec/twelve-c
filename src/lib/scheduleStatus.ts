import { QpdInstalmentOut } from "@/lib/types";

export type InstalmentStatus = "paid" | "overdue" | "active" | "upcoming";

// QPD due dates are fixed by ZIMRA regardless of tax year: 25 Mar, 25 Jun,
// 25 Sep, 20 Dec. Month is 0-indexed for the Date constructor.
const QUARTER_DATES = [
  { month: 2, day: 25 },
  { month: 5, day: 25 },
  { month: 8, day: 25 },
  { month: 11, day: 20 },
];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function instalmentDate(taxYear: number, index: number): Date {
  const { month, day } = QUARTER_DATES[index];
  return new Date(taxYear, month, day);
}

export interface InstalmentWithStatus extends QpdInstalmentOut {
  date: Date;
  status: InstalmentStatus;
}

/**
 * Single source of truth for "where does each instalment stand today".
 * Previously this exact paid/overdue/active logic was duplicated between
 * ResultsPanel (for the schedule tab) and NextPaymentDue (for the banner) -
 * factored out here so both, plus the Overview page's status strip, can
 * never drift out of sync on what counts as "overdue".
 */
export function scheduleWithStatus(
  schedule: QpdInstalmentOut[],
  taxYear: number,
  today: Date = new Date()
): InstalmentWithStatus[] {
  const t = startOfDay(today);

  const withDates = schedule.map((inst, i) => ({
    ...inst,
    date: instalmentDate(taxYear, i),
    paid: inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01,
  }));

  const upcoming = withDates
    .filter((d) => !d.paid && d.date >= t)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const activeIndex = upcoming.length > 0 ? withDates.indexOf(upcoming[0]) : -1;

  return withDates.map((d, i) => {
    let status: InstalmentStatus = "upcoming";
    if (d.paid) status = "paid";
    else if (d.date < t) status = "overdue";
    else if (i === activeIndex) status = "active";
    return { ...d, status };
  });
}
