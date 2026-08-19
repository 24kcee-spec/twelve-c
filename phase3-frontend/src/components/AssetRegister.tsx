"use client";

import { api } from "@/lib/api";
import { ASSET_CATEGORY_LABELS, AssetCategory, CapitalAssetOut } from "@/lib/types";
import { useEffect, useState } from "react";
import { Button, Field, TrashIcon } from "./ui";

const CATEGORY_OPTIONS = Object.entries(ASSET_CATEGORY_LABELS) as [AssetCategory, string][];

/**
 * Collapsible capital asset register for one business. Assets persist
 * across tax years (acquired once, claimed against year after year), so
 * this lives independently of any single calculation - `taxYear` just
 * controls which year's allowance total is displayed and offered up via
 * `onApply`. Nothing is written into the calculation automatically; see
 * capital_allowances.py's module docstring for why.
 */
export function AssetRegister({
  businessId,
  taxYear,
  onApply,
}: {
  businessId: string;
  taxYear: number;
  onApply: (usd: number, zig: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<CapitalAssetOut[]>([]);
  const [totals, setTotals] = useState<{ usd: number; zig: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<AssetCategory>("machinery_other");
  const [costUsd, setCostUsd] = useState(0);
  const [costZig, setCostZig] = useState(0);
  const [yearAcquired, setYearAcquired] = useState(taxYear);
  const [electSia, setElectSia] = useState(false);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [assetList, allowance] = await Promise.all([
        api.listAssets(businessId),
        api.getAllowanceTotals(businessId, taxYear),
      ]);
      setAssets(assetList);
      setTotals({ usd: allowance.total_allowance_usd, zig: allowance.total_allowance_zig });
    } catch {
      setError("Couldn't load the asset register.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, taxYear]);

  async function handleAdd() {
    if (!description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createAsset(businessId, {
        description: description.trim(),
        category,
        cost_usd: costUsd,
        cost_zig: costZig,
        year_acquired: yearAcquired,
        elect_sia: electSia,
      });
      setDescription("");
      setCostUsd(0);
      setCostZig(0);
      setElectSia(false);
      setShowForm(false);
      await refresh();
    } catch {
      setError("Couldn't save that asset.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assetId: string) {
    try {
      await api.deleteAsset(businessId, assetId);
      await refresh();
    } catch {
      setError("Couldn't remove that asset.");
    }
  }

  return (
    <div className="rounded border border-line px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-soft"
      >
        <span>
          Asset register
          <span className="ml-2 font-mono text-xs font-normal text-ink-faint">SIA / wear &amp; tear</span>
        </span>
        <span className="text-ink-faint">{open ? "Hide" : "Manage"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <p className="text-xs text-ink-faint">
            Track fixed assets once here and this works out the Special Initial Allowance or wear &amp;
            tear claimable for {taxYear} - a running tally, not a one-off entry. Add it to this
            calculation&apos;s capital allowances whenever it&apos;s ready.
          </p>

          {loading && <p className="text-xs text-ink-faint">Loading register...</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {!loading && assets.length > 0 && (
            <ul className="space-y-1">
              {assets.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-ink">{a.description}</p>
                    <p className="truncate text-xs text-ink-faint">
                      {ASSET_CATEGORY_LABELS[a.category]} - {a.year_acquired}
                      {a.elect_sia ? " - SIA elected" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-ink-soft">
                      {a.cost_usd > 0 ? `$${a.cost_usd.toLocaleString()}` : ""}
                      {a.cost_usd > 0 && a.cost_zig > 0 ? " / " : ""}
                      {a.cost_zig > 0 ? `Z${a.cost_zig.toLocaleString()}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="text-ink-faint hover:text-red-600"
                      aria-label={`Remove ${a.description}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && assets.length === 0 && (
            <p className="text-xs text-ink-faint">No assets on the register yet.</p>
          )}

          {totals && (
            <div className="flex items-center justify-between rounded bg-surface-soft px-2 py-1.5 text-sm">
              <span className="text-ink-soft">Claimable for {taxYear}</span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs tabular-nums text-usd">
                  ${totals.usd.toLocaleString()}
                </span>
                <span className="font-mono text-xs tabular-nums text-zig">
                  Z{totals.zig.toLocaleString()}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => onApply(totals.usd, totals.zig)}
                  disabled={totals.usd === 0 && totals.zig === 0}
                >
                  Apply to calculation
                </Button>
              </div>
            </div>
          )}

          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="text-xs font-medium text-usd hover:underline"
            >
              + Add asset
            </button>
          ) : (
            <div className="space-y-2 rounded border border-line p-2">
              <Field
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Delivery van"
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink-soft">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AssetCategory)}
                  className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-usd"
                >
                  {CATEGORY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Cost (USD)"
                  type="number"
                  min={0}
                  step="0.01"
                  emptyIfZero
                  value={costUsd}
                  onChange={(e) => setCostUsd(parseFloat(e.target.value) || 0)}
                />
                <Field
                  label="Cost (ZiG)"
                  type="number"
                  min={0}
                  step="0.01"
                  emptyIfZero
                  value={costZig}
                  onChange={(e) => setCostZig(parseFloat(e.target.value) || 0)}
                />
              </div>
              <Field
                label="Year acquired"
                type="number"
                min={2000}
                max={2100}
                value={yearAcquired}
                onChange={(e) => setYearAcquired(parseInt(e.target.value, 10) || taxYear)}
              />
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={electSia} onChange={(e) => setElectSia(e.target.checked)} />
                Elect Special Initial Allowance (25%/yr for 4 years) instead of wear &amp; tear
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={handleAdd}
                  disabled={saving || !description.trim()}
                >
                  {saving ? "Saving..." : "Save asset"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}