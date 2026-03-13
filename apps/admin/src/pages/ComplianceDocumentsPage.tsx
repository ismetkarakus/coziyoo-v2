import { type FormEvent, useEffect, useState } from "react";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { formatUiDate } from "../lib/format";
import type { Language, ApiError } from "../types/core";
import type { ComplianceDocumentListRow } from "../types/api-tokens";

export default function ComplianceDocumentsPage({ language, isSuperAdmin }: { language: Language; isSuperAdmin: boolean }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<ComplianceDocumentListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createSourceInfo, setCreateSourceInfo] = useState("");
  const [createDetails, setCreateDetails] = useState("");
  const [createValidityYears, setCreateValidityYears] = useState("");
  const [createIsActive, setCreateIsActive] = useState(true);
  const [createIsRequiredDefault, setCreateIsRequiredDefault] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ComplianceDocumentListRow | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editSourceInfo, setEditSourceInfo] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editValidityYears, setEditValidityYears] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editIsRequiredDefault, setEditIsRequiredDefault] = useState(true);

  async function loadRows() {
    setLoading(true);
    try {
      const response = await request("/v1/admin/compliance/document-list");
      const body = await parseJson<{ data?: ComplianceDocumentListRow[] } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setMessage(body.error?.message ?? dict.complianceDocuments.loadFailed);
        return;
      }
      setRows(body.data);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows().catch(() => setMessage(dict.complianceDocuments.requestFailed));
  }, [dict.complianceDocuments.requestFailed]);

  function resetCreateForm() {
    setCreateCode("");
    setCreateName("");
    setCreateDescription("");
    setCreateSourceInfo("");
    setCreateDetails("");
    setCreateValidityYears("");
    setCreateIsActive(true);
    setCreateIsRequiredDefault(true);
  }

  function closeEditModal() {
    if (saving) return;
    setEditingRow(null);
    setEditDescription("");
    setEditSourceInfo("");
    setEditDetails("");
    setEditValidityYears("");
    setEditIsActive(true);
    setEditIsRequiredDefault(true);
  }

  function closeCreateModal() {
    if (saving) return;
    setIsCreateModalOpen(false);
    resetCreateForm();
  }

  function parseValidityYears(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) return Number.NaN;
    return parsed;
  }

  async function submitCreateForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin || saving) return;
    if (!createCode.trim() || !createName.trim()) {
      setMessage(dict.complianceDocuments.validationRequired);
      return;
    }
    const validityYears = parseValidityYears(createValidityYears);
    if (Number.isNaN(validityYears)) {
      setMessage(dict.complianceDocuments.validityYearsHint);
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        code: createCode.trim(),
        name: createName.trim(),
        description: createDescription.trim() || null,
        sourceInfo: createSourceInfo.trim() || null,
        details: createDetails.trim() || null,
        validityYears,
        isActive: createIsActive,
        isRequiredDefault: createIsRequiredDefault,
      };
      const response = await request("/v1/admin/compliance/document-list", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 201) {
        setMessage(body.error?.message ?? dict.complianceDocuments.saveFailed);
        return;
      }
      await loadRows();
      resetCreateForm();
      setIsCreateModalOpen(false);
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function submitEditForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin || saving || !editingRow) return;

    setSaving(true);
    setMessage(null);
    const validityYears = parseValidityYears(editValidityYears);
    if (Number.isNaN(validityYears)) {
      setSaving(false);
      setMessage(dict.complianceDocuments.validityYearsHint);
      return;
    }
    try {
      const response = await request(`/v1/admin/compliance/document-list/${editingRow.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: editDescription.trim() || null,
          sourceInfo: editSourceInfo.trim() || null,
          details: editDetails.trim() || null,
          validityYears,
          isActive: editIsActive,
          isRequiredDefault: editIsRequiredDefault,
        }),
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 200) {
        setMessage(body.error?.message ?? dict.complianceDocuments.saveFailed);
        return;
      }
      await loadRows();
      closeEditModal();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: ComplianceDocumentListRow) {
    if (!isSuperAdmin || saving) return;
    const confirmed = window.confirm(
      language === "tr"
        ? `${row.name} kaydini pasif yapmak istiyor musunuz?`
        : `Set document type ${row.name} as inactive?`
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/document-list/${row.id}`, {
        method: "DELETE",
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 200) {
        setMessage(body.error?.message ?? dict.complianceDocuments.deleteFailed);
        return;
      }
      await loadRows();
      if (editingRow?.id === row.id) closeEditModal();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: ComplianceDocumentListRow) {
    setEditingRow(row);
    setEditDescription(row.description ?? "");
    setEditSourceInfo(row.source_info ?? "");
    setEditDetails(row.details ?? "");
    setEditValidityYears(row.validity_years ? String(row.validity_years) : "");
    setEditIsActive(row.is_active);
    setEditIsRequiredDefault(row.is_required_default);
  }

  async function toggleRequiredDefault(row: ComplianceDocumentListRow) {
    if (!isSuperAdmin || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await request(`/v1/admin/compliance/document-list/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isRequiredDefault: !row.is_required_default }),
      });
      const body = await parseJson<ApiError>(response);
      if (response.status !== 200) {
        setMessage(body.error?.message ?? dict.complianceDocuments.saveFailed);
        return;
      }
      await loadRows();
      setMessage(dict.common.saved);
    } catch {
      setMessage(dict.complianceDocuments.requestFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{dict.complianceDocuments.eyebrow}</p>
          <h1>{dict.complianceDocuments.title}</h1>
          <p className="subtext">{dict.complianceDocuments.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{dict.complianceDocuments.tableTitle}</h2>
          <div className="topbar-actions">
            <button className="primary" type="button" disabled={!isSuperAdmin} onClick={() => setIsCreateModalOpen(true)}>
              {dict.actions.create}
            </button>
          </div>
        </div>
        {message ? <div className="alert">{message}</div> : null}
        <div className="buyer-ops-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.complianceDocuments.code}</th>
                <th>{dict.complianceDocuments.name}</th>
                <th>{dict.complianceDocuments.description}</th>
                <th>{dict.complianceDocuments.sourceInfo}</th>
                <th>{dict.complianceDocuments.details}</th>
                <th>{dict.complianceDocuments.validityYears}</th>
                <th>{dict.complianceDocuments.active}</th>
                <th>{dict.complianceDocuments.requiredDefault}</th>
                <th>{dict.complianceDocuments.assignedCount}</th>
                <th>{dict.complianceDocuments.updatedAt}</th>
                <th>{dict.users.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td><code>{row.code}</code></td>
                    <td>{row.name}</td>
                    <td>{row.description ?? "-"}</td>
                    <td>{row.source_info ?? "-"}</td>
                    <td>{row.details ?? "-"}</td>
                    <td>{row.validity_years ?? "-"}</td>
                    <td>{row.is_active ? dict.common.active : dict.common.disabled}</td>
                    <td>
                      <button className="ghost compliance-edit-btn" type="button" disabled={!isSuperAdmin || saving} onClick={() => void toggleRequiredDefault(row)}>
                        {row.is_required_default ? dict.complianceDocuments.requiredYes : dict.complianceDocuments.requiredNo}
                      </button>
                    </td>
                    <td>{row.seller_assignment_count}</td>
                    <td>{formatUiDate(row.updated_at, language)}</td>
                    <td>
                      <div className="legal-doc-actions">
                        <button className="ghost compliance-edit-btn" type="button" onClick={() => startEdit(row)}>
                          {dict.complianceDocuments.editAction}
                        </button>
                        <button className="ghost compliance-edit-btn" type="button" disabled={!isSuperAdmin || saving} onClick={() => void removeRow(row)}>
                          {dict.complianceDocuments.deleteAction}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isCreateModalOpen ? (
        <div className="buyer-ops-modal-backdrop">
          <div className="buyer-ops-modal">
            <h3>{dict.complianceDocuments.createDocument}</h3>
            <form className="form-grid" onSubmit={submitCreateForm}>
              <label>
                {dict.complianceDocuments.code}
                <input value={createCode} onChange={(event) => setCreateCode(event.target.value)} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.name}
                <input value={createName} onChange={(event) => setCreateName(event.target.value)} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.description}
                <textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.sourceInfo}
                <textarea value={createSourceInfo} onChange={(event) => setCreateSourceInfo(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.details}
                <textarea value={createDetails} onChange={(event) => setCreateDetails(event.target.value)} rows={4} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.validityYears}
                <input value={createValidityYears} onChange={(event) => setCreateValidityYears(event.target.value)} inputMode="numeric" disabled={!isSuperAdmin || saving} />
                <span className="panel-meta">{dict.complianceDocuments.validityYearsHint}</span>
              </label>
              <label>
                {dict.complianceDocuments.active}
                <select value={createIsActive ? "true" : "false"} onChange={(event) => setCreateIsActive(event.target.value === "true")} disabled={!isSuperAdmin || saving}>
                  <option value="true">{dict.common.active}</option>
                  <option value="false">{dict.common.disabled}</option>
                </select>
              </label>
              <label>
                {dict.complianceDocuments.requiredDefault}
                <select
                  value={createIsRequiredDefault ? "true" : "false"}
                  onChange={(event) => setCreateIsRequiredDefault(event.target.value === "true")}
                  disabled={!isSuperAdmin || saving}
                >
                  <option value="true">{dict.common.yes}</option>
                  <option value="false">{dict.common.no}</option>
                </select>
              </label>
              <div className="buyer-ops-modal-actions">
                <button className="ghost" type="button" disabled={saving} onClick={closeCreateModal}>
                  {dict.common.cancel}
                </button>
                <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                  {dict.actions.create}
                </button>
              </div>
            </form>
            {!isSuperAdmin ? <p className="panel-meta">{dict.users.onlySuperAdmin}</p> : null}
          </div>
        </div>
      ) : null}

      {editingRow ? (
        <div className="buyer-ops-modal-backdrop">
          <div className="buyer-ops-modal">
            <h3>{dict.complianceDocuments.editDocument}</h3>
            <form className="form-grid" onSubmit={submitEditForm}>
              <label>
                {dict.complianceDocuments.code}
                <input value={editingRow.code} disabled readOnly />
              </label>
              <label>
                {dict.complianceDocuments.name}
                <input value={editingRow.name} disabled readOnly />
              </label>
              <label>
                {dict.complianceDocuments.description}
                <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.sourceInfo}
                <textarea value={editSourceInfo} onChange={(event) => setEditSourceInfo(event.target.value)} rows={3} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.details}
                <textarea value={editDetails} onChange={(event) => setEditDetails(event.target.value)} rows={4} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.complianceDocuments.validityYears}
                <input value={editValidityYears} onChange={(event) => setEditValidityYears(event.target.value)} inputMode="numeric" disabled={!isSuperAdmin || saving} />
                <span className="panel-meta">{dict.complianceDocuments.validityYearsHint}</span>
              </label>
              <label>
                {dict.complianceDocuments.active}
                <select value={editIsActive ? "true" : "false"} onChange={(event) => setEditIsActive(event.target.value === "true")} disabled={!isSuperAdmin || saving}>
                  <option value="true">{dict.common.active}</option>
                  <option value="false">{dict.common.disabled}</option>
                </select>
              </label>
              <label>
                {dict.complianceDocuments.requiredDefault}
                <select value={editIsRequiredDefault ? "true" : "false"} onChange={(event) => setEditIsRequiredDefault(event.target.value === "true")} disabled={!isSuperAdmin || saving}>
                  <option value="true">{dict.common.yes}</option>
                  <option value="false">{dict.common.no}</option>
                </select>
              </label>
              <div className="buyer-ops-modal-actions">
                <button className="ghost" type="button" onClick={closeEditModal} disabled={saving}>
                  {dict.common.cancel}
                </button>
                <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                  {dict.actions.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
