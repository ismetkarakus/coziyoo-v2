import { useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import type { ApiError, Language } from "../types/core";

type LatestCommissionSetting = {
  id: string;
  commissionRatePercent: number;
  createdByAdminId: string;
  createdByEmail: string | null;
  createdAt: string;
};

export default function SalesCommissionSettingsPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const [commissionRatePercent, setCommissionRatePercent] = useState("");
  const [latest, setLatest] = useState<LatestCommissionSetting | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadLatest() {
    setLoading(true);
    setError(null);
    try {
      const response = await request("/v1/admin/sales-commission-settings/latest");
      const body = await parseJson<{ data: LatestCommissionSetting | null } & ApiError>(response);
      if (response.status !== 200) {
        setError(body.error?.message ?? dict.salesCommissionSettings.loadError);
        return;
      }
      setLatest(body.data ?? null);
      if (body.data) {
        setCommissionRatePercent(String(body.data.commissionRatePercent));
      }
    } catch {
      setError(dict.salesCommissionSettings.loadError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLatest().catch(() => undefined);
  }, []);

  async function saveCommissionRate() {
    const rate = Number(commissionRatePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError(dict.salesCommissionSettings.validationError);
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await request("/v1/admin/sales-commission-settings", {
        method: "POST",
        body: JSON.stringify({ commissionRatePercent: rate }),
      });
      const body = await parseJson<{ data?: LatestCommissionSetting } & ApiError>(response);
      if (response.status !== 201) {
        setError(body.error?.message ?? dict.salesCommissionSettings.saveError);
        return;
      }
      setMessage(dict.salesCommissionSettings.saved);
      await loadLatest();
    } catch {
      setError(dict.salesCommissionSettings.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.menu.management}</p>
          <h1>{dict.salesCommissionSettings.title}</h1>
          <p className="subtext">{dict.salesCommissionSettings.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.salesCommissionSettings.formTitle}</h2>
          <span className="panel-meta">{loading ? dict.common.loading : ""}</span>
        </div>

        <div className="form-grid">
          <label>
            {dict.salesCommissionSettings.rateLabel}
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={commissionRatePercent}
              onChange={(event) => setCommissionRatePercent(event.target.value)}
              placeholder="10"
            />
          </label>
        </div>

        {latest ? (
          <p className="panel-meta">
            {`${dict.salesCommissionSettings.latestRecord}: %${latest.commissionRatePercent} • ${latest.createdByEmail ?? latest.createdByAdminId} • ${latest.createdAt.replace("T", " ").replace("Z", "").slice(0, 19)}`}
          </p>
        ) : null}

        {message ? <div className="panel-note">{message}</div> : null}
        {error ? <div className="alert">{error}</div> : null}

        <div className="topbar-actions">
          <button className="primary" type="button" disabled={saving} onClick={() => saveCommissionRate()}>
            {saving ? dict.common.loading : dict.actions.save}
          </button>
        </div>
      </section>
    </div>
  );
}
