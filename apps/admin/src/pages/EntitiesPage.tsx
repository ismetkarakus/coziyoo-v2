import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { Pager } from "../components/ui";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId, formatTableHeader } from "../lib/format";
import { renderCell } from "../lib/table";
import type { Language, ApiError } from "../types/core";

export default function EntitiesPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const location = useLocation();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ tableKey: string; tableName: string }>>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);

  const selectedTableKey = location.pathname.split("/")[3] ?? "";

  useEffect(() => {
    request("/v1/admin/metadata/entities")
      .then(async (response) => {
        if (response.status !== 200) {
          setError(dict.entities.loadEntitiesFailed);
          return;
        }
        const body = await parseJson<{ data: Array<{ tableKey: string; tableName: string }> }>(response);
        setEntities(body.data);
        if (!selectedTableKey && body.data.length > 0) {
          navigate(`/app/entities/${body.data[0].tableKey}`, { replace: true });
        }
      })
      .catch(() => setError(dict.entities.entitiesRequestFailed));
  }, [navigate, selectedTableKey, dict.entities.entitiesRequestFailed, dict.entities.loadEntitiesFailed]);

  useEffect(() => {
    if (!selectedTableKey) return;
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortDir: "desc",
      ...(search ? { search } : {}),
    });

    request(`/v1/admin/metadata/tables/${selectedTableKey}/records?${query.toString()}`)
      .then(async (response) => {
        if (response.status !== 200) {
          const body = await parseJson<ApiError>(response);
          setError(body.error?.message ?? dict.entities.loadRecordsFailed);
          setLoading(false);
          return;
        }

        const body = await parseJson<{
          data: {
            rows: Array<Record<string, unknown>>;
            columns: string[];
          };
          pagination: {
            total: number;
            totalPages: number;
          };
        }>(response);

        setRows(body.data.rows);
        setColumns(body.data.columns);
        setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
        setLoading(false);
      })
      .catch(() => {
        setError(dict.entities.recordsRequestFailed);
        setLoading(false);
      });
  }, [selectedTableKey, page, pageSize, search, dict.entities.loadRecordsFailed, dict.entities.recordsRequestFailed]);

  const selectedEntity = entities.find((item) => item.tableKey === selectedTableKey);

  return (
    <div className="app">
      <header className="topbar topbar-with-centered-search">
        <div>
          <p className="eyebrow">{dict.entities.eyebrow}</p>
          <h1>{selectedEntity ? selectedEntity.tableName : dict.entities.titleAll}</h1>
          <p className="subtext">{dict.entities.subtitle}</p>
        </div>
        <div className="topbar-search-center">
          <div className="users-search-wrap users-search-wrap--compact">
            <span className="users-search-icon" aria-hidden="true">
              <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
                <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
                <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="users-search-input users-search-input--compact"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            {search.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
                onClick={() => {
                  setPage(1);
                  setSearch("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
        </div>
      </header>

      <section className="explorer-layout">
        <aside className="panel explorer-side">
          <div className="panel-header">
            <h2>{dict.entities.tables}</h2>
            <span className="panel-meta">{entities.length}</span>
          </div>
          <div className="entity-list">
            {entities.map((entity) => (
              <button
                key={entity.tableKey}
                className={`entity-item ${selectedTableKey === entity.tableKey ? "is-active" : ""}`}
                onClick={() => {
                  setPage(1);
                  navigate(`/app/entities/${entity.tableKey}`);
                }}
                type="button"
              >
                <span>{entity.tableKey}</span>
                <small>{entity.tableName}</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="panel">
          {error ? <div className="alert">{error}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                  {columns.map((column) => (
                    <th key={column}>{formatTableHeader(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={Math.max(columns.length + 1, 1)}>{dict.common.loading}</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(columns.length + 1, 1)}>{dict.common.noRecords}</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${selectedTableKey}-${index}`}>
                      <td>{toDisplayId(row.id ?? row.order_id ?? row.food_id ?? "")}</td>
                      {columns.map((column) => (
                        <td key={`${index}-${column}`}>{renderCell(row[column], column)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            totalPages={pagination?.totalPages ?? 1}
            summary={fmt(dict.common.paginationSummary, { total: pagination?.total ?? 0, page, totalPages: Math.max(pagination?.totalPages ?? 1, 1) })}
            prevLabel={dict.actions.prev}
            nextLabel={dict.actions.next}
            onPrev={() => setPage((prev) => prev - 1)}
            onNext={() => setPage((prev) => prev + 1)}
          />
        </section>
      </section>
    </div>
  );
}
