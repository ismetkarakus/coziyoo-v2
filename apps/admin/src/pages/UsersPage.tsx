import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { Pager, KpiCard, ExcelExportButton, SortableHeader } from "../components/ui";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId, formatCurrency, formatLoginRelativeDayMonth } from "../lib/format";
import { SELLER_SMART_FILTER_ITEMS } from "../lib/constants";
import { AppUserFormSchema, AdminUserFormSchema } from "../lib/forms";
import { compareSortValues, compareWithDir, toggleSort, type SortDir } from "../lib/sort";
import type { Language, ApiError } from "../types/core";
import type { UserKind, ColumnMeta, DensityMode } from "../types/users";
import type { SellerSmartFilterKey } from "../types/seller";

type SellerTableSortKey = "id" | "name" | "status" | "warnings" | "orderHealth" | "ratingTrend";
type BuyerTableSortKey = "id" | "buyer" | "col4" | "col5" | "col6" | "col7" | "col8" | "status";

function UsersPage({ kind, isSuperAdmin, language }: { kind: UserKind; isSuperAdmin: boolean; language: Language }) {
  const dict = DICTIONARIES[language];
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [isColumnsModalOpen, setIsColumnsModalOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [last7DaysOnly, setLast7DaysOnly] = useState(false);
  const [sellerStatusFilter, setSellerStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [activeSellerKpiFilter, setActiveSellerKpiFilter] = useState<"all" | "active" | "disabled" | "new_today" | null>(null);
  const [sellerDailySales, setSellerDailySales] = useState<number | null>(null);
  const [isSellerTableOpen, setIsSellerTableOpen] = useState(false);
  const [buyerFilters, setBuyerFilters] = useState<{
    status: "all" | "active" | "disabled";
    complaint: "all" | "has_unresolved" | "resolved_only" | "no_complaint";
    orderTrend: "all" | "up" | "down";
    spendTrend: "all" | "up" | "down";
  }>({
    status: "all",
    complaint: "all",
    orderTrend: "all",
    spendTrend: "all",
  });
  const [buyerFilterDraft, setBuyerFilterDraft] = useState<{
    status: "all" | "active" | "disabled";
    complaint: "all" | "has_unresolved" | "resolved_only" | "no_complaint";
    orderTrend: "all" | "up" | "down";
    spendTrend: "all" | "up" | "down";
  }>({
    status: "all",
    complaint: "all",
    orderTrend: "all",
    spendTrend: "all",
  });
  const [buyerQuickFilter, setBuyerQuickFilter] = useState<"all" | "active" | "risky" | "open_complaint" | "down_spend" | null>(null);
  const [activeSellerSmartFilter, setActiveSellerSmartFilter] = useState<SellerSmartFilterKey | null>(null);
  const [buyerSelectedIds, setBuyerSelectedIds] = useState<string[]>([]);
  const [buyerActionMenuId, setBuyerActionMenuId] = useState<string | null>(null);
  const [buyerTotalCountAll, setBuyerTotalCountAll] = useState<number | null>(null);
  const buyerBoardRef = useRef<HTMLDivElement | null>(null);
  const [customerIdPreview, setCustomerIdPreview] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ id: string; next: "active" | "disabled" } | null>(null);
  const [density, setDensity] = useState<DensityMode>(() => {
    const stored = localStorage.getItem(`coziyoo_users_density_${kind}`) as DensityMode | null;
    if (stored === "compact" || stored === "normal" || stored === "comfortable") return stored;
    return "normal";
  });
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    sortBy: "createdAt",
    sortDir: "desc" as "asc" | "desc",
    status: "all",
    roleFilter: "all",
  });
  const navigate = useNavigate();

  const isAppScoped = kind === "app" || kind === "buyers" || kind === "sellers";
  const isSellerPage = kind === "sellers";
  const isBuyerPage = kind === "buyers";
  const endpoint = isAppScoped ? "/v1/admin/users" : "/v1/admin/admin-users";
  const tableKey = isAppScoped ? "users" : "adminUsers";
  const audience = kind === "buyers" ? "buyer" : kind === "sellers" ? "seller" : null;
  const [fields, setFields] = useState<ColumnMeta[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [sellerTableSort, setSellerTableSort] = useState<{ key: SellerTableSortKey | null; dir: SortDir }>({
    key: null,
    dir: "desc",
  });
  const [buyerTableSort, setBuyerTableSort] = useState<{ key: BuyerTableSortKey | null; dir: SortDir }>({
    key: null,
    dir: "desc",
  });

  const columnMappings = useMemo(() => {
    if (isAppScoped) {
      return {
        id: "id",
        email: "email",
        phone: "phone",
        display_name: "displayName",
        full_name: "fullName",
        total_foods: "totalFoods",
        user_type: "role",
        is_active: "status",
        country_code: "countryCode",
        language: "language",
        created_at: "createdAt",
        updated_at: "updatedAt",
      } as Record<string, string>;
    }

    return {
      id: "id",
      email: "email",
      role: "role",
      is_active: "status",
      created_at: "createdAt",
      updated_at: "updatedAt",
      last_login_at: "lastLoginAt",
    } as Record<string, string>;
  }, [isAppScoped]);

  const coreColumns = useMemo(() => {
    return isAppScoped
      ? ["id", "display_name", "email", "phone", "is_active", "country_code", "language", "created_at", "updated_at"]
      : ["id", "email", "role", "is_active", "created_at", "updated_at", "last_login_at"];
  }, [isAppScoped]);
  const sellerDefaultColumns = useMemo(
    () => ["display_name", "email", "phone", "id", "total_foods", "status", "language", "created_at", "updated_at"],
    []
  );

  const pageTitle =
    kind === "app" ? dict.users.titleApp : kind === "buyers" ? dict.users.titleBuyers : kind === "sellers" ? dict.users.titleSellers : dict.users.titleAdmins;
  const pageTitleView = isSellerPage ? dict.users.titleSellers : pageTitle;
  const unifiedSearchPlaceholder =
    isSellerPage
      ? dict.users.v2.sellerSearchPlaceholder
      : dict.users.v2.globalSearchPlaceholder;
  const renderUnifiedSearch = (compact = false) => (
    <div className={`users-search-wrap ${compact ? "users-search-wrap--compact" : ""}`.trim()}>
      <span className="users-search-icon" aria-hidden="true">
        <svg className="users-search-icon-svg" viewBox="0 0 24 24" fill="none" role="presentation">
          <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="2" />
          <path d="M16.7 16.7L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <input
        className={`users-search-input ${compact ? "users-search-input--compact" : ""}`.trim()}
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        placeholder={unifiedSearchPlaceholder}
      />
      {searchInput.trim().length > 0 ? (
        <button
          className="users-search-clear"
          type="button"
          aria-label={dict.common.clearSearch}
          onClick={() => setSearchInput("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
  const isDrawerOpen = drawerMode !== null;
  const createTitle =
    isAppScoped
      ? kind === "buyers"
        ? dict.users.createBuyer
        : kind === "sellers"
          ? dict.users.createSeller
          : dict.users.createAppUser
      : dict.users.createAdmin;

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      page: 1,
      sortBy: kind === "sellers" ? "updatedAt" : "createdAt",
      roleFilter: "all",
      status: "all",
    }));
    setSellerStatusFilter("all");
    setBuyerFilters({
      status: "all",
      complaint: "all",
      orderTrend: "all",
      spendTrend: "all",
    });
    setBuyerFilterDraft({
      status: "all",
      complaint: "all",
      orderTrend: "all",
      spendTrend: "all",
    });
    setBuyerQuickFilter(null);
    setBuyerTotalCountAll(null);
    setActiveSellerSmartFilter(null);
    setBuyerActionMenuId(null);
    setCustomerIdPreview(null);
    setSellerTableSort({ key: null, dir: "desc" });
    setBuyerTableSort({ key: null, dir: "desc" });
  }, [kind]);

  useEffect(() => {
    localStorage.setItem(`coziyoo_users_density_${kind}`, density);
  }, [density, kind]);

  useEffect(() => {
    request(`/v1/admin/metadata/tables/${tableKey}/fields`).then(async (response) => {
      if (response.status !== 200) return;
      const body = await parseJson<{ data: { fields: Array<{ name: string; displayable?: boolean; sensitivity?: ColumnMeta["sensitivity"] }> } }>(
        response
      );
      const metas = body.data.fields
        .map((f) => ({
          name: f.name,
          displayable: f.displayable !== false && f.sensitivity !== "secret",
          sensitivity: f.sensitivity ?? "public",
        }))
        .filter((f) => f.displayable && columnMappings[f.name]);
      setFields(metas);
      const defaultColumns = (isSellerPage ? sellerDefaultColumns : coreColumns).filter((column) => metas.some((meta) => meta.name === column));

      const prefs = await request(`/v1/admin/table-preferences/${tableKey}`);
      if (prefs.status === 200) {
        const prefBody = await parseJson<{ data: { visibleColumns: string[] } }>(prefs);
        const normalized = prefBody.data.visibleColumns.filter((column) => metas.some((meta) => meta.name === column));
        setVisibleColumns(normalized.length > 0 ? normalized : defaultColumns);
      } else {
        setVisibleColumns(defaultColumns);
      }
    });
  }, [columnMappings, coreColumns, isSellerPage, sellerDefaultColumns, tableKey]);

  async function loadRows() {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      ...(searchTerm ? { search: searchTerm } : {}),
      ...(audience ? { audience } : {}),
      ...(isAppScoped && filters.roleFilter !== "all" ? { userType: filters.roleFilter } : {}),
      ...(!isAppScoped && filters.roleFilter !== "all" ? { role: filters.roleFilter } : {}),
    });

    const response = await request(`${endpoint}?${query.toString()}`);
    const body = await parseJson<{ data?: any[]; pagination?: { total: number; totalPages: number } } & ApiError>(response);

    if (response.status !== 200 || !body.data) {
      setError(body.error?.message ?? dict.users.loadFailed);
      setLoading(false);
      return;
    }

    setRows(body.data);
    if (body.pagination) setPagination({ total: body.pagination.total, totalPages: body.pagination.totalPages });
    if (isBuyerPage && body.pagination && !searchTerm) {
      setBuyerTotalCountAll(body.pagination.total);
    }
    setLastUpdatedAt(new Date().toISOString());
    setLoading(false);
  }

  useEffect(() => {
    loadRows().catch(() => setError(dict.users.requestFailed));
  }, [filters.page, filters.pageSize, filters.sortBy, filters.sortDir, filters.roleFilter, audience, searchTerm, isBuyerPage]);

  useEffect(() => {
    if (!isSellerPage) return;
    request("/v1/admin/users/sellers/daily-sales")
      .then(async (response) => {
        if (response.status !== 200) return;
        const body = await parseJson<{ data?: { dailySales?: number } }>(response);
        setSellerDailySales(Number(body.data?.dailySales ?? 0));
      })
      .catch(() => setSellerDailySales(null));
  }, [isSellerPage]);

  useEffect(() => {
    if (!isSellerPage) return;
    setIsSellerTableOpen(false);
  }, [isSellerPage]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length === 0) {
      setSearchTerm("");
      setFilters((prev) => ({ ...prev, page: 1 }));
      return;
    }
    const minSearchLength = isSellerPage ? 1 : 3;
    if (trimmed.length < minSearchLength) return;

    const timer = window.setTimeout(() => {
      setSearchTerm(trimmed);
      setFilters((prev) => ({ ...prev, page: 1 }));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [isSellerPage, searchInput]);

  async function savePreferences() {
    const defaultColumns = (isSellerPage ? sellerDefaultColumns : coreColumns).filter((column) => fields.some((f) => f.name === column));
    const payload = visibleColumns.length > 0 ? visibleColumns : defaultColumns;
    const response = await request(`/v1/admin/table-preferences/${tableKey}`, {
      method: "PUT",
      body: JSON.stringify({ visibleColumns: payload, columnOrder: payload }),
    });

    if (response.status !== 200) {
      setError(dict.users.preferencesFailed);
      return;
    }
    setIsColumnsModalOpen(false);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    const formData = new FormData(event.currentTarget);

    try {
      if (isAppScoped) {
        const payload = {
          email: String(formData.get("email") ?? ""),
          password: String(formData.get("password") ?? ""),
          displayName: String(formData.get("displayName") ?? ""),
          userType:
            kind === "buyers"
              ? "buyer"
              : kind === "sellers"
                ? "seller"
                : (String(formData.get("userType") ?? "buyer") as "buyer" | "seller" | "both"),
        };
        const parsed = AppUserFormSchema.safeParse(payload);
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? dict.users.validationFailed);
          return;
        }

        const create = await request(endpoint, {
          method: "POST",
          body: JSON.stringify(parsed.data),
        });

        if (create.status !== 201) {
          const body = await parseJson<ApiError>(create);
          setFormError(body.error?.message ?? dict.users.createFailed);
          return;
        }
      } else {
        const payload = {
          email: String(formData.get("email") ?? ""),
          password: String(formData.get("password") ?? ""),
          role: String(formData.get("role") ?? "admin") as "admin" | "super_admin",
        };
        const parsed = AdminUserFormSchema.safeParse(payload);
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? dict.users.validationFailed);
          return;
        }

        const create = await request(endpoint, {
          method: "POST",
          body: JSON.stringify(parsed.data),
        });

        if (create.status !== 201) {
          const body = await parseJson<ApiError>(create);
          setFormError(body.error?.message ?? dict.users.createFailed);
          return;
        }
      }

      await loadRows();
      setDrawerMode(null);
      setEditingRow(null);
      setFormError(null);
      (event.currentTarget as HTMLFormElement).reset();
    } finally {
      setSaving(false);
    }
  }

  async function patchUser(rowId: string, path: string, payload: unknown) {
    const response = await request(`${endpoint}/${rowId}/${path}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      const body = await parseJson<ApiError>(response);
      setError(body.error?.message ?? dict.users.updateFailed);
      return;
    }

    await loadRows();
  }

  function toggleStatusAction(row: any) {
    const currentStatus: "active" | "disabled" = row.status === "disabled" || row.is_active === false ? "disabled" : "active";
    setPendingStatusChange({
      id: row.id,
      next: currentStatus === "active" ? "disabled" : "active",
    });
  }

  async function confirmStatusChange() {
    if (!pendingStatusChange) return;
    await patchUser(pendingStatusChange.id, "status", { status: pendingStatusChange.next });
    setPendingStatusChange(null);
  }

  function openCreateDrawer() {
    setFormError(null);
    setEditingRow(null);
    setDrawerMode("create");
  }

  function openEditDrawer(row: any) {
    setFormError(null);
    setEditingRow(row);
    setDrawerMode("edit");
  }

  function closeDrawer() {
    if (saving) return;
    setDrawerMode(null);
    setEditingRow(null);
    setFormError(null);
  }

  async function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRow) return;
    setFormError(null);
    setSaving(true);

    try {
      const formData = new FormData(event.currentTarget);
      const payload: Record<string, string> = {
        email: String(formData.get("email") ?? "").trim(),
      };
      const password = String(formData.get("password") ?? "").trim();
      if (password) payload.password = password;

      if (!payload.email) {
        setFormError(dict.users.validationFailed);
        return;
      }

      const update = await request(`${endpoint}/${editingRow.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (update.status !== 200) {
        const body = await parseJson<ApiError>(update);
        setFormError(body.error?.message ?? dict.users.updateFailed);
        return;
      }

      await loadRows();
      closeDrawer();
    } finally {
      setSaving(false);
    }
  }

  const availableColumns = useMemo(() => fields.map((f) => f.name), [fields]);
  const tableColumns = useMemo(() => {
    const picked = visibleColumns.filter((column) => availableColumns.includes(column));
    if (isSellerPage) {
      if (picked.length > 0) return picked;
      return sellerDefaultColumns.filter((column) => availableColumns.includes(column));
    }
    if (picked.length > 0) return picked;
    return coreColumns.filter((column) => availableColumns.includes(column));
  }, [availableColumns, coreColumns, isSellerPage, sellerDefaultColumns, visibleColumns]);

  const activeRows = rows.filter((row) => row.status === "active");
  const passiveRows = rows.filter((row) => row.status === "disabled");
  const trRows = rows.filter((row) => String(row.countryCode ?? "").toUpperCase() === "TR");
  const todayKey = new Date().toISOString().slice(0, 10);
  const newToday = trRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey).length;
  const trendDirection = (current: number, previous: number): "up" | "down" | "flat" => {
    if (current > previous) return "up";
    if (current < previous) return "down";
    return "flat";
  };
  const computeBuyerRisk = (row: any): { level: "low" | "medium" | "high"; score: number } => {
    const unresolved = Number(row.complaintUnresolved ?? 0);
    const totalComplaints = Number(row.complaintTotal ?? 0);
    const orderTrend = trendDirection(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0));
    const spendTrend = trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0));
    let score = 0;
    score += Math.min(unresolved, 2) * 30;
    if (totalComplaints >= 2) score += 15;
    if (orderTrend === "down") score += 12;
    if (spendTrend === "down") score += 12;
    if (row.status === "disabled") score += 10;
    if (score >= 70) return { level: "high", score };
    if (score >= 35) return { level: "medium", score };
    return { level: "low", score };
  };
  const buyersWithOpenComplaints = rows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0).length;
  const riskyBuyersCount = rows.filter((row) => computeBuyerRisk(row).level !== "low").length;
  const totalBuyersCount = buyerTotalCountAll ?? pagination?.total ?? rows.length;
  const totalRevenue30d = rows.reduce((acc, row) => acc + Number(row.monthlySpentCurrent ?? 0), 0);
  const activeRatio = totalBuyersCount > 0 ? Math.round((activeRows.length / totalBuyersCount) * 100) : 0;
  const buyerRevenue = (row: any): number => Number(row.monthlySpentCurrent ?? row.totalSpent ?? row.totalRevenue ?? row.revenue ?? 0);
  const buyerLatestComplaintSubject = (row: any): string =>
    String(row.latestComplaintSubject ?? row.latestComplaintCategoryName ?? "").trim();
  const buyerLatestComplaintReason = (row: any): string =>
    String(row.latestComplaintDescription ?? row.latestComplaintSubject ?? row.latestComplaintCategoryName ?? "").trim();
  const buyerLatestComplaintSeller = (row: any): string =>
    String(row.latestComplaintSellerName ?? row.latestComplaintSellerEmail ?? row.latestComplaintSellerId ?? "").trim();
  const buyerLatestComplaintId = (row: any): string => String(row.latestComplaintId ?? "").trim();
  const buyerSuspiciousReason = (row: any): string => {
    const reasons: string[] = [];
    const ipCount = Number(row.recentLoginIpCount24h ?? 0);
    const loginCount = Number(row.recentLoginCount24h ?? 0);
    if (ipCount >= 2) reasons.push(`${ipCount} ${dict.users.v2.suspiciousDifferentIp}`);
    if (row.recentLoginLocationSpread) reasons.push(dict.users.v2.suspiciousHighLocationDiff);
    if (loginCount >= 2) reasons.push(`${loginCount} ${dict.users.v2.suspiciousLoginsPer24h}`);
    return reasons.join(" • ");
  };
  const buyerSharedIp = (row: any): string => String(row.recentLoginSharedIp ?? row.recentLoginPrimaryIp ?? "").trim();
  const buyerLatestComplaintCreatedAtMs = (row: any): number => {
    const parsed = Date.parse(String(row.latestComplaintCreatedAt ?? ""));
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const buyerLatestComplaintStatusLabel = (row: any): string => {
    const value = String(row.latestComplaintStatus ?? "").trim().toLowerCase();
    if (value === "open") return dict.users.v2.complaintStatusOpen;
    if (value === "in_review") return dict.users.v2.complaintStatusInReview;
    if (value === "resolved") return dict.users.v2.complaintStatusResolved;
    if (value === "closed") return dict.users.v2.complaintStatusClosed;
    return Number(row.complaintUnresolved ?? 0) > 0 ? dict.users.v2.complaintStatusOpen : dict.users.v2.complaintStatusClosed;
  };
  const sellerHeaderSort = (key: SellerTableSortKey) => {
    setSellerTableSort((prev) => toggleSort(prev, key));
  };
  const buyerHeaderSort = (key: BuyerTableSortKey) => {
    setBuyerTableSort((prev) => toggleSort(prev, key));
  };
  const sellerSortDirectionFor = (key: SellerTableSortKey): SortDir =>
    sellerTableSort.key === key ? sellerTableSort.dir : "desc";
  const buyerSortDirectionFor = (key: BuyerTableSortKey): SortDir =>
    buyerTableSort.key === key ? buyerTableSort.dir : "desc";
  const buyerSortValue = (row: any, key: BuyerTableSortKey): string | number => {
    if (key === "id") return String(row.id ?? "");
    if (key === "buyer") return String(row.displayName ?? row.email ?? "");
    if (key === "status") return row.status === "active" ? 1 : 0;
    if (key === "col4") {
      if (buyerQuickFilter === "open_complaint") return Number(row.complaintTotal ?? 0);
      return computeBuyerRisk(row).score;
    }
    if (key === "col5") {
      if (buyerQuickFilter === "open_complaint") return Number(row.complaintUnresolved ?? 0);
      return Number(row.complaintTotal ?? 0);
    }
    if (key === "col6") {
      if (buyerQuickFilter === "open_complaint") return buyerLatestComplaintId(row);
      return Number(row.monthlyOrderCountCurrent ?? 0);
    }
    if (key === "col7") {
      if (buyerQuickFilter === "open_complaint") return buyerLatestComplaintCreatedAtMs(row);
      return Number(row.monthlySpentCurrent ?? 0);
    }
    if (buyerQuickFilter === "open_complaint") {
      return Number(row.complaintUnresolved ?? 0) > 0 ? 1 : 0;
    }
    return Date.parse(String(row.lastOnlineAt ?? row.lastLoginAt ?? row.last_login_at ?? "")) || 0;
  };
  const sellerRevenue = (row: any): number => Number(row.monthlyRevenue ?? row.monthlySpentCurrent ?? row.totalRevenue ?? row.revenue ?? 0);
  const sellerOrderCurrent = (row: any): number => Number(row.monthlyOrderCountCurrent ?? row.orderCount30d ?? row.totalOrders ?? 0);
  const sellerOrderPrevious = (row: any): number => Number(row.monthlyOrderCountPrevious ?? row.orderCountPrev30d ?? 0);
  const sellerTotalFoods = (row: any): number => Number(row.totalFoods ?? 0);
  const sellerComplaintTotal = (row: any): number => Number(row.complaintTotal ?? row.openComplaintCount ?? 0);
  const sellerComplaintUnresolved = (row: any): number => Number(row.complaintUnresolved ?? row.openComplaintCount ?? 0);
  const sellerComplaintMadeTotal = (row: any): number => Number(row.complaintMadeTotal ?? 0);
  const sellerMissingDoc = (row: any): number => Number(row.missingDocCount ?? row.missingDocuments ?? 0);
  const sellerSuspiciousLogin = (row: any): number =>
    Number(row.suspiciousLoginCount ?? row.loginAnomalyCount ?? row.sameIpAccountCount ?? row.sameIpEntryCount ?? 0);
  const sellerApprovalText = (row: any): string => String(row.approvalStatus ?? row.complianceStatus ?? "").toLowerCase();
  const sellerRating = (row: any): number => Number(row.avgRating ?? row.ratingAverage ?? row.rating ?? 0);
  const sellerTopRevenueThreshold = useMemo(() => {
    const revenues = trRows.map((row) => sellerRevenue(row)).filter((value) => value > 0).sort((a, b) => b - a);
    if (revenues.length === 0) return Number.POSITIVE_INFINITY;
    const topIndex = Math.max(0, Math.ceil(revenues.length * 0.2) - 1);
    return revenues[topIndex] ?? Number.POSITIVE_INFINITY;
  }, [trRows]);
  const sellerTopSellingFoodsOrderThreshold = useMemo(() => {
    const orderCounts = trRows
      .filter((row) => sellerTotalFoods(row) > 0)
      .map((row) => sellerOrderCurrent(row))
      .filter((value) => value > 0)
      .sort((a, b) => b - a);
    if (orderCounts.length === 0) return Number.POSITIVE_INFINITY;
    const topIndex = Math.max(0, Math.ceil(orderCounts.length * 0.2) - 1);
    return orderCounts[topIndex] ?? Number.POSITIVE_INFINITY;
  }, [trRows]);
  const sellerRiskMeta = (row: any): { level: "low" | "medium" | "high"; score: number } => {
    let score = 0;
    score += Math.min(sellerComplaintUnresolved(row), 3) * 24;
    score += Math.min(sellerSuspiciousLogin(row), 2) * 22;
    score += Math.min(sellerMissingDoc(row), 2) * 18;
    if (sellerOrderCurrent(row) < sellerOrderPrevious(row)) score += 14;
    if (row.status === "disabled") score += 18;
    if (score >= 70) return { level: "high", score };
    if (score >= 35) return { level: "medium", score };
    return { level: "low", score };
  };
  const matchSellerSmartFilter = (row: any, key: SellerSmartFilterKey): boolean => {
    if (key === "login_anomaly") return true;
    if (key === "pending_approvals") return /(pending|review|in_progress|submitted)/.test(sellerApprovalText(row));
    if (key === "missing_documents") return sellerMissingDoc(row) > 0;
    if (key === "suspicious_logins") return sellerSuspiciousLogin(row) > 0;
    if (key === "complaining_sellers") return sellerComplaintMadeTotal(row) > 0;
    if (key === "top_selling_foods") {
      return sellerTotalFoods(row) > 0 && sellerOrderCurrent(row) >= sellerTopSellingFoodsOrderThreshold && sellerOrderCurrent(row) > 0;
    }
    if (key === "top_revenue") return sellerRevenue(row) >= sellerTopRevenueThreshold && sellerRevenue(row) > 0;
    if (key === "performance_drop") return sellerOrderCurrent(row) < sellerOrderPrevious(row);
    if (key === "urgent_action") return sellerRiskMeta(row).level === "high";
    return sellerComplaintTotal(row) > 0;
  };
  const sortSellerRowsForSmartFilter = (rowsToSort: any[], key: SellerSmartFilterKey): any[] => {
    const scopedRows = [...rowsToSort];
    if (key === "top_revenue") {
      return scopedRows.sort((a, b) => sellerRevenue(b) - sellerRevenue(a));
    }
    if (key === "top_selling_foods") {
      return scopedRows.sort((a, b) => sellerOrderCurrent(b) - sellerOrderCurrent(a));
    }
    if (key === "complaining_sellers") {
      return scopedRows.sort((a, b) => sellerComplaintMadeTotal(b) - sellerComplaintMadeTotal(a));
    }
    if (key === "urgent_action") {
      return scopedRows.sort((a, b) => sellerRiskMeta(b).score - sellerRiskMeta(a).score);
    }
    if (key === "complainer_sellers") {
      return scopedRows.sort((a, b) => sellerComplaintTotal(b) - sellerComplaintTotal(a));
    }
    if (key === "missing_documents") {
      return scopedRows.sort((a, b) => sellerMissingDoc(b) - sellerMissingDoc(a));
    }
    if (key === "suspicious_logins") {
      return scopedRows.sort((a, b) => sellerSuspiciousLogin(b) - sellerSuspiciousLogin(a));
    }
    if (key === "performance_drop") {
      return scopedRows.sort((a, b) => (sellerOrderPrevious(b) - sellerOrderCurrent(b)) - (sellerOrderPrevious(a) - sellerOrderCurrent(a)));
    }
    return scopedRows;
  };
  const sellerSmartFilterCounts = useMemo(
    () =>
      SELLER_SMART_FILTER_ITEMS.reduce(
        (acc, item) => {
          acc[item.key] = trRows.filter((row) => matchSellerSmartFilter(row, item.key)).length;
          return acc;
        },
        {
          login_anomaly: 0,
          pending_approvals: 0,
          missing_documents: 0,
          suspicious_logins: 0,
          complaining_sellers: 0,
          top_selling_foods: 0,
          top_revenue: 0,
          performance_drop: 0,
          urgent_action: 0,
          complainer_sellers: 0,
        } as Record<SellerSmartFilterKey, number>
      ),
    [trRows, sellerTopRevenueThreshold, sellerTopSellingFoodsOrderThreshold]
  );
  const filteredRows = useMemo(() => {
    let scopedRows = rows;
    if (isSellerPage) {
      scopedRows = scopedRows.filter((row) => String(row.countryCode ?? "").toUpperCase() === "TR");
      if (activeSellerKpiFilter === "new_today") {
        scopedRows = scopedRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey);
      }
      if (sellerStatusFilter !== "all") {
        scopedRows = scopedRows.filter((row) => row.status === sellerStatusFilter);
      }
      if (activeSellerSmartFilter) {
        scopedRows = scopedRows.filter((row) => matchSellerSmartFilter(row, activeSellerSmartFilter));
        scopedRows = sortSellerRowsForSmartFilter(scopedRows, activeSellerSmartFilter);
      }

      const sellerQuery = searchInput.trim().toLocaleLowerCase("tr-TR");
      if (sellerQuery.length > 0) {
        const queryCompact = sellerQuery.replace(/\s+/g, "");
        const rankText = (raw: unknown): number => {
          const text = String(raw ?? "").trim().toLocaleLowerCase("tr-TR");
          if (!text) return 0;
          const compact = text.replace(/\s+/g, "");
          if (text === sellerQuery || compact === queryCompact) return 120;
          if (text.startsWith(sellerQuery) || compact.startsWith(queryCompact)) return 95;
          const index = text.indexOf(sellerQuery);
          if (index >= 0) return Math.max(55 - index * 2, 12);
          const compactIndex = compact.indexOf(queryCompact);
          if (compactIndex >= 0) return Math.max(38 - compactIndex, 10);
          return 0;
        };
        const rankSeller = (row: any): number => {
          const nameScore = rankText(row.displayName);
          const emailScore = rankText(row.email);
          const idScore = rankText(row.id);
          const phoneScore = rankText(row.phone ?? row.phoneNumber ?? row.contactPhone);
          return Math.max(nameScore, emailScore, idScore, phoneScore);
        };
        scopedRows = [...scopedRows]
          .map((row, index) => ({ row, score: rankSeller(row), index }))
          .sort((a, b) => (b.score - a.score) || (a.index - b.index))
          .map((item) => item.row);
      }
      if (sellerTableSort.key) {
        scopedRows = [...scopedRows].sort((a, b) => {
          if (sellerTableSort.key === "id") {
            return compareWithDir(String(a.id ?? ""), String(b.id ?? ""), sellerTableSort.dir);
          }
          if (sellerTableSort.key === "name") {
            return compareWithDir(
              String(a.displayName ?? a.email ?? ""),
              String(b.displayName ?? b.email ?? ""),
              sellerTableSort.dir
            );
          }
          if (sellerTableSort.key === "status") {
            return compareWithDir(a.status === "active" ? 1 : 0, b.status === "active" ? 1 : 0, sellerTableSort.dir);
          }
          if (sellerTableSort.key === "warnings") {
            const left = (sellerComplaintUnresolved(a) * 100) + (sellerSuspiciousLogin(a) * 10) + sellerMissingDoc(a);
            const right = (sellerComplaintUnresolved(b) * 100) + (sellerSuspiciousLogin(b) * 10) + sellerMissingDoc(b);
            return compareWithDir(left, right, sellerTableSort.dir);
          }
          if (sellerTableSort.key === "orderHealth") {
            const left = sellerOrderCurrent(a) * 1_000_000 + sellerRevenue(a);
            const right = sellerOrderCurrent(b) * 1_000_000 + sellerRevenue(b);
            return compareWithDir(left, right, sellerTableSort.dir);
          }
          const left = Number(a.ratingTrend ?? a.ratingDelta ?? 0);
          const right = Number(b.ratingTrend ?? b.ratingDelta ?? 0);
          return compareWithDir(left, right, sellerTableSort.dir);
        });
      }
    }

    if (isBuyerPage) {
      if (buyerFilters.status !== "all") {
        scopedRows = scopedRows.filter((row) => row.status === buyerFilters.status);
      }
      if (buyerFilters.complaint === "has_unresolved") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
      } else if (buyerFilters.complaint === "resolved_only") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintTotal ?? 0) > 0 && Number(row.complaintUnresolved ?? 0) === 0);
      } else if (buyerFilters.complaint === "no_complaint") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintTotal ?? 0) === 0);
      }
      if (buyerFilters.orderTrend !== "all") {
        scopedRows = scopedRows.filter(
          (row) => trendDirection(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)) === buyerFilters.orderTrend
        );
      }
      if (buyerFilters.spendTrend !== "all") {
        scopedRows = scopedRows.filter(
          (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === buyerFilters.spendTrend
        );
      }
      if (buyerQuickFilter === "risky") {
        scopedRows = scopedRows.filter((row) => computeBuyerRisk(row).level !== "low");
      } else if (buyerQuickFilter === "active") {
        scopedRows = scopedRows.filter((row) => row.status === "active");
      } else if (buyerQuickFilter === "open_complaint") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
      }
      if (buyerQuickFilter === "open_complaint") {
        scopedRows = [...scopedRows].sort(
          (a, b) =>
            Number(b.complaintUnresolved ?? 0) - Number(a.complaintUnresolved ?? 0) ||
            buyerLatestComplaintCreatedAtMs(b) - buyerLatestComplaintCreatedAtMs(a)
        );
      }
      if (buyerTableSort.key) {
        scopedRows = [...scopedRows].sort((a, b) => {
          const result = compareWithDir(
            buyerSortValue(a, buyerTableSort.key as BuyerTableSortKey),
            buyerSortValue(b, buyerTableSort.key as BuyerTableSortKey),
            buyerTableSort.dir
          );
          if (result !== 0) return result;
          return compareSortValues(String(a.id ?? ""), String(b.id ?? ""));
        });
      }
    }

    if (!last7DaysOnly) return scopedRows;
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return scopedRows.filter((row) => {
      const created = Date.parse(String(row.createdAt ?? ""));
      return !Number.isNaN(created) && now - created <= sevenDays;
    });
  }, [
    activeSellerKpiFilter,
    activeSellerSmartFilter,
    buyerFilters,
    buyerQuickFilter,
    buyerTableSort,
    isBuyerPage,
    isSellerPage,
    last7DaysOnly,
    rows,
    searchInput,
    sellerStatusFilter,
    sellerTableSort,
    todayKey,
  ]);

  function resolveColumnLabel(columnName: string): string {
    const mapped = columnMappings[columnName] ?? columnName;
    if (mapped === "id") return "ID";
    if (mapped === "displayName") return isSellerPage ? dict.users.v2.columnSellerName : dict.users.v2.columnFullName;
    if (mapped === "email") return dict.users.v2.columnEmail;
    if (mapped === "phone") return dict.users.v2.columnPhone;
    if (mapped === "status") return dict.users.status;
    if (mapped === "totalFoods") return dict.users.v2.columnFoods;
    if (mapped === "role") return dict.users.role;
    if (mapped === "countryCode") return dict.users.v2.columnCountry;
    if (mapped === "language") return dict.users.v2.columnLanguage;
    if (mapped === "createdAt") return dict.users.v2.columnCreatedAt;
    if (mapped === "updatedAt") return dict.users.v2.columnUpdatedAt;
    if (mapped === "lastLoginAt") return dict.users.v2.columnLastLogin;
    return mapped;
  }

  function compactUuidLabel(id: string): string {
    return toDisplayId(id);
  }

  function openCustomerIdPreview(rawId: unknown) {
    const fullId = String(rawId ?? "").trim();
    if (!fullId) return;
    setCustomerIdPreview(fullId);
  }

  function renderCell(row: any, columnName: string) {
    const mapped = columnMappings[columnName] ?? columnName;
    const value = row[mapped];
    if (mapped === "id") {
      if (isBuyerPage) {
        return compactUuidLabel(String(value ?? ""));
      }
      if (kind === "sellers") {
        return (
          <button
            className="inline-copy"
            type="button"
            title={String(value ?? "")}
            onClick={() => {
              openCustomerIdPreview(value);
              navigator.clipboard.writeText(String(value ?? "")).catch(() => undefined);
            }}
          >
            {compactUuidLabel(String(value ?? ""))}
          </button>
        );
      }
      return (
        <button
          className="inline-copy"
          type="button"
          title={String(value ?? "")}
          onClick={() => {
            openCustomerIdPreview(value);
            navigator.clipboard.writeText(String(value ?? "")).catch(() => undefined);
          }}
        >
          {compactUuidLabel(String(value ?? ""))}
        </button>
      );
    }
    if (mapped === "status") {
      const status = value === "disabled" ? "disabled" : "active";
      return (
        <span className={`status-pill ${status === "active" ? "is-active" : "is-disabled"}`}>
          {status === "active" ? dict.users.v2.statusActive : dict.users.v2.statusPassive}
        </span>
      );
    }
    if (mapped === "totalFoods") {
      const count = Number(value ?? 0);
      const safeCount = Number.isFinite(count) ? count : 0;
      if (kind === "sellers") {
        return (
          <button className="inline-copy" type="button" onClick={() => navigate(`/app/sellers/${row.id}?tab=foods`)}>
            {safeCount}
          </button>
        );
      }
      return safeCount;
    }
    if (mapped === "displayName") {
      const text = String(value ?? "");
      if (isBuyerPage) {
        return text;
      }
      if (kind === "sellers") {
        return (
          <button className="inline-copy" type="button" onClick={() => navigate(`/app/sellers/${row.id}?tab=foods`)}>
            {text}
          </button>
        );
      }
      return text;
    }
    if (mapped === "email" && kind === "sellers") {
      return (
        <button className="inline-copy" type="button" onClick={() => navigate(`/app/sellers/${row.id}?tab=foods`)}>
          {String(value ?? "")}
        </button>
      );
    }
    if (mapped === "email" && isBuyerPage) {
      return String(value ?? "");
    }
    if (mapped === "phone") {
      const phoneValue = String(value ?? "").trim();
      return phoneValue || "-";
    }
    if (mapped === "countryCode") {
      const cc = String(value ?? "").toUpperCase();
      if (isSellerPage) return cc || "TR";
      if (cc === "TR") return dict.users.v2.countryTurkey;
      if (cc === "US") return dict.users.v2.countryUnitedStates;
      if (cc === "IT") return dict.users.v2.countryItaly;
      if (cc === "JP") return dict.users.v2.countryJapan;
      if (cc === "FR") return dict.users.v2.countryFrance;
      return cc || "-";
    }
    if (mapped === "language" && isSellerPage) {
      const lang = String(value ?? "").trim().toLowerCase();
      if (lang) return lang.toUpperCase();
      const cc = String(row.countryCode ?? "").toUpperCase();
      return cc || "TR";
    }
    if (mapped === "createdAt" || mapped === "updatedAt" || mapped === "lastLoginAt") {
      const text = String(value ?? "");
      return text ? text.slice(0, 10) : "-";
    }
    if (mapped === "role") {
      if (value === "buyer") return <span className="user-type-pill is-buyer">{dict.users.userTypeBuyer}</span>;
      if (value === "seller") return <span className="user-type-pill is-seller">{dict.users.userTypeSeller}</span>;
      if (value === "both") return <span className="user-type-pill is-both">{dict.users.userTypeBoth}</span>;
      if (value === "admin") return dict.users.roleAdmin;
      if (value === "super_admin") return dict.users.roleSuperAdmin;
    }
    return String(value ?? "");
  }

  function trendArrow(current: number, previous: number): { symbol: string; className: string } {
    if (current > previous) return { symbol: "↑", className: "is-up" };
    if (current < previous) return { symbol: "↓", className: "is-down" };
    return { symbol: "•", className: "is-flat" };
  }


  function exportCellValue(row: any, columnName: string): string {
    const mapped = columnMappings[columnName] ?? columnName;
    const value = row[mapped];
    if (mapped === "id") return String(value ?? "");
    if (mapped === "status") return value === "disabled" ? dict.users.v2.statusPassive : dict.users.v2.statusActive;
    if (mapped === "countryCode") {
      const cc = String(value ?? "").toUpperCase();
      if (cc === "TR") return dict.users.v2.countryTurkey;
      if (cc === "US") return dict.users.v2.countryUnitedStates;
      if (cc === "IT") return dict.users.v2.countryItaly;
      if (cc === "JP") return dict.users.v2.countryJapan;
      if (cc === "FR") return dict.users.v2.countryFrance;
      return cc || "-";
    }
    if (mapped === "language" && isSellerPage) {
      const lang = String(value ?? "").trim().toLowerCase();
      if (lang) return lang.toUpperCase();
      const cc = String(row.countryCode ?? "").toUpperCase();
      return cc || "TR";
    }
    if (mapped === "createdAt" || mapped === "updatedAt" || mapped === "lastLoginAt") {
      const text = String(value ?? "");
      return text ? text.slice(0, 10) : "-";
    }
    if (mapped === "role") {
      if (value === "buyer") return dict.users.userTypeBuyer;
      if (value === "seller") return dict.users.userTypeSeller;
      if (value === "both") return dict.users.userTypeBoth;
      if (value === "admin") return dict.users.roleAdmin;
      if (value === "super_admin") return dict.users.roleSuperAdmin;
    }
    return String(value ?? "");
  }

  function downloadBuyersAsExcel() {
    if (!isBuyerPage) return;
    const headers = [
      ...tableColumns.map((column) => resolveColumnLabel(column)),
      dict.users.v2.buyerExportTotalComplaints,
      dict.users.v2.buyerExportResolvedComplaints,
      dict.users.v2.buyerExportUnresolvedComplaints,
      dict.users.v2.buyerExportOrderTrend,
      dict.users.v2.buyerExportSpendTrend,
    ];

    const rowsForExport = filteredRows.map((row) => [
      ...tableColumns.map((column) => exportCellValue(row, column)),
      String(Number(row.complaintTotal ?? 0)),
      String(Number(row.complaintResolved ?? 0)),
      String(Number(row.complaintUnresolved ?? 0)),
      `${trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)).symbol} ${Number(row.monthlyOrderCountCurrent ?? 0)} / ${Number(row.monthlyOrderCountPrevious ?? 0)}`,
      `${trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)).symbol} ${formatCurrency(Number(row.monthlySpentCurrent ?? 0), language)} / ${formatCurrency(Number(row.monthlySpentPrevious ?? 0), language)}`,
    ]);

    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `buyers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadSellersAsExcel() {
    if (!isSellerPage) return;
    const headers = [
      dict.users.v2.sellersExportSellerName,
      dict.users.v2.sellersExportEmail,
      dict.users.v2.sellersExportSellerId,
      dict.users.v2.sellersExportStatus,
      dict.users.v2.sellersExportFoodCount,
      dict.users.v2.sellersExportMonthlyOrders,
      dict.users.v2.sellersExportMonthlyRevenue,
    ];
    const rowsForExport = filteredRows.map((row) => [
      String(row.displayName ?? row.email ?? ""),
      String(row.email ?? ""),
      String(row.id ?? ""),
      row.status === "disabled" ? dict.users.v2.statusPassive : dict.users.v2.statusActive,
      String(sellerTotalFoods(row)),
      String(sellerOrderCurrent(row)),
      formatCurrency(sellerRevenue(row), language),
    ]);
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rowsForExport].map((line) => line.map((cell) => escapeCsv(String(cell))).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sellers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const showState = loading ? "loading" : error ? "error" : filteredRows.length === 0 ? "empty" : "none";
  const allVisibleBuyerRowsSelected = isBuyerPage && filteredRows.length > 0 && filteredRows.every((row) => buyerSelectedIds.includes(row.id));

  useEffect(() => {
    if (!isBuyerPage) return;
    setBuyerSelectedIds((prev) => prev.filter((id) => filteredRows.some((row) => row.id === id)));
  }, [filteredRows, isBuyerPage]);

  useEffect(() => {
    if (!isBuyerPage) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (buyerActionMenuId && buyerBoardRef.current) {
        const actionRoot = (target as HTMLElement).closest(".buyer-v2-row-actions");
        if (!actionRoot) {
          setBuyerActionMenuId(null);
        }
      }
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [buyerActionMenuId, isBuyerPage]);

  if (isSellerPage) {
    const totalTrSellers = trRows.length;
    const activeTrSellers = trRows.filter((row) => row.status === "active").length;
    const passiveTrSellers = trRows.filter((row) => row.status === "disabled").length;
    const todayTrSellers = trRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey).length;
    const primarySmartItems: SellerSmartFilterKey[] = [
      "pending_approvals",
      "missing_documents",
      "suspicious_logins",
      "complaining_sellers",
      "complainer_sellers",
      "top_selling_foods",
      "top_revenue",
      "performance_drop",
      "urgent_action",
    ];

    const applySellerKpiFilter = (mode: "all" | "active" | "disabled" | "new_today") => {
      setFilters((prev) => ({ ...prev, page: 1 }));
      setIsSellerTableOpen(true);
      if (mode === "all") {
        setSellerStatusFilter("all");
        setActiveSellerSmartFilter(null);
        setActiveSellerKpiFilter("all");
        return;
      }
      setActiveSellerSmartFilter(null);
      if (mode === "active") {
        setSellerStatusFilter("active");
        setActiveSellerKpiFilter("active");
        return;
      }
      if (mode === "disabled") {
        setSellerStatusFilter("disabled");
        setActiveSellerKpiFilter("disabled");
        return;
      }
      setSellerStatusFilter("all");
      setActiveSellerKpiFilter("new_today");
    };

    return (
      <div className="app buyer-v2-page seller-v2-page">
        <section className="buyer-v2-kpis seller-v2-kpis">
          <KpiCard
            icon="👥" label={dict.users.v2.sellerKpiTotal}
            value={new Intl.NumberFormat("tr-TR").format(totalTrSellers)}
            selected={activeSellerKpiFilter === "all"}
            onClick={() => applySellerKpiFilter("all")}
            className="seller-v2-kpi"
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-red" /><span className="seller-v2-dot is-blue" />
              <span className="seller-v2-dot is-blue" /><span className="seller-v2-dot" />
            </div>
          </KpiCard>
          <KpiCard
            icon="✓" iconVariant="good" colorVariant="green" label={dict.users.v2.sellerKpiActive}
            value={new Intl.NumberFormat("tr-TR").format(activeTrSellers)}
            selected={activeSellerKpiFilter === "active"}
            onClick={() => applySellerKpiFilter("active")}
            className="seller-v2-kpi"
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-green" /><span className="seller-v2-dot is-green" />
              <span className="seller-v2-dot is-green" /><span className="seller-v2-dot is-green" />
            </div>
          </KpiCard>
          <KpiCard
            icon="◔" iconVariant="warn" colorVariant="orange" label={dict.users.v2.sellerKpiPassive}
            value={new Intl.NumberFormat("tr-TR").format(passiveTrSellers)}
            selected={activeSellerKpiFilter === "disabled"}
            onClick={() => applySellerKpiFilter("disabled")}
            className="seller-v2-kpi"
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-orange" /><span className="seller-v2-dot is-orange" />
              <span className="seller-v2-dot is-orange" /><span className="seller-v2-dot is-orange" />
            </div>
          </KpiCard>
          <KpiCard
            icon="☀" iconVariant="good" label={dict.users.v2.sellerKpiNewToday}
            value={new Intl.NumberFormat("tr-TR").format(todayTrSellers)}
            selected={activeSellerKpiFilter === "new_today"}
            onClick={() => applySellerKpiFilter("new_today")}
            className="seller-v2-kpi"
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-green" /><span className="seller-v2-dot is-blue" />
              <span className="seller-v2-dot is-blue" /><span className="seller-v2-dot" />
            </div>
          </KpiCard>
        </section>

        <section className="buyer-v2-main-layout">
          <aside className="panel buyer-v2-smart-panel seller-v2-smart-panel" aria-label={dict.users.v2.smartFiltersPlain}>
            <div className="buyer-v2-smart-list seller-v2-smart-primary">
              {primarySmartItems.map((key) => {
                const item = SELLER_SMART_FILTER_ITEMS.find((entry) => entry.key === key);
                if (!item) return null;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`buyer-v2-smart-item ${activeSellerSmartFilter === item.key ? "is-active" : ""}`}
                    aria-pressed={activeSellerSmartFilter === item.key}
                    onClick={() => {
                      setSellerStatusFilter("all");
                      setActiveSellerKpiFilter(null);
                      setActiveSellerSmartFilter((prev) => {
                        const next = prev === item.key ? null : item.key;
                        setIsSellerTableOpen(next !== null);
                        return next;
                      });
                      setFilters((prev) => ({ ...prev, page: 1 }));
                    }}
                  >
                    <span className="buyer-v2-smart-item-icon" aria-hidden="true">{item.icon}</span>
                    <span className="buyer-v2-smart-item-label">{item.label}</span>
                    <span className="buyer-v2-smart-item-count">{sellerSmartFilterCounts[item.key] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="panel buyer-v2-board seller-v2-board">
            {isSellerTableOpen ? (
              <div className="seller-v2-toolbar-row">
                <div className="seller-v2-toolbar-left">
                  <button
                    className="ghost users-sort-pill"
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        sortBy: "updatedAt",
                        sortDir: prev.sortDir === "desc" ? "asc" : "desc",
                        page: 1,
                      }))
                    }
                  >
                    {dict.users.v2.sellerSortUpdated} {filters.sortDir === "desc" ? dict.users.v2.sellerSortDesc : dict.users.v2.sellerSortAsc} ▼
                  </button>
                </div>
                <div className="seller-v2-toolbar-right">
                  <ExcelExportButton className="primary buyer-v2-export" type="button" onClick={downloadSellersAsExcel} language={language} />
                </div>
              </div>
            ) : null}

            {isSellerTableOpen ? (
              <div className="table-wrap users-table-wrap buyer-v2-table-wrap seller-v2-table-wrap density-normal">
                <table>
                  <colgroup>
                    <col style={{ width: "42px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "9%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="buyer-v2-check-col"><input type="checkbox" /></th>
                      <th><SortableHeader label={dict.users.v2.displayId} active={sellerTableSort.key === "id"} dir={sellerSortDirectionFor("id")} onClick={() => sellerHeaderSort("id")} /></th>
                      <th><SortableHeader label={dict.users.v2.sellerHeaderShop} active={sellerTableSort.key === "name"} dir={sellerSortDirectionFor("name")} onClick={() => sellerHeaderSort("name")} /></th>
                      <th><SortableHeader label={dict.users.v2.buyerHeaderStatus} active={sellerTableSort.key === "status"} dir={sellerSortDirectionFor("status")} onClick={() => sellerHeaderSort("status")} /></th>
                      <th><SortableHeader label={dict.users.v2.sellerHeaderWarnings} active={sellerTableSort.key === "warnings"} dir={sellerSortDirectionFor("warnings")} onClick={() => sellerHeaderSort("warnings")} /></th>
                      <th><SortableHeader label={dict.users.v2.sellerHeaderOrderHealth} active={sellerTableSort.key === "orderHealth"} dir={sellerSortDirectionFor("orderHealth")} onClick={() => sellerHeaderSort("orderHealth")} /></th>
                      <th><SortableHeader label={dict.users.v2.sellerHeaderRatingTrend} active={sellerTableSort.key === "ratingTrend"} dir={sellerSortDirectionFor("ratingTrend")} onClick={() => sellerHeaderSort("ratingTrend")} /></th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, index) => (
                        <tr key={`skeleton-seller-${index}`}>
                          <td colSpan={8} className="table-skeleton"><span /></td>
                        </tr>
                      ))
                    ) : filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={8}>{dict.common.noRecords}</td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const orderCurrent = sellerOrderCurrent(row);
                        const orderPrevious = sellerOrderPrevious(row);
                        const orderMeta = trendArrow(orderCurrent, orderPrevious);
                        const ratingValue = sellerRating(row);
                        const ratingTrend = Number(row.ratingTrend ?? row.ratingDelta ?? 0);
                        const revenueTag = `N.${Math.max(1, Math.round(sellerRevenue(row) / 1000))}T`;
                        const sellerName = String(row.displayName ?? row.email ?? dict.users.v2.sellerFallbackName);
                        const warningInfo = sellerComplaintUnresolved(row);
                        const sellerRowTarget =
                          activeSellerSmartFilter === "complainer_sellers"
                            ? `/app/sellers/${row.id}?tab=orders`
                            : activeSellerSmartFilter === "complaining_sellers"
                              ? `/app/sellers/${row.id}?tab=orders`
                              : `/app/sellers/${row.id}`;

                        return (
                          <tr
                            key={row.id}
                            className="is-clickable"
                            onClick={() => navigate(sellerRowTarget)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                navigate(sellerRowTarget);
                              }
                            }}
                            tabIndex={0}
                          >
                            <td className="buyer-v2-check-col"><input type="checkbox" onClick={(event) => event.stopPropagation()} /></td>
                            <td>{toDisplayId(row.id)}</td>
                            <td>
                              <div className="seller-v2-shop-cell">
                                <strong>{sellerName}</strong>
                              </div>
                            </td>
                            <td>
                              <span className={`status-pill ${row.status === "active" ? "is-active" : "is-disabled"}`}>
                                {row.status === "active" ? "Aktif" : "Pasif"}
                              </span>
                            </td>
                            <td>
                              <div className="seller-v2-warning-cell">
                                <span>{warningInfo}</span>
                              </div>
                            </td>
                            <td>
                              <div className="seller-v2-health-cell">
                                <span className="seller-v2-health-pill">{revenueTag}</span>
                                <span className={`buyer-trend ${orderMeta.className}`}>{orderMeta.symbol}</span>
                              </div>
                            </td>
                            <td>
                              <span className="seller-v2-rating">
                                {ratingValue > 0 ? ratingValue.toFixed(1) : "-"} ★ ({ratingTrend >= 0 ? "+" : ""}{ratingTrend.toFixed(1)})
                              </span>
                            </td>
                            <td className="cell-actions">
                              <button
                                className="ghost action-btn seller-v2-detail-btn"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(sellerRowTarget);
                                }}
                              >
                                <span aria-hidden="true">{row.status === "active" ? dict.users.v2.sellerActionDetail : dict.users.v2.sellerActionActivate}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="seller-table-placeholder">
                {dict.users.v2.sellerOpenTableHint}
              </div>
            )}

            {isSellerTableOpen ? (
              <Pager
                page={filters.page}
                totalPages={pagination?.totalPages ?? 1}
                summary={fmt(dict.common.paginationSummary, {
                  total: pagination?.total ?? 0,
                  page: filters.page,
                  totalPages: Math.max(pagination?.totalPages ?? 1, 1),
                })}
                prevLabel={dict.actions.prev}
                nextLabel={dict.actions.next}
                onPageChange={(nextPage) => setFilters((prev) => ({ ...prev, page: nextPage }))}
                onPrev={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
                onNext={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
              />
            ) : null}
          </section>
        </section>
      </div>
    );
  }
  if (isBuyerPage) {
    const isOpenComplaintView = buyerQuickFilter === "open_complaint";
    return (
      <div className="app buyer-v2-page">
        <section className="buyer-v2-kpis seller-v2-kpis">
          <KpiCard
            icon="👥"
            label={dict.users.v2.buyerKpiTotal}
            value={new Intl.NumberFormat("tr-TR").format(totalBuyersCount)}
            className="seller-v2-kpi"
            selected={buyerQuickFilter === null}
            onClick={() => {
              setBuyerQuickFilter(null);
              setFilters((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-red" /><span className="seller-v2-dot is-blue" />
              <span className="seller-v2-dot is-blue" /><span className="seller-v2-dot" />
            </div>
          </KpiCard>
          <KpiCard
            icon="✓"
            iconVariant="good"
            colorVariant="green"
            label={dict.users.v2.buyerKpiActive}
            value={new Intl.NumberFormat("tr-TR").format(activeRows.length)}
            className="seller-v2-kpi"
            selected={buyerQuickFilter === "active"}
            onClick={() => {
              setBuyerQuickFilter((prev) => (prev === "active" ? null : "active"));
              setFilters((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-green" /><span className="seller-v2-dot is-green" />
              <span className="seller-v2-dot is-green" /><span className="seller-v2-dot is-green" />
            </div>
          </KpiCard>
          <KpiCard
            icon="◔"
            iconVariant="warn"
            colorVariant="orange"
            label={dict.users.v2.buyerKpiOpenComplaint}
            value={new Intl.NumberFormat("tr-TR").format(buyersWithOpenComplaints)}
            className="seller-v2-kpi"
            selected={buyerQuickFilter === "open_complaint"}
            onClick={() => {
              setBuyerQuickFilter((prev) => (prev === "open_complaint" ? null : "open_complaint"));
              setFilters((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-orange" /><span className="seller-v2-dot is-orange" />
              <span className="seller-v2-dot is-orange" /><span className="seller-v2-dot is-orange" />
            </div>
          </KpiCard>
          <KpiCard
            icon="🛡"
            iconVariant="danger"
            label={dict.users.v2.buyerKpiRisky}
            value={new Intl.NumberFormat("tr-TR").format(riskyBuyersCount)}
            className="seller-v2-kpi"
            selected={buyerQuickFilter === "risky"}
            onClick={() => {
              setBuyerQuickFilter((prev) => (prev === "risky" ? null : "risky"));
              setFilters((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-red" /><span className="seller-v2-dot is-red" />
              <span className="seller-v2-dot is-red" /><span className="seller-v2-dot is-red" />
            </div>
          </KpiCard>
        </section>

        <section className="buyer-v2-main-layout buyer-v2-main-layout--single">
          <section className="panel buyer-v2-board">
          <div className="buyer-v2-toolbar">
            <div className="buyer-v2-toolbar-actions-right">
              <ExcelExportButton className="primary buyer-v2-export" type="button" onClick={downloadBuyersAsExcel} language={language} />
            </div>
          </div>

            <div className="table-wrap users-table-wrap buyer-v2-table-wrap density-normal" ref={buyerBoardRef}>
              <table>
                <colgroup>
                  <col style={{ width: "40px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "27%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "54px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="buyer-v2-check-col">
                      <input
                        type="checkbox"
                        checked={allVisibleBuyerRowsSelected}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setBuyerSelectedIds(filteredRows.map((row) => row.id));
                            return;
                          }
                          setBuyerSelectedIds([]);
                        }}
                      />
                    </th>
                    <th><SortableHeader label={dict.users.v2.displayId} active={buyerTableSort.key === "id"} dir={buyerSortDirectionFor("id")} onClick={() => buyerHeaderSort("id")} /></th>
                    <th><SortableHeader label={dict.users.v2.buyerHeaderBuyer} active={buyerTableSort.key === "buyer"} dir={buyerSortDirectionFor("buyer")} onClick={() => buyerHeaderSort("buyer")} /></th>
                    <th><SortableHeader label={isOpenComplaintView ? dict.users.v2.buyerHeaderTotalComplaint : dict.users.v2.buyerHeaderRisk} active={buyerTableSort.key === "col4"} dir={buyerSortDirectionFor("col4")} onClick={() => buyerHeaderSort("col4")} /></th>
                    <th><SortableHeader label={isOpenComplaintView ? dict.users.v2.buyerHeaderOpenComplaint : dict.users.v2.buyerHeaderComplaints} active={buyerTableSort.key === "col5"} dir={buyerSortDirectionFor("col5")} onClick={() => buyerHeaderSort("col5")} /></th>
                    <th><SortableHeader label={isOpenComplaintView ? dict.users.v2.buyerHeaderLastComplaintId : dict.users.v2.buyerHeaderOrders1m} active={buyerTableSort.key === "col6"} dir={buyerSortDirectionFor("col6")} onClick={() => buyerHeaderSort("col6")} /></th>
                    <th><SortableHeader label={isOpenComplaintView ? dict.users.v2.buyerHeaderLastComplaintDate : dict.users.v2.buyerHeaderSpend1m} active={buyerTableSort.key === "col7"} dir={buyerSortDirectionFor("col7")} onClick={() => buyerHeaderSort("col7")} /></th>
                    <th><SortableHeader label={isOpenComplaintView ? dict.users.v2.buyerHeaderLastStatus : dict.users.v2.buyerHeaderLastLogin} active={buyerTableSort.key === "col8"} dir={buyerSortDirectionFor("col8")} onClick={() => buyerHeaderSort("col8")} /></th>
                    <th><SortableHeader label={dict.users.v2.buyerHeaderStatus} active={buyerTableSort.key === "status"} dir={buyerSortDirectionFor("status")} onClick={() => buyerHeaderSort("status")} /></th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`skeleton-buyer-${index}`}>
                        <td colSpan={10} className="table-skeleton"><span /></td>
                      </tr>
                    ))
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={10}>{dict.common.noRecords}</td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                    const risk = computeBuyerRisk(row);
                    const orderTrendMeta = trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0));
                    const spendTrendMeta = trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0));
                    const orderCurrent = Number(row.monthlyOrderCountCurrent ?? 0);
                    const orderPrevious = Number(row.monthlyOrderCountPrevious ?? 0);
                    const orderDelta = orderCurrent - orderPrevious;
                    const spendCurrent = Number(row.monthlySpentCurrent ?? 0);
                    const spendPrevious = Number(row.monthlySpentPrevious ?? 0);
                    const spendDelta = spendCurrent - spendPrevious;
                    const unresolved = Number(row.complaintUnresolved ?? 0);
                    const totalComplaints = Number(row.complaintTotal ?? 0);
                    const phoneRaw = String(row.phone ?? row.phoneNumber ?? row.contactPhone ?? "").trim();
                    const hasPhone = phoneRaw.length > 0;
                    const phoneHref = phoneRaw.replace(/\s+/g, "");
                    const loginAtRaw = String(row.lastOnlineAt ?? row.lastLoginAt ?? row.last_login_at ?? "");
                    const loginAt = formatLoginRelativeDayMonth(loginAtRaw, language);
                    const displayNameRaw = String(row.displayName ?? row.email ?? "-");
                    const displaySeedMatch = displayNameRaw.match(/^apiseedbuyer\d{4,}.*?(\d+)$/i);
                    const normalizedDisplayName = displaySeedMatch ? `nbuyer${displaySeedMatch[1]}` : displayNameRaw;
                    const buyerRowTarget =
                      isOpenComplaintView
                        ? `/app/buyers/${row.id}?tab=complaints`
                        : `/app/buyers/${row.id}`;

                    return (
                      <tr
                        key={row.id}
                        className={`is-clickable buyer-risk-${risk.level}`}
                        onClick={() => navigate(buyerRowTarget)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(buyerRowTarget);
                          }
                        }}
                        tabIndex={0}
                        >
                        <td className="buyer-v2-check-col">
                          <input
                            type="checkbox"
                            checked={buyerSelectedIds.includes(row.id)}
                            onChange={(event) => {
                              event.stopPropagation();
                              setBuyerSelectedIds((prev) =>
                                event.target.checked ? [...new Set([...prev, row.id])] : prev.filter((id) => id !== row.id)
                              );
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </td>
                        <td>{toDisplayId(row.id)}</td>
                        <td>
                          <div className="buyer-user-cell">
                            <strong className="buyer-user-name" title={displayNameRaw}>{normalizedDisplayName}</strong>
                          </div>
                        </td>
                        <td>
                          {isOpenComplaintView ? (
                            <div className="buyer-complaint-cell">
                              <strong>{totalComplaints}</strong>
                            </div>
                          ) : (
                            <span className={`risk-pill is-${risk.level}`}>
                              {risk.level === "high" ? dict.users.v2.riskHigh : risk.level === "medium" ? dict.users.v2.riskMedium : dict.users.v2.riskLow}
                            </span>
                          )}
                        </td>
                        <td>
                          {isOpenComplaintView ? (
                            <div className="buyer-complaint-cell">
                              <strong>{unresolved}</strong>
                            </div>
                          ) : (
                            <div className="buyer-complaint-summary">
                              <span className={`buyer-complaint-chip ${unresolved > 0 ? "is-open" : "is-clear"}`}>
                                <strong>{totalComplaints}</strong>
                                <span>/</span>
                                <strong>{unresolved}</strong>
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          {isOpenComplaintView ? (
                            <div className="buyer-complaint-cell">
                              <strong>{buyerLatestComplaintId(row) ? toDisplayId(buyerLatestComplaintId(row)) : "-"}</strong>
                            </div>
                          ) : (
                            <div className="buyer-orders-cell">
                              <strong>{orderCurrent}</strong>
                              <span className={`buyer-trend ${orderTrendMeta.className}`}>{orderTrendMeta.symbol}</span>
                              {orderDelta !== 0 ? (
                                <span className={`buyer-delta ${orderDelta > 0 ? "is-up" : "is-down"}`}>{Math.abs(orderDelta)}</span>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>
                          {isOpenComplaintView ? (
                            <div className="buyer-login-cell">
                              <strong>{formatLoginRelativeDayMonth(String(row.latestComplaintCreatedAt ?? ""), language)}</strong>
                            </div>
                          ) : (
                            <div className="buyer-spend-cell">
                              <strong>{formatCurrency(spendCurrent, language)}</strong>
                              <span className={`buyer-trend ${spendTrendMeta.className}`}>{spendTrendMeta.symbol}</span>
                              {spendDelta === 0 ? <span className="buyer-dot">•</span> : null}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="buyer-login-cell">
                            {isOpenComplaintView ? (
                              <span className={`status-pill ${unresolved > 0 ? "is-warning" : "is-neutral"}`}>
                                {buyerLatestComplaintStatusLabel(row)}
                              </span>
                            ) : (
                              <strong>{loginAt}</strong>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${row.status === "active" ? "is-active" : "is-neutral"}`}>
                            {row.status === "active" ? dict.users.v2.statusActive : dict.users.v2.statusPassive}
                          </span>
                        </td>
                        <td className="cell-actions buyer-v2-row-actions">
                          <button
                            className="ghost action-menu-btn"
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={buyerActionMenuId === row.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setBuyerActionMenuId((prev) => (prev === row.id ? null : row.id));
                            }}
                          >
                            ⋯
                          </button>
                          {buyerActionMenuId === row.id ? (
                            <div className="buyer-row-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setBuyerActionMenuId(null);
                                  const email = String(row.email ?? "").trim();
                                  if (!email) return;
                                  window.location.href = `mailto:${email}`;
                                }}
                              >
                                {dict.users.v2.quickEmail}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!hasPhone}
                                onClick={() => {
                                  setBuyerActionMenuId(null);
                                  if (!hasPhone) return;
                                  window.location.href = `sms:${phoneHref}`;
                                }}
                              >
                                SMS
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!hasPhone}
                                onClick={() => {
                                  setBuyerActionMenuId(null);
                                  if (!hasPhone) return;
                                  window.location.href = `tel:${phoneHref}`;
                                }}
                              >
                                {dict.users.v2.phone}
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <Pager
              page={filters.page}
              totalPages={pagination?.totalPages ?? 1}
              summary={fmt(dict.common.paginationSummary, {
                total: pagination?.total ?? 0,
                page: filters.page,
                totalPages: Math.max(pagination?.totalPages ?? 1, 1),
              })}
              prevLabel={dict.actions.prev}
              nextLabel={dict.actions.next}
              onPageChange={(nextPage) => setFilters((prev) => ({ ...prev, page: nextPage }))}
              onPrev={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
              onNext={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
            />
          </section>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="users-title-wrap">
          <h1>{pageTitleView}</h1>
          {customerIdPreview ? (
            <div className="customer-id-preview-inline" role="status" aria-live="polite">
              <div className="customer-id-preview-eye" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="presentation">
                  <path d="M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </div>
              <strong>{dict.users.v2.customerId}</strong>
              <code>{customerIdPreview}</code>
              <button className="ghost" type="button" onClick={() => setCustomerIdPreview(null)}>
                {dict.records.close}
              </button>
            </div>
          ) : null}
        </div>
        <div className="topbar-actions">
          <>
            <button className="ghost" type="button" onClick={() => setIsColumnsModalOpen(true)}>
              {dict.users.visibleColumns}
            </button>
            {isBuyerPage ? (
              <ExcelExportButton className="primary" type="button" onClick={downloadBuyersAsExcel} language={language}>
                {dict.actions.exportExcel}
              </ExcelExportButton>
            ) : null}
            {!isSellerPage && !isBuyerPage ? (
              <>
              <button className="ghost" type="button" onClick={openCreateDrawer} disabled={!isSuperAdmin}>
                + {dict.actions.create}
              </button>
              <button className="primary" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>
                {dict.actions.refresh}
              </button>
              </>
            ) : null}
          </>
        </div>
      </header>

      <section className="panel users-kpi-grid">
        {!isSellerPage && !isBuyerPage ? (
          <div className="density-switch users-density-floating" role="group" aria-label="Table density">
            <button type="button" className={density === "compact" ? "is-active" : ""} onClick={() => setDensity("compact")}>
              {dict.users.v2.densityCompact}
            </button>
            <button type="button" className={density === "normal" ? "is-active" : ""} onClick={() => setDensity("normal")}>
              {dict.users.v2.densityNormal}
            </button>
            <button type="button" className={density === "comfortable" ? "is-active" : ""} onClick={() => setDensity("comfortable")}>
              {dict.users.v2.densityComfort}
            </button>
          </div>
        ) : null}
        {isBuyerPage ? (
          <>
            <article>
              <div className="users-kpi-row">
                <p>{dict.users.v2.totalBuyersLabel}</p>
                <strong className="users-kpi-value">{totalBuyersCount}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row users-kpi-row-progress">
                <p>{dict.users.v2.activeRatioLabel}</p>
                <strong className="users-kpi-value is-active">%{activeRatio}</strong>
              </div>
              <div className="users-kpi-progress">
                <span style={{ width: `${activeRatio}%` }} />
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{dict.users.v2.buyersWithComplaintsLabel}</p>
                <strong className="users-kpi-value">{buyersWithOpenComplaints}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{dict.users.v2.riskyBuyersLabel}</p>
                <strong className="users-kpi-value">{riskyBuyersCount}</strong>
              </div>
            </article>
          </>
        ) : (
          <>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? dict.users.v2.totalTrSellersLabel : dict.users.v2.totalBuyersPluralLabel}</p>
                <strong className="users-kpi-value">{isSellerPage ? trRows.length : pagination?.total ?? rows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? dict.users.v2.activeTrSellersLabel : dict.users.v2.activeBuyersPluralLabel}</p>
                <strong className="users-kpi-value is-active">{isSellerPage ? trRows.filter((row) => row.status === "active").length : activeRows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? dict.users.v2.passiveTrSellersLabel : dict.users.v2.passiveBuyersPluralLabel}</p>
                <strong className="users-kpi-value">{isSellerPage ? trRows.filter((row) => row.status === "disabled").length : passiveRows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? dict.users.v2.newTrSellersTodayLabel : dict.users.v2.newTodayLabel}</p>
                <strong className="users-kpi-value">{newToday}</strong>
              </div>
            </article>
          </>
        )}
      </section>

      <section className="panel">
        <div className="users-filter-top">
          <div className="quick-filters">
            {isBuyerPage ? (
              <div className="buyer-filter-controls">
                <select
                  value={buyerFilterDraft.status}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, status: event.target.value as typeof prev.status }))}
                >
                  <option value="all">{dict.users.v2.statusAll}</option>
                  <option value="active">{dict.users.v2.statusActiveFilter}</option>
                  <option value="disabled">{dict.users.v2.statusDisabledFilter}</option>
                </select>
                <select
                  value={buyerFilterDraft.complaint}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, complaint: event.target.value as typeof prev.complaint }))}
                >
                  <option value="all">{dict.users.v2.complaintsAll}</option>
                  <option value="has_unresolved">{dict.users.v2.complaintsHasUnresolved}</option>
                  <option value="resolved_only">{dict.users.v2.complaintsResolvedOnly}</option>
                  <option value="no_complaint">{dict.users.v2.complaintsNone}</option>
                </select>
                <select
                  value={buyerFilterDraft.orderTrend}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, orderTrend: event.target.value as typeof prev.orderTrend }))}
                >
                  <option value="all">{dict.users.v2.orderTrendAll}</option>
                  <option value="up">{dict.users.v2.orderTrendUp}</option>
                  <option value="down">{dict.users.v2.orderTrendDown}</option>
                </select>
                <select
                  value={buyerFilterDraft.spendTrend}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, spendTrend: event.target.value as typeof prev.spendTrend }))}
                >
                  <option value="all">{dict.users.v2.spendTrendAll}</option>
                  <option value="up">{dict.users.v2.spendTrendUp}</option>
                  <option value="down">{dict.users.v2.spendTrendDown}</option>
                </select>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "all" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("all");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {dict.users.v2.quickAll}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "risky" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("risky");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {dict.users.v2.quickRisky}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "open_complaint" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("open_complaint");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {dict.users.v2.quickOpenComplaints}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "down_spend" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("down_spend");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {dict.users.v2.quickDownSpend}
                </button>
              </div>
            ) : null}
            {isSellerPage ? (
              <>
                <button type="button" className={`chip ${sellerStatusFilter === "all" ? "is-active" : ""}`} onClick={() => setSellerStatusFilter("all")}>
                  {dict.users.v2.allTr}
                </button>
                <button
                  type="button"
                  className={`chip ${sellerStatusFilter === "active" ? "is-active" : ""}`}
                  onClick={() => setSellerStatusFilter("active")}
                >
                  {dict.users.v2.statusActive}
                </button>
                <button
                  type="button"
                  className={`chip ${sellerStatusFilter === "disabled" ? "is-active" : ""}`}
                  onClick={() => setSellerStatusFilter("disabled")}
                >
                  {dict.users.v2.statusPassive}
                </button>
              </>
            ) : null}
            {!isBuyerPage ? (
              <button
                type="button"
                className={`chip ${last7DaysOnly ? "is-active" : ""}`}
                onClick={() => {
                  setLast7DaysOnly((prev) => !prev);
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                {dict.users.v2.last7Days}
              </button>
            ) : null}
            {!isSellerPage && !isBuyerPage ? <span className={`chip ${showState === "loading" ? "is-active" : ""}`}>{dict.common.loading}</span> : null}
            {!isSellerPage && !isBuyerPage ? (
              <span className={`chip ${showState === "empty" ? "is-active" : ""}`}>{dict.users.v2.noBuyersFound}</span>
            ) : null}
            {!isSellerPage && !isBuyerPage ? <span className={`chip ${showState === "error" ? "is-active" : ""}`}>{dict.users.v2.genericError}</span> : null}
            {showState === "error" && !isBuyerPage ? (
              <button className="chip is-active" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>
                {dict.users.v2.retry}
              </button>
            ) : null}
          </div>
          <button
            className="ghost users-sort-pill"
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                sortBy: isSellerPage ? "updatedAt" : prev.sortBy,
                sortDir: prev.sortDir === "desc" ? "asc" : "desc",
                page: 1,
              }))
            }
          >
            {isSellerPage ? `${dict.users.v2.sortUpdatedDate} ` : `${dict.users.v2.sortCreatedDate} `}
            {filters.sortDir === "desc" ? dict.users.v2.sellerSortDesc : dict.users.v2.sellerSortAsc} ▼
          </button>
          {!isSellerPage ? (
            <button
              className="primary users-filter-apply"
              type="button"
              onClick={() => {
                if (isBuyerPage) {
                  setBuyerFilters(buyerFilterDraft);
                }
                setFilters((prev) => ({ ...prev, page: 1 }));
              }}
            >
              {dict.users.v2.filterButton}
            </button>
          ) : null}
        </div>
        <div className={`table-wrap users-table-wrap density-${density}`}>
          <table>
            <thead>
              <tr>
                {isBuyerPage ? (
                  <>
                    <th>{dict.users.v2.displayId}</th>
                    <th>{dict.users.v2.buyerHeaderBuyer}</th>
                    <th>{dict.users.v2.buyerHeaderRisk}</th>
                    <th>{dict.users.v2.buyerHeaderComplaints}</th>
                    <th>{dict.users.v2.buyerHeaderOrders1m}</th>
                    <th>{dict.users.v2.buyerHeaderSpend1m}</th>
                    <th>{dict.users.v2.buyerHeaderStatus}</th>
                    <th>{dict.users.actions}</th>
                  </>
                ) : (
                  <>
                    {tableColumns.map((column) => (
                      <th key={column}>{resolveColumnLabel(column)}</th>
                    ))}
                    <th>{dict.users.actions}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const tableColSpan = isBuyerPage ? 8 : tableColumns.length + 1;
                return loading ? Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`skeleton-${index}`}>
                    <td colSpan={tableColSpan} className="table-skeleton">
                      <span />
                    </td>
                  </tr>
                )) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={tableColSpan}>{dict.common.noRecords}</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    if (isBuyerPage) {
                      const risk = computeBuyerRisk(row);
                      const orderTrendMeta = trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0));
                      const spendTrendMeta = trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0));
                      const unresolved = Number(row.complaintUnresolved ?? 0);
                      const totalComplaints = Number(row.complaintTotal ?? 0);

                      return (
                        <tr
                          key={row.id}
                          className={`is-clickable buyer-risk-${risk.level}`}
                          onClick={() => navigate(`/app/buyers/${row.id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              navigate(`/app/buyers/${row.id}`);
                            }
                          }}
                          tabIndex={0}
                        >
                          <td>{toDisplayId(row.id)}</td>
                          <td>
                            <div className="buyer-user-cell">
                              <strong>{String(row.displayName ?? row.email ?? "-")}</strong>
                            </div>
                          </td>
                          <td>
                            <span className={`risk-pill is-${risk.level}`}>
                              {risk.level === "high" ? dict.users.v2.riskHigh : risk.level === "medium" ? dict.users.v2.riskMedium : dict.users.v2.riskLow}
                            </span>
                          </td>
                          <td>
                            <div className="buyer-complaint-summary">
                              <span className={`buyer-complaint-chip ${unresolved > 0 ? "is-open" : "is-clear"}`}>
                                <strong>{totalComplaints}</strong>
                                <span>/</span>
                                <strong>{unresolved}</strong>
                              </span>
                            </div>
                        </td>
                          <td>
                            <div className={`buyer-trend ${orderTrendMeta.className}`}>
                              <strong>{Number(row.monthlyOrderCountCurrent ?? 0)}</strong>
                              <span>{orderTrendMeta.symbol}</span>
                            </div>
                          </td>
                          <td>
                            <div className={`buyer-trend ${spendTrendMeta.className}`}>
                              <strong>{formatCurrency(Number(row.monthlySpentCurrent ?? 0), language)}</strong>
                              <span>{spendTrendMeta.symbol}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-pill ${row.status === "active" ? "is-active" : "is-neutral"}`}>
                              {row.status === "active" ? dict.users.v2.statusActive : dict.users.v2.statusPassive}
                            </span>
                          </td>
                          <td className="cell-actions">
                            <button
                              className="ghost action-menu-btn"
                              type="button"
                              aria-label={dict.users.v2.actionMenu}
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/app/buyers/${row.id}`);
                              }}
                            >
                              ⋯
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={row.id}>
                        {tableColumns.map((column) => (
                          <td key={`${row.id}-${column}`}>{renderCell(row, column)}</td>
                        ))}
                        <td className="cell-actions">
                          {!isBuyerPage ? (
                            <button
                              className="ghost action-btn"
                              type="button"
                              title={dict.actions.detail}
                              aria-label={dict.actions.detail}
                              onClick={() =>
                                navigate(
                                  kind === "app"
                                    ? `/app/users/${row.id}`
                                    : `/app/admins/${row.id}`
                                )
                              }
                            >
                              <span aria-hidden="true">◉ {dict.actions.detail}</span>
                              <span className="sr-only">{dict.actions.detail}</span>
                            </button>
                          ) : null}
                          {isSuperAdmin && !isSellerPage ? (
                            <button
                              className="ghost action-btn"
                              type="button"
                              title={dict.users.v2.disableAction}
                              aria-label={dict.actions.toggleStatus}
                              onClick={() => toggleStatusAction(row)}
                            >
                              <span aria-hidden="true">◔ {dict.users.v2.disableAction}</span>
                              <span className="sr-only">{dict.actions.toggleStatus}</span>
                            </button>
                          ) : !isSellerPage ? (
                            <button className="ghost action-btn" type="button" disabled title={dict.users.onlySuperAdmin}>
                              {dict.users.v2.noPermission}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                );
              })()}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <Pager
          page={filters.page}
          totalPages={pagination?.totalPages ?? 1}
          summary={fmt(dict.common.paginationSummary, { total: pagination?.total ?? 0, page: filters.page, totalPages: Math.max(pagination?.totalPages ?? 1, 1) })}
          prevLabel={dict.actions.prev}
          nextLabel={dict.actions.next}
          onPageChange={(nextPage) => setFilters((prev) => ({ ...prev, page: nextPage }))}
          onPrev={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
          onNext={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
        />
      </section>

      <div className={`drawer-overlay ${isDrawerOpen ? "is-open" : ""}`} onClick={closeDrawer}>
        <aside className={`form-drawer ${isDrawerOpen ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{drawerMode === "edit" ? dict.users.v2.editUser : createTitle}</h2>
            <button className="ghost" type="button" onClick={closeDrawer} disabled={saving}>
              {dict.users.v2.close}
            </button>
          </div>

          {!isSuperAdmin ? <p className="panel-meta">{dict.users.onlySuperAdmin}</p> : null}

          {drawerMode === "create" ? (
            <form className="drawer-form" onSubmit={createUser}>
              <label>
                {dict.auth.email}
                <input name="email" disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.auth.password}
                <input name="password" type="password" disabled={!isSuperAdmin || saving} />
              </label>
              {isAppScoped ? (
                <>
                  <label>
                    {dict.users.displayName}
                    <input name="displayName" disabled={!isSuperAdmin || saving} />
                  </label>
                  {kind === "app" ? (
                    <label>
                      {dict.users.userType}
                      <select name="userType" disabled={!isSuperAdmin || saving}>
                        <option value="buyer">{dict.users.userTypeBuyer}</option>
                        <option value="seller">{dict.users.userTypeSeller}</option>
                        <option value="both">{dict.users.userTypeBoth}</option>
                      </select>
                    </label>
                  ) : null}
                </>
              ) : (
                <label>
                  {dict.users.role}
                  <select name="role" disabled={!isSuperAdmin || saving}>
                    <option value="admin">{dict.users.roleAdmin}</option>
                    <option value="super_admin">{dict.users.roleSuperAdmin}</option>
                  </select>
                </label>
              )}
              <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                {saving ? dict.users.v2.saving : dict.actions.create}
              </button>
            </form>
          ) : null}

          {drawerMode === "edit" && editingRow ? (
            <form className="drawer-form" onSubmit={updateUser}>
              <label>
                {dict.auth.email}
                <input name="email" defaultValue={String(editingRow.email ?? "")} disabled={!isSuperAdmin || saving} />
              </label>
              <label>
                {dict.detail.passwordOptional}
                <input name="password" type="password" disabled={!isSuperAdmin || saving} />
              </label>
              <button className="primary" type="submit" disabled={!isSuperAdmin || saving}>
                {saving ? dict.users.v2.saving : dict.actions.save}
              </button>
            </form>
          ) : null}

          {formError ? <div className="alert">{formError}</div> : null}
        </aside>
      </div>

      <div className={`drawer-overlay ${isColumnsModalOpen ? "is-open" : ""}`} onClick={() => setIsColumnsModalOpen(false)}>
        <section className={`settings-modal ${isColumnsModalOpen ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{dict.users.visibleColumns}</h2>
            <button className="ghost" type="button" onClick={() => setIsColumnsModalOpen(false)}>
              {dict.users.v2.close}
            </button>
          </div>
          <p className="panel-meta">{tableKey}</p>
          <div className="checkbox-grid">
            {fields.map((field) => (
              <label key={field.name}>
                <input
                  type="checkbox"
                  checked={tableColumns.includes(field.name)}
                  onChange={(event) => {
                    setVisibleColumns((prev) => {
                      if (event.target.checked) return [...new Set([...prev, field.name])];
                      return prev.filter((item) => item !== field.name);
                    });
                  }}
                />
                {resolveColumnLabel(field.name)}
              </label>
            ))}
          </div>
          <button className="primary" type="button" onClick={savePreferences}>
            {dict.users.savePreferences}
          </button>
        </section>
      </div>

      <div className={`drawer-overlay ${pendingStatusChange ? "is-open" : ""}`} onClick={() => setPendingStatusChange(null)}>
        <section className={`settings-modal ${pendingStatusChange ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{dict.users.v2.confirmStatusChange}</h2>
          </div>
          <p className="panel-meta">
            {pendingStatusChange?.next === "active" ? dict.users.v2.userWillActivate : dict.users.v2.userWillDisable}
          </p>
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={() => setPendingStatusChange(null)}>
              {dict.common.cancel}
            </button>
            <button className="primary" type="button" onClick={() => confirmStatusChange().catch(() => setError(dict.users.updateFailed))}>
              {dict.users.v2.confirm}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default UsersPage;
