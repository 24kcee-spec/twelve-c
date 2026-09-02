"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorNote, Field, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { Business } from "@/lib/types";

type Draft = { rate: string; tax: string; levy: string };

/**
 * The default exchange / tax / AIDS levy rates for every business, editable
 * from anywhere via the account dropdown. This only changes future
 * calculations - past ones keep the exact rate that was used at the time.
 *
 * highlightBusinessId: when the modal is opened from inside a specific
 * business's page, that business's card gets a highlighted border and the
 * list auto-scrolls to it on open - otherwise you're stuck hunting through
 * every business you own to find the one you're actually looking at.
 */
export function RateSettingsModal({
  open,
  onClose,
  highlightBusinessId,
}: {
  open: boolean;
  onClose: () => void;
  highlightBusinessId?: string | null;
}) {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const highlightedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    api
      .listBusinesses()
      .then((data) => {
        setBusinesses(data);
        const next: Record<string, Draft> = {};
        data.forEach((b) => {
          next[b.id] = {
            rate: String(b.default_exchange_rate),
            tax: String(b.default_tax_rate),
            levy: String(b.default_aids_levy_rate),
          };
        });
        setDrafts(next);
      })
      .catch(() => setBusinesses([]));
  }, [open]);

  // Scroll the current business into view once its card has actually
  // rendered (businesses loaded), not on every render.
  useEffect(() => {
    if (open && businesses && highlightBusinessId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [open, businesses, highlightBusinessId]);

  function updateDraft(id: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function saveRates(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setError("");

    const rate = parseFloat(draft.rate);
    const tax = parseFloat(draft.tax);
    const levy = parseFloat(draft.levy);

    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Exchange rate must be a number greater than 0.");
      return;
    }
    if (!Number.isFinite(tax) || tax < 0 || tax > 1) {
      setError("Tax rate must be a number between 0 and 1 (e.g. 0.25 for 25%).");
      return;
    }
    if (!Number.isFinite(levy) || levy < 0 || levy > 1) {
      setError("AIDS levy rate must be a number between 0 and 1 (e.g. 0.03 for 3%).");
      return;
    }

    setSavingId(id);
    setSavedId(null);
    try {
      const updated = await api.updateBusiness(id, {
        default_exchange_rate: rate,
        default_tax_rate: tax,
        default_aids_levy_rate: levy,
      });
      setBusinesses((prev) => prev?.map((b) => (b.id === id ? updated : b)) ?? null);
      setSavedId(id);
      setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      setError("Couldn't save those rates. Check the values and try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rate settings" className="max-w-2xl">
      <p className="text-sm text-ink-soft">
        Default exchange rate, tax rate, and AIDS levy rate per business. This
        only changes future calculations - past ones keep the exact rate that
        was used at the time.
      </p>

      <div className="mt-4">
        <ErrorNote>{error}</ErrorNote>
      </div>

      {businesses === null && <p className="mt-4 text-sm text-ink-faint">Loading...</p>}
      {businesses?.length === 0 && <p className="mt-4 text-sm text-ink-faint">No businesses yet.</p>}

      <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {businesses?.map((b) => {
          const draft = drafts[b.id];
          if (!draft) return null;
          const isCurrent = b.id === highlightBusinessId;
          return (
            <div
              key={b.id}
              ref={isCurrent ? highlightedRef : undefined}
              className={`rounded border p-4 transition-colors ${
                isCurrent ? "border-usd bg-usd-soft/40" : "border-line"
              }`}
            >
              <div className="flex items-center gap-2">
                <p className="font-medium text-ink">{b.name}</p>
                {isCurrent && (
                  <span className="rounded-full bg-usd px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-surface">
                    Viewing
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field
                  label="Exchange rate"
                  type="number"
                  step="0.01"
                  value={draft.rate}
                  onChange={(e) => updateDraft(b.id, "rate", e.target.value)}
                  hint="ZiG per 1 USD"
                />
                <Field
                  label="Tax rate"
                  type="number"
                  step="0.01"
                  value={draft.tax}
                  onChange={(e) => updateDraft(b.id, "tax", e.target.value)}
                  hint="0.25 = 25%"
                />
                <Field
                  label="AIDS levy rate"
                  type="number"
                  step="0.01"
                  value={draft.levy}
                  onChange={(e) => updateDraft(b.id, "levy", e.target.value)}
                  hint="0.03 = 3%"
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Button variant="secondary" onClick={() => saveRates(b.id)} disabled={savingId === b.id}>
                  {savingId === b.id ? "Saving..." : "Save rates"}
                </Button>
                {savedId === b.id && <span className="text-xs text-usd">Saved</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}