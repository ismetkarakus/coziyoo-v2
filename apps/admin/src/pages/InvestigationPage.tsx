import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { ExcelExportButton, Pager, SortableHeader } from "../components/ui";
import { fmt, toDisplayId } from "../lib/format";
import { compareSortValues, compareWithDir, toggleSort, type TableSortState } from "../lib/sort";
import type { Language, ApiError } from "../types/core";

type ComplaintStatus = "open" | "in_review" | "resolved" | "closed";

type ComplaintRow = {
  id: string;
  orderNo: string;
  complainantType: "buyer" | "seller";
  complainantUserId: string;
  complainantName?: string;
  subject: string;
  categoryName?: string | null;
  createdAt: string;
  status: ComplaintStatus;
};

export default function InvestigationPage({ language }: { language: Language }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dict = DICTIONARIES[language];
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const presetBuyerId = queryParams.get("complainantBuyerId") ?? "";
  const presetComplainantType = queryParams.get("complainantType") ?? "";
  const presetComplainantUserId = queryParams.get("complainantUserId") ?? "";
  const presetSellerId = queryParams.get("sellerId") ?? "";
  const presetOpenOnly = queryParams.get("openOnly") === "true";
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ComplaintStatus>("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [tableSort, setTableSort] = useState<TableSortState<string>>({ key: null, dir: "desc" });

  const statusText = (status: ComplaintStatus) => {
    if (language === "tr") {
      if (status === "open") return dict.reviewQueue.openStatus;
      if (status === "in_review") return dict.reviewQueue.inReviewStatus;
      if (status === "resolved") return "Çözüldü";
      return "Kapandı";
    }
    if (status === "open") return dict.reviewQueue.openStatus;
    if (status === "in_review") return dict.reviewQueue.inReviewStatus;
    if (status === "resolved") return "Resolved";
    return "Closed";
  };

  const statusClass = (status: ComplaintStatus) => {
    if (status === "open") return "is-pending";
    if (status === "in_review") return "is-approved";
    if (status === "resolved") return "is-done";
    return "is-disabled";
  };

  async function downloadComplaintsAsExcel() {
    try {
      const exportQuery = new URLSearchParams({
        page: "1",
        pageSize: "5000",
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(presetBuyerId ? { complainantBuyerId: presetBuyerId } : {}),
        ...(presetComplainantType && presetComplainantUserId
          ? { complainantType: presetComplainantType, complainantUserId: presetComplainantUserId }
          : {}),
        ...(presetSellerId ? { sellerId: presetSellerId } : {}),
        ...(presetOpenOnly ? { openOnly: "true" } : {}),
        ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
      });
      const response = await request(`/v1/admin/investigations/complaints?${exportQuery.toString()}`);
      const body = await parseJson<{ data?: ComplaintRow[] } & ApiError>(response);
      if (response.status !== 200 || !body.data) {
        setError(body.error?.message ?? dict.investigation.requestFailed);
        return;
      }
      if (body.data.length === 0) {
        setError(dict.common.noRecords);
        return;
      }

      const headers = [
        dict.investigation.displayId,
        dict.investigation.orderNo,
        dict.investigation.buyer,
        dict.investigation.complaintCategory,
        dict.investigation.createdAt,
        dict.reviewQueue.status,
      ];
      const rowsForExport = body.data.map((row) => [
        toDisplayId(row.id),
        row.orderNo,
        row.complainantName ?? row.complainantUserId,
        row.categoryName ?? "-",
        new Date(row.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US"),
        statusText(row.status),
      ]);
      const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `complaints-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(dict.investigation.requestFailed);
    }
  }

  useEffect(() => {
    const loadComplaints = async () => {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(presetBuyerId ? { complainantBuyerId: presetBuyerId } : {}),
        ...(presetComplainantType && presetComplainantUserId
          ? { complainantType: presetComplainantType, complainantUserId: presetComplainantUserId }
          : {}),
        ...(presetSellerId ? { sellerId: presetSellerId } : {}),
        ...(presetOpenOnly ? { openOnly: "true" } : {}),
        ...(searchInput.trim() ? { search: searchInput.trim() } : {}),
      });

      try {
        const response = await request(`/v1/admin/investigations/complaints?${query.toString()}`);
        const body = await parseJson<{
          data?: ComplaintRow[];
          pagination?: { total: number; totalPages: number };
        } & ApiError>(response);
        if (response.status !== 200 || !body.data || !body.pagination) {
          setError(body.error?.message ?? dict.investigation.requestFailed);
          return;
        }
        setRows(body.data);
        setPagination(body.pagination);
      } catch {
        setError(dict.investigation.requestFailed);
      } finally {
        setLoading(false);
      }
    };

    loadComplaints().catch(() => setError(dict.investigation.requestFailed));
  }, [
    dict.investigation.requestFailed,
    page,
    presetBuyerId,
    presetComplainantType,
    presetComplainantUserId,
    presetSellerId,
    presetOpenOnly,
    searchInput,
    statusFilter,
  ]);

  const sortDirectionFor = (column: string) => (tableSort.key === column ? tableSort.dir : "desc");
  const sortValue = (row: ComplaintRow, column: string): string | number => {
    if (column === "display_id") return row.id;
    if (column === "created_at") {
      const parsed = Date.parse(row.createdAt);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (column === "status") return row.status;
    if (column === "order_no") return row.orderNo;
    if (column === "complainant") return row.complainantName ?? row.complainantUserId;
    return row.categoryName ?? "";
  };
  const visibleRows = useMemo(() => {
    if (!tableSort.key) return rows;
    return [...rows].sort((a, b) => {
      const result = compareWithDir(sortValue(a, tableSort.key as string), sortValue(b, tableSort.key as string), tableSort.dir);
      if (result !== 0) return result;
      return compareSortValues(a.id, b.id);
    });
  }, [rows, tableSort]);

  return (
    <div className="app investigation-page">
      <header className="topbar topbar-with-centered-search">
        <div>
          <h1>{dict.investigation.title}</h1>
          <p className="subtext">
            {presetBuyerId
              ? presetOpenOnly
                ? dict.investigation.filterBuyerOpen
                : dict.investigation.filterBuyerAll
              : presetComplainantType === "seller" && presetComplainantUserId
                ? dict.investigation.filterSellerCreated
              : presetSellerId
                ? presetOpenOnly
                  ? dict.investigation.filterSellerOpen
                  : dict.investigation.filterSellerAll
              : dict.investigation.subtitle}
          </p>
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
              value={searchInput}
              onChange={(event) => {
                setPage(1);
                setSearchInput(event.target.value);
              }}
            />
            {searchInput.trim().length > 0 ? (
              <button
                className="users-search-clear"
                type="button"
                aria-label={dict.common.clearSearch}
                onClick={() => {
                  setPage(1);
                  setSearchInput("");
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
          <select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as typeof statusFilter);
            }}
          >
            <option value="all">{dict.investigation.allStatuses}</option>
            <option value="open">{statusText("open")}</option>
            <option value="in_review">{statusText("in_review")}</option>
            <option value="resolved">{statusText("resolved")}</option>
            <option value="closed">{statusText("closed")}</option>
          </select>
          <ExcelExportButton className="primary" type="button" onClick={() => void downloadComplaintsAsExcel()} language={language} />
        </div>
      </header>

      <section className="panel">
        {error ? <div className="alert">{error}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <SortableHeader
                    label="Display ID"
                    active={tableSort.key === "display_id"}
                    dir={sortDirectionFor("display_id")}
                    onClick={() => setTableSort((prev) => toggleSort(prev, "display_id"))}
                  />
                </th>
                <th>
                  <SortableHeader
                    label={dict.investigation.orderNo}
                    active={tableSort.key === "order_no"}
                    dir={sortDirectionFor("order_no")}
                    onClick={() => setTableSort((prev) => toggleSort(prev, "order_no"))}
                  />
                </th>
                <th>
                  <SortableHeader
                    label={dict.investigation.complainant}
                    active={tableSort.key === "complainant"}
                    dir={sortDirectionFor("complainant")}
                    onClick={() => setTableSort((prev) => toggleSort(prev, "complainant"))}
                  />
                </th>
                <th>
                  <SortableHeader
                    label={dict.investigation.complaintCategory}
                    active={tableSort.key === "category"}
                    dir={sortDirectionFor("category")}
                    onClick={() => setTableSort((prev) => toggleSort(prev, "category"))}
                  />
                </th>
                <th>
                  <SortableHeader
                    label={dict.investigation.createdAt}
                    active={tableSort.key === "created_at"}
                    dir={sortDirectionFor("created_at")}
                    onClick={() => setTableSort((prev) => toggleSort(prev, "created_at"))}
                  />
                </th>
                <th>
                  <SortableHeader
                    label={dict.reviewQueue.status}
                    active={tableSort.key === "status"}
                    dir={sortDirectionFor("status")}
                    onClick={() => setTableSort((prev) => toggleSort(prev, "status"))}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>{dict.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>{dict.common.noRecords}</td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    className="investigation-click-row"
                    onClick={() => navigate(`/app/investigation/${row.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/app/investigation/${row.id}`);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td>{toDisplayId(row.id)}</td>
                    <td>{row.orderNo}</td>
                    <td>{row.complainantName ?? row.complainantUserId}</td>
                    <td>{row.categoryName ?? "-"}</td>
                    <td>{new Date(row.createdAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</td>
                    <td>
                      <span className={`status-pill ${statusClass(row.status)}`}>{statusText(row.status)}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          totalPages={pagination?.totalPages ?? 1}
          summary={fmt(dict.common.paginationSummary, {
            total: pagination?.total ?? 0,
            page,
            totalPages: Math.max(pagination?.totalPages ?? 1, 1),
          })}
          prevLabel={dict.actions.prev}
          nextLabel={dict.actions.next}
          onPageChange={setPage}
          onPrev={() => setPage((prev) => prev - 1)}
          onNext={() => setPage((prev) => prev + 1)}
        />
      </section>
    </div>
  );
}
