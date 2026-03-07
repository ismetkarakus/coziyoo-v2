import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { Pager, KpiCard } from "../components/ui";
import { DICTIONARIES } from "../lib/i18n";
import { fmt, toDisplayId, formatTableHeader, formatCurrency, formatUiDate, formatLoginRelativeDayMonth, adminRoleLabel } from "../lib/format";
import { BUYER_SMART_FILTER_ITEMS, SELLER_SMART_FILTER_ITEMS } from "../lib/constants";
import { AppUserFormSchema, AdminUserFormSchema } from "../lib/forms";
import type { Language, ApiError, Dictionary } from "../types/core";
import type { UserKind, ColumnMeta, DensityMode, BuyerSmartFilterKey } from "../types/users";
import type { SellerSmartFilterKey } from "../types/seller";

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
  const [buyerQuickFilter, setBuyerQuickFilter] = useState<"all" | "risky" | "open_complaint" | "down_spend">("all");
  const [activeSmartFilter, setActiveSmartFilter] = useState<BuyerSmartFilterKey | null>(null);
  const [activeSellerSmartFilter, setActiveSellerSmartFilter] = useState<SellerSmartFilterKey | null>(null);
  const [smartFilterCounts, setSmartFilterCounts] = useState<Record<BuyerSmartFilterKey, number>>({
    daily_buyer: 0,
    top_revenue: 0,
    suspicious_login: 0,
    same_ip_multi_account: 0,
    risky_seller_complaints: 0,
    complainers: 0,
  });
  const [buyerSelectedIds, setBuyerSelectedIds] = useState<string[]>([]);
  const [buyerFilterMenuOpen, setBuyerFilterMenuOpen] = useState(false);
  const [buyerActionMenuId, setBuyerActionMenuId] = useState<string | null>(null);
  const buyerFilterWrapRef = useRef<HTMLDivElement | null>(null);
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
  const pageTitleView = isSellerPage ? (language === "tr" ? "Satıcı Yönetimi" : "Seller Management") : pageTitle;
  const unifiedSearchPlaceholder =
    isSellerPage
      ? language === "tr"
        ? "Satıcı ID, e-posta, yemek no ile ara..."
        : "Search seller ID, email, food no..."
      : language === "tr"
        ? "Alıcı/Satıcı ID, e-posta, yemek no ile ara..."
        : "Search buyer/seller ID, email, food no...";
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
      />
      {searchInput.trim().length > 0 ? (
        <button
          className="users-search-clear"
          type="button"
          aria-label={language === "tr" ? "Aramayı temizle" : "Clear search"}
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
    setBuyerQuickFilter("all");
    setActiveSmartFilter(null);
    setActiveSellerSmartFilter(null);
    setBuyerActionMenuId(null);
    setCustomerIdPreview(null);
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
      ...(isBuyerPage && activeSmartFilter ? { smartFilter: activeSmartFilter } : {}),
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
    setLastUpdatedAt(new Date().toISOString());
    setLoading(false);
  }

  useEffect(() => {
    loadRows().catch(() => setError(dict.users.requestFailed));
  }, [filters.page, filters.pageSize, filters.sortBy, filters.sortDir, filters.roleFilter, audience, searchTerm, activeSmartFilter, isBuyerPage]);

  useEffect(() => {
    if (!isBuyerPage) return;
    request("/v1/admin/buyers/smart-filter-counts")
      .then(async (response) => {
        if (response.status !== 200) return;
        const body = await parseJson<{ data?: Partial<Record<BuyerSmartFilterKey, number>> }>(response);
        if (!body.data) return;
        setSmartFilterCounts({
          daily_buyer: Number(body.data.daily_buyer ?? 0),
          top_revenue: Number(body.data.top_revenue ?? 0),
          suspicious_login: Number(body.data.suspicious_login ?? 0),
          same_ip_multi_account: Number(body.data.same_ip_multi_account ?? 0),
          risky_seller_complaints: Number(body.data.risky_seller_complaints ?? 0),
          complainers: Number(body.data.complainers ?? 0),
        });
      })
      .catch(() => undefined);
  }, [isBuyerPage, activeSmartFilter, buyerQuickFilter, buyerFilters.status, buyerFilters.complaint, buyerFilters.orderTrend, buyerFilters.spendTrend]);

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
  const totalBuyersCount = pagination?.total ?? rows.length;
  const totalRevenue30d = rows.reduce((acc, row) => acc + Number(row.monthlySpentCurrent ?? 0), 0);
  const activeRatio = totalBuyersCount > 0 ? Math.round((activeRows.length / totalBuyersCount) * 100) : 0;
  const sellerRevenue = (row: any): number => Number(row.monthlyRevenue ?? row.monthlySpentCurrent ?? row.totalRevenue ?? row.revenue ?? 0);
  const sellerOrderCurrent = (row: any): number => Number(row.monthlyOrderCountCurrent ?? row.orderCount30d ?? row.totalOrders ?? 0);
  const sellerOrderPrevious = (row: any): number => Number(row.monthlyOrderCountPrevious ?? row.orderCountPrev30d ?? 0);
  const sellerTotalFoods = (row: any): number => Number(row.totalFoods ?? 0);
  const sellerComplaintTotal = (row: any): number => Number(row.complaintTotal ?? row.openComplaintCount ?? 0);
  const sellerComplaintUnresolved = (row: any): number => Number(row.complaintUnresolved ?? row.openComplaintCount ?? 0);
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
    if (key === "top_selling_foods") {
      return sellerTotalFoods(row) > 0 && sellerOrderCurrent(row) >= sellerTopSellingFoodsOrderThreshold && sellerOrderCurrent(row) > 0;
    }
    if (key === "top_revenue") return sellerRevenue(row) >= sellerTopRevenueThreshold && sellerRevenue(row) > 0;
    if (key === "performance_drop") return sellerOrderCurrent(row) < sellerOrderPrevious(row);
    if (key === "urgent_action") return sellerRiskMeta(row).level === "high";
    return sellerComplaintTotal(row) > 0;
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
          top_selling_foods: 0,
          top_revenue: 0,
          performance_drop: 0,
          urgent_action: 0,
          complainer_sellers: 0,
        } as Record<SellerSmartFilterKey, number>
      ),
    [trRows, sellerTopRevenueThreshold, sellerTopSellingFoodsOrderThreshold]
  );
  const buyerQuickFilterCounts = useMemo(() => {
    if (!isBuyerPage) {
      return {
        all: 0,
        risky: 0,
        open_complaint: 0,
        down_spend: 0,
      };
    }

    let baseRows = rows;
    if (buyerFilters.status !== "all") {
      baseRows = baseRows.filter((row) => row.status === buyerFilters.status);
    }
    if (buyerFilters.complaint === "has_unresolved") {
      baseRows = baseRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
    } else if (buyerFilters.complaint === "resolved_only") {
      baseRows = baseRows.filter((row) => Number(row.complaintTotal ?? 0) > 0 && Number(row.complaintUnresolved ?? 0) === 0);
    } else if (buyerFilters.complaint === "no_complaint") {
      baseRows = baseRows.filter((row) => Number(row.complaintTotal ?? 0) === 0);
    }
    if (buyerFilters.orderTrend !== "all") {
      baseRows = baseRows.filter(
        (row) => trendDirection(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)) === buyerFilters.orderTrend
      );
    }
    if (buyerFilters.spendTrend !== "all") {
      baseRows = baseRows.filter(
        (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === buyerFilters.spendTrend
      );
    }

    return {
      all: baseRows.length,
      risky: baseRows.filter((row) => computeBuyerRisk(row).level !== "low").length,
      open_complaint: baseRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0).length,
      down_spend: baseRows.filter(
        (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === "down"
      ).length,
    };
  }, [buyerFilters, isBuyerPage, rows]);
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
      } else if (buyerQuickFilter === "open_complaint") {
        scopedRows = scopedRows.filter((row) => Number(row.complaintUnresolved ?? 0) > 0);
      } else if (buyerQuickFilter === "down_spend") {
        scopedRows = scopedRows.filter(
          (row) => trendDirection(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)) === "down"
        );
      }
    }

    if (!last7DaysOnly) return scopedRows;
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return scopedRows.filter((row) => {
      const created = Date.parse(String(row.createdAt ?? ""));
      return !Number.isNaN(created) && now - created <= sevenDays;
    });
  }, [activeSellerKpiFilter, activeSellerSmartFilter, buyerFilters, buyerQuickFilter, isBuyerPage, isSellerPage, last7DaysOnly, rows, searchInput, sellerStatusFilter, todayKey]);

  function resolveColumnLabel(columnName: string): string {
    const mapped = columnMappings[columnName] ?? columnName;
    if (mapped === "id") return "ID";
    if (mapped === "displayName") return isSellerPage ? (language === "tr" ? "Satıcı Adı" : "Seller Name") : language === "tr" ? "Ad Soyad" : "Full Name";
    if (mapped === "email") return language === "tr" ? "E-Posta" : "Email";
    if (mapped === "phone") return language === "tr" ? "Telefon" : "Phone";
    if (mapped === "status") return dict.users.status;
    if (mapped === "totalFoods") return language === "tr" ? "Yemek" : "Foods";
    if (mapped === "role") return dict.users.role;
    if (mapped === "countryCode") return language === "tr" ? "Ülke" : "Country";
    if (mapped === "language") return language === "tr" ? "Dil" : "Language";
    if (mapped === "createdAt") return language === "tr" ? "Kayıt Tarihi" : "Created At";
    if (mapped === "updatedAt") return language === "tr" ? "Son Güncelleme" : "Updated At";
    if (mapped === "lastLoginAt") return language === "tr" ? "Son Giriş" : "Last Login";
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
      return <span className={`status-pill ${status === "active" ? "is-active" : "is-disabled"}`}>{status === "active" ? "Aktif" : "Pasif"}</span>;
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
      if (cc === "TR") return "Türkiye";
      if (cc === "US") return "United States";
      if (cc === "IT") return "Italy";
      if (cc === "JP") return "Japan";
      if (cc === "FR") return "France";
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

  function formatTry(value: number): string {
    return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(value);
  }

  function exportCellValue(row: any, columnName: string): string {
    const mapped = columnMappings[columnName] ?? columnName;
    const value = row[mapped];
    if (mapped === "id") return String(value ?? "");
    if (mapped === "status") return value === "disabled" ? (language === "tr" ? "Pasif" : "Disabled") : language === "tr" ? "Aktif" : "Active";
    if (mapped === "countryCode") {
      const cc = String(value ?? "").toUpperCase();
      if (cc === "TR") return "Türkiye";
      if (cc === "US") return "United States";
      if (cc === "IT") return "Italy";
      if (cc === "JP") return "Japan";
      if (cc === "FR") return "France";
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
      language === "tr" ? "Toplam Şikayet" : "Total Complaints",
      language === "tr" ? "Çözülen Şikayet" : "Resolved Complaints",
      language === "tr" ? "Çözülmeyen Şikayet" : "Unresolved Complaints",
      language === "tr" ? "Sipariş Trendi (30g/önceki 30g)" : "Order Trend (30d/prev 30d)",
      language === "tr" ? "Harcama Trendi (30g/önceki 30g)" : "Spend Trend (30d/prev 30d)",
    ];

    const rowsForExport = filteredRows.map((row) => [
      ...tableColumns.map((column) => exportCellValue(row, column)),
      String(Number(row.complaintTotal ?? 0)),
      String(Number(row.complaintResolved ?? 0)),
      String(Number(row.complaintUnresolved ?? 0)),
      `${trendArrow(Number(row.monthlyOrderCountCurrent ?? 0), Number(row.monthlyOrderCountPrevious ?? 0)).symbol} ${Number(row.monthlyOrderCountCurrent ?? 0)} / ${Number(row.monthlyOrderCountPrevious ?? 0)}`,
      `${trendArrow(Number(row.monthlySpentCurrent ?? 0), Number(row.monthlySpentPrevious ?? 0)).symbol} ${formatTry(Number(row.monthlySpentCurrent ?? 0))} / ${formatTry(Number(row.monthlySpentPrevious ?? 0))}`,
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
    const headers = ["Satici Adi", "E-Posta", "Satici ID", "Durum", "Yemek Sayisi", "Aylik Siparis", "Aylik Ciro"];
    const rowsForExport = filteredRows.map((row) => [
      String(row.displayName ?? row.email ?? ""),
      String(row.email ?? ""),
      String(row.id ?? ""),
      row.status === "disabled" ? "Pasif" : "Aktif",
      String(sellerTotalFoods(row)),
      String(sellerOrderCurrent(row)),
      formatTry(sellerRevenue(row)),
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

      if (buyerFilterMenuOpen && buyerFilterWrapRef.current && !buyerFilterWrapRef.current.contains(target)) {
        setBuyerFilterMenuOpen(false);
      }

      if (buyerActionMenuId && buyerBoardRef.current) {
        const actionRoot = (target as HTMLElement).closest(".buyer-v2-row-actions");
        if (!actionRoot) {
          setBuyerActionMenuId(null);
        }
      }
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [buyerActionMenuId, buyerFilterMenuOpen, isBuyerPage]);

  if (isSellerPage) {
    const totalTrSellers = trRows.length;
    const activeTrSellers = trRows.filter((row) => row.status === "active").length;
    const passiveTrSellers = trRows.filter((row) => row.status === "disabled").length;
    const todayTrSellers = trRows.filter((row) => String(row.createdAt ?? "").slice(0, 10) === todayKey).length;
    const primarySmartItems: SellerSmartFilterKey[] = [
      "pending_approvals",
      "missing_documents",
      "suspicious_logins",
      "top_selling_foods",
      "top_revenue",
      "performance_drop",
      "urgent_action",
      "complainer_sellers",
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
            icon="👥" label="Toplam Satıcı"
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
            icon="✓" iconVariant="good" colorVariant="green" label="Aktif Satıcı"
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
            icon="◔" iconVariant="warn" colorVariant="orange" label="Pasif Satıcı"
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
            icon="☀" iconVariant="good" label="Bugün Yeni Satıcı"
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
          <aside className="panel buyer-v2-smart-panel seller-v2-smart-panel" aria-label="Akıllı filtreler">
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
                    Güncelleme: Yeni → Eski {filters.sortDir === "desc" ? "Azalan" : "Artan"} ▼
                  </button>
                </div>
                <div className="seller-v2-toolbar-right">
                  <button className="primary buyer-v2-export" type="button" onClick={downloadSellersAsExcel}>Excel'e Aktar</button>
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
                      <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                      <th>Mağaza Adı</th>
                      <th>Durum</th>
                      <th>Uyarılar</th>
                      <th>Sipariş Sağlığı</th>
                      <th>Rating Trend</th>
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
                        const sellerName = String(row.displayName ?? row.email ?? "Satıcı");
                        const warningA = sellerSuspiciousLogin(row) > 0 ? "A" : "•";
                        const warningInfo = sellerComplaintUnresolved(row);

                        return (
                          <tr
                            key={row.id}
                            className="is-clickable"
                            onClick={() => navigate(`/app/sellers/${row.id}`)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                navigate(`/app/sellers/${row.id}`);
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
                              <span className={`seller-v2-like-pill ${row.status === "active" ? "is-good" : ""}`}>
                                👍 {row.status === "active" ? 1 : 0}
                              </span>
                            </td>
                            <td>
                              <div className="seller-v2-warning-cell">
                                <span className={`seller-v2-tag ${warningA === "A" ? "is-red" : ""}`}>{warningA}</span>
                                <span>{warningInfo}</span>
                                <span>◔ {sellerMissingDoc(row)}</span>
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
                                  navigate(`/app/sellers/${row.id}`);
                                }}
                              >
                                <span aria-hidden="true">{row.status === "active" ? "◉ Detay ▾" : "◉ Aktif Yap"}</span>
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
                KPI veya soldaki filtrelerden birine tıklayınca tablo açılır.
              </div>
            )}

            {isSellerTableOpen ? (
              <div className="buyer-v2-footer seller-v2-footer">
                <div className="buyer-v2-pager-left">
                  <button className="ghost buyer-v2-page-btn" type="button">10 / sayfa ▼</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}>
                    Önceki
                  </button>
                  <button className="ghost buyer-v2-page-btn is-active" type="button">{String(filters.page)}</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 1, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 2, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
                  <button className="ghost buyer-v2-page-btn" type="button" disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}>
                    Sonraki
                  </button>
                </div>
                <div className="buyer-v2-pager-right">
                  <span className="panel-meta">{`${Math.min((filters.page - 1) * filters.pageSize + 1, pagination?.total ?? 0)}-${Math.min(filters.page * filters.pageSize, pagination?.total ?? 0)} / ${pagination?.total ?? 0} kayıt`}</span>
                  <button
                    className="ghost buyer-v2-page-btn"
                    type="button"
                    disabled={filters.page <= 1}
                    onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
                  >
                    ‹
                  </button>
                  <button
                    className="ghost buyer-v2-page-btn"
                    type="button"
                    disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)}
                    onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
                  >
                    ›
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </section>
      </div>
    );
  }
  if (isBuyerPage) {
    return (
      <div className="app buyer-v2-page">
        <section className="buyer-v2-kpis seller-v2-kpis">
          <KpiCard
            icon="👥"
            label="Toplam Alıcı"
            value={new Intl.NumberFormat("tr-TR").format(totalBuyersCount)}
            className="seller-v2-kpi"
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
            label="Aktif Alıcı"
            value={new Intl.NumberFormat("tr-TR").format(activeRows.length)}
            className="seller-v2-kpi"
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
            label="Şikayetli Alıcı"
            value={new Intl.NumberFormat("tr-TR").format(buyersWithOpenComplaints)}
            className="seller-v2-kpi"
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-orange" /><span className="seller-v2-dot is-orange" />
              <span className="seller-v2-dot is-orange" /><span className="seller-v2-dot is-orange" />
            </div>
          </KpiCard>
          <KpiCard
            icon="🛡"
            iconVariant="danger"
            label="Riskli Alıcı"
            value={new Intl.NumberFormat("tr-TR").format(riskyBuyersCount)}
            className="seller-v2-kpi"
          >
            <div className="seller-v2-kpi-dots">
              <span className="seller-v2-dot is-red" /><span className="seller-v2-dot is-red" />
              <span className="seller-v2-dot is-red" /><span className="seller-v2-dot is-red" />
            </div>
          </KpiCard>
        </section>

        <section className="buyer-v2-main-layout">
          <aside className="panel buyer-v2-smart-panel" aria-label="Akilli filtreler">
            <h2>Akilli Filtreler</h2>
            <div className="buyer-v2-smart-list">
              {BUYER_SMART_FILTER_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`buyer-v2-smart-item ${activeSmartFilter === item.key ? "is-active" : ""}`}
                  aria-pressed={activeSmartFilter === item.key}
                  onClick={() => {
                    setActiveSmartFilter((prev) => (prev === item.key ? null : item.key));
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  <span className="buyer-v2-smart-item-icon" aria-hidden="true">{item.icon}</span>
                  <span className="buyer-v2-smart-item-label">{item.label}</span>
                  <span className="buyer-v2-smart-item-count">{smartFilterCounts[item.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <h2>Hızlı Filtreler</h2>
            <div className="buyer-v2-smart-list buyer-v2-quick-filter-list">
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "all" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("all");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">◉</span>
                <span className="buyer-v2-smart-item-label">Tümü</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.all}</span>
              </button>
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "risky" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("risky");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">⚠</span>
                <span className="buyer-v2-smart-item-label">Riskli</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.risky}</span>
              </button>
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "open_complaint" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("open_complaint");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">✉</span>
                <span className="buyer-v2-smart-item-label">Şikayetli</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.open_complaint}</span>
              </button>
              <button
                type="button"
                className={`buyer-v2-smart-item buyer-v2-quick-filter-item ${buyerQuickFilter === "down_spend" ? "is-active" : ""}`}
                onClick={() => {
                  setBuyerQuickFilter("down_spend");
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <span className="buyer-v2-smart-item-icon" aria-hidden="true">↓</span>
                <span className="buyer-v2-smart-item-label">Azalan Harcama</span>
                <span className="buyer-v2-smart-item-count">{buyerQuickFilterCounts.down_spend}</span>
              </button>
            </div>
          </aside>

          <section className="panel buyer-v2-board">
          <div className="buyer-v2-toolbar">
            <div className="buyer-v2-toolbar-actions">
              <div className="buyer-v2-filter-wrap" ref={buyerFilterWrapRef}>
                <button className="ghost buyer-v2-toolbar-btn" type="button" onClick={() => setBuyerFilterMenuOpen((prev) => !prev)}>
                  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                    <path d="M3 6h18M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Filtreler ▾
                </button>
                {buyerFilterMenuOpen ? (
                  <div className="buyer-v2-filter-menu">
                    <label>
                      Durum
                      <select
                        value={buyerFilterDraft.status}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, status: event.target.value as typeof prev.status }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="active">Aktif</option>
                        <option value="disabled">Pasif</option>
                      </select>
                    </label>
                    <label>
                      Şikayet
                      <select
                        value={buyerFilterDraft.complaint}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, complaint: event.target.value as typeof prev.complaint }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="has_unresolved">Açık Şikayetli</option>
                        <option value="resolved_only">Sadece Çözülen</option>
                        <option value="no_complaint">Yok</option>
                      </select>
                    </label>
                    <label>
                      Sipariş Trendi
                      <select
                        value={buyerFilterDraft.orderTrend}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, orderTrend: event.target.value as typeof prev.orderTrend }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="up">Artan</option>
                        <option value="down">Azalan</option>
                      </select>
                    </label>
                    <label>
                      Harcama Trendi
                      <select
                        value={buyerFilterDraft.spendTrend}
                        onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, spendTrend: event.target.value as typeof prev.spendTrend }))}
                      >
                        <option value="all">Tümü</option>
                        <option value="up">Artan</option>
                        <option value="down">Azalan</option>
                      </select>
                    </label>
                    <div className="buyer-v2-filter-menu-actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          setBuyerFilterDraft({ status: "all", complaint: "all", orderTrend: "all", spendTrend: "all" });
                          setBuyerFilters({ status: "all", complaint: "all", orderTrend: "all", spendTrend: "all" });
                          setFilters((prev) => ({ ...prev, page: 1 }));
                          setBuyerFilterMenuOpen(false);
                        }}
                      >
                        Sıfırla
                      </button>
                      <button
                        className="primary"
                        type="button"
                        onClick={() => {
                          setBuyerFilters(buyerFilterDraft);
                          setFilters((prev) => ({ ...prev, page: 1 }));
                          setBuyerFilterMenuOpen(false);
                        }}
                      >
                        Uygula
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button className="ghost buyer-v2-icon-btn" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>⟳</button>
              <button className="primary buyer-v2-export" type="button" onClick={downloadBuyersAsExcel}>Excel'e Aktar</button>
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
                  <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                  <th>Alıcı</th>
                  <th>Risk</th>
                  <th>Şikayet</th>
                  <th>Sipariş (1 Ay)</th>
                  <th>Harcama (1 Ay)</th>
                  <th>Son Giris</th>
                  <th>Durum</th>
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
                          <span className={`risk-pill is-${risk.level}`}>
                            {risk.level === "high" ? "Yüksek" : risk.level === "medium" ? "Orta" : "Düşük"}
                          </span>
                        </td>
                        <td>
                          <div className="buyer-complaint-cell">
                            <strong>{totalComplaints}</strong>
                            {unresolved > 0 ? <span className="complaint-open-chip">{`◀ ${unresolved} Açık`}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="buyer-orders-cell">
                            <strong>{orderCurrent}</strong>
                            <span className={`buyer-trend ${orderTrendMeta.className}`}>{orderTrendMeta.symbol}</span>
                            {orderDelta !== 0 ? (
                              <span className={`buyer-delta ${orderDelta > 0 ? "is-up" : "is-down"}`}>{Math.abs(orderDelta)}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className="buyer-spend-cell">
                            <strong>{formatTry(spendCurrent)}</strong>
                            <span className={`buyer-trend ${spendTrendMeta.className}`}>{spendTrendMeta.symbol}</span>
                            {spendDelta === 0 ? <span className="buyer-dot">•</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="buyer-login-cell">
                            <strong>{loginAt}</strong>
                            {risk.level === "high" ? <span className="status-pill is-warning">⚠ Yuksek</span> : null}
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${row.status === "active" ? "is-active" : "is-neutral"}`}>
                            {row.status === "active" ? "Aktif" : "Pasif"}
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
                                Hızlı E-posta
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
                                Telefon
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

          <div className="buyer-v2-footer">
            <div className="buyer-v2-pager-left">
              <button className="ghost buyer-v2-page-btn" type="button">‹</button>
              <button className="ghost buyer-v2-page-btn" type="button">›</button>
              <button className="ghost buyer-v2-page-btn is-active" type="button">{String(filters.page)}</button>
              <button className="ghost buyer-v2-page-btn" type="button">{String(Math.min(filters.page + 1, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <button className="ghost buyer-v2-page-btn" type="button">{String(Math.min(filters.page + 2, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <span className="panel-meta">/ 110+ Kullanıcı</span>
            </div>
            <div className="buyer-v2-pager-right">
              <button className="ghost buyer-v2-page-btn" type="button" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}>‹</button>
              <button className="ghost buyer-v2-page-btn is-active" type="button">{String(filters.page)}</button>
              <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 1, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <button className="ghost buyer-v2-page-btn" type="button" disabled>{String(Math.min(filters.page + 2, Math.max(pagination?.totalPages ?? 1, 1)))}</button>
              <button
                className="ghost buyer-v2-page-btn"
                type="button"
                disabled={filters.page >= Math.max(pagination?.totalPages ?? 1, 1)}
                onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                ›
              </button>
            </div>
          </div>
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
              <strong>{language === "tr" ? "Müşteri ID" : "Customer ID"}</strong>
              <code>{customerIdPreview}</code>
              <button className="ghost" type="button" onClick={() => setCustomerIdPreview(null)}>
                {language === "tr" ? "Kapat" : "Close"}
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
              <button className="primary" type="button" onClick={downloadBuyersAsExcel}>
                {dict.actions.exportExcel}
              </button>
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
              {language === "tr" ? "Kompakt" : "Compact"}
            </button>
            <button type="button" className={density === "normal" ? "is-active" : ""} onClick={() => setDensity("normal")}>
              {language === "tr" ? "Normal" : "Normal"}
            </button>
            <button type="button" className={density === "comfortable" ? "is-active" : ""} onClick={() => setDensity("comfortable")}>
              {language === "tr" ? "Rahat" : "Comfort"}
            </button>
          </div>
        ) : null}
        {isBuyerPage ? (
          <>
            <article>
              <div className="users-kpi-row">
                <p>{language === "tr" ? "Toplam Alıcı" : "Total Buyers"}</p>
                <strong className="users-kpi-value">{totalBuyersCount}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row users-kpi-row-progress">
                <p>{language === "tr" ? "Aktif Oranı" : "Active Ratio"}</p>
                <strong className="users-kpi-value is-active">%{activeRatio}</strong>
              </div>
              <div className="users-kpi-progress">
                <span style={{ width: `${activeRatio}%` }} />
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{language === "tr" ? "Şikayetli Alıcı" : "Buyers with Complaints"}</p>
                <strong className="users-kpi-value">{buyersWithOpenComplaints}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{language === "tr" ? "Riskli Alıcı" : "Risky Buyers"}</p>
                <strong className="users-kpi-value">{riskyBuyersCount}</strong>
              </div>
            </article>
          </>
        ) : (
          <>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Toplam TR Satıcı" : "Total TR Sellers") : language === "tr" ? "Toplam Alıcılar" : "Total Buyers"}</p>
                <strong className="users-kpi-value">{isSellerPage ? trRows.length : pagination?.total ?? rows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Aktif TR Satıcı" : "Active TR Sellers") : language === "tr" ? "Aktif Alıcılar" : "Active Buyers"}</p>
                <strong className="users-kpi-value is-active">{isSellerPage ? trRows.filter((row) => row.status === "active").length : activeRows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Pasif TR Satıcı" : "Disabled TR Sellers") : language === "tr" ? "Pasif Alıcılar" : "Disabled Buyers"}</p>
                <strong className="users-kpi-value">{isSellerPage ? trRows.filter((row) => row.status === "disabled").length : passiveRows.length}</strong>
              </div>
            </article>
            <article>
              <div className="users-kpi-row">
                <p>{isSellerPage ? (language === "tr" ? "Bugün Yeni TR Satıcı" : "New TR Sellers Today") : language === "tr" ? "Bugün Yeni" : "New Today"}</p>
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
                  <option value="all">{language === "tr" ? "Durum: Tümü" : "Status: All"}</option>
                  <option value="active">{language === "tr" ? "Durum: Aktif" : "Status: Active"}</option>
                  <option value="disabled">{language === "tr" ? "Durum: Pasif" : "Status: Disabled"}</option>
                </select>
                <select
                  value={buyerFilterDraft.complaint}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, complaint: event.target.value as typeof prev.complaint }))}
                >
                  <option value="all">{language === "tr" ? "Şikayet: Tümü" : "Complaints: All"}</option>
                  <option value="has_unresolved">{language === "tr" ? "Şikayet: Çözülmeyen var" : "Complaints: Has unresolved"}</option>
                  <option value="resolved_only">{language === "tr" ? "Şikayet: Sadece çözülen" : "Complaints: Resolved only"}</option>
                  <option value="no_complaint">{language === "tr" ? "Şikayet: Yok" : "Complaints: None"}</option>
                </select>
                <select
                  value={buyerFilterDraft.orderTrend}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, orderTrend: event.target.value as typeof prev.orderTrend }))}
                >
                  <option value="all">{language === "tr" ? "Sipariş Trendi: Tümü" : "Order Trend: All"}</option>
                  <option value="up">{language === "tr" ? "Sipariş Trendi: Artan" : "Order Trend: Up"}</option>
                  <option value="down">{language === "tr" ? "Sipariş Trendi: Azalan" : "Order Trend: Down"}</option>
                </select>
                <select
                  value={buyerFilterDraft.spendTrend}
                  onChange={(event) => setBuyerFilterDraft((prev) => ({ ...prev, spendTrend: event.target.value as typeof prev.spendTrend }))}
                >
                  <option value="all">{language === "tr" ? "Harcama Trendi: Tümü" : "Spend Trend: All"}</option>
                  <option value="up">{language === "tr" ? "Harcama Trendi: Artan" : "Spend Trend: Up"}</option>
                  <option value="down">{language === "tr" ? "Harcama Trendi: Azalan" : "Spend Trend: Down"}</option>
                </select>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "all" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("all");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Tümü" : "All"}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "risky" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("risky");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Riskli" : "Risky"}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "open_complaint" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("open_complaint");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Açık Şikayetli" : "Open Complaints"}
                </button>
                <button
                  type="button"
                  className={`chip ${buyerQuickFilter === "down_spend" ? "is-active" : ""}`}
                  onClick={() => {
                    setBuyerQuickFilter("down_spend");
                    setFilters((prev) => ({ ...prev, page: 1 }));
                  }}
                >
                  {language === "tr" ? "Azalan Harcama" : "Down Spend"}
                </button>
              </div>
            ) : null}
            {isSellerPage ? (
              <>
                <button type="button" className={`chip ${sellerStatusFilter === "all" ? "is-active" : ""}`} onClick={() => setSellerStatusFilter("all")}>
                  {language === "tr" ? "Tüm TR" : "All TR"}
                </button>
                <button
                  type="button"
                  className={`chip ${sellerStatusFilter === "active" ? "is-active" : ""}`}
                  onClick={() => setSellerStatusFilter("active")}
                >
                  {language === "tr" ? "Aktif" : "Active"}
                </button>
                <button
                  type="button"
                  className={`chip ${sellerStatusFilter === "disabled" ? "is-active" : ""}`}
                  onClick={() => setSellerStatusFilter("disabled")}
                >
                  {language === "tr" ? "Pasif" : "Disabled"}
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
                {language === "tr" ? "Son 7 Gün" : "Last 7 Days"}
              </button>
            ) : null}
            {!isSellerPage && !isBuyerPage ? <span className={`chip ${showState === "loading" ? "is-active" : ""}`}>{dict.common.loading}</span> : null}
            {!isSellerPage && !isBuyerPage ? (
              <span className={`chip ${showState === "empty" ? "is-active" : ""}`}>{language === "tr" ? "Hiç alıcı bulunamadı" : "No buyers found"}</span>
            ) : null}
            {!isSellerPage && !isBuyerPage ? <span className={`chip ${showState === "error" ? "is-active" : ""}`}>{language === "tr" ? "Bir hata oluştu" : "An error occurred"}</span> : null}
            {showState === "error" && !isBuyerPage ? (
              <button className="chip is-active" type="button" onClick={() => loadRows().catch(() => setError(dict.users.requestFailed))}>
                {language === "tr" ? "Yeniden Dene" : "Retry"}
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
            {isSellerPage
              ? language === "tr"
                ? "Güncelleme: Yeni → Eski "
                : "Updated: New → Old "
              : language === "tr"
                ? "Sırala: Kayıt Tarihi • "
                : "Sort: Created Date • "}
            {filters.sortDir === "desc" ? (language === "tr" ? "Azalan" : "Desc") : language === "tr" ? "Artan" : "Asc"} ▼
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
              {language === "tr" ? "Filtrele" : "Filter"}
            </button>
          ) : null}
        </div>
        <div className={`table-wrap users-table-wrap density-${density}`}>
          <table>
            <thead>
              <tr>
                {isBuyerPage ? (
                  <>
                    <th>{language === "tr" ? "Display ID" : "Display ID"}</th>
                    <th>{language === "tr" ? "Alıcı" : "Buyer"}</th>
                    <th>{language === "tr" ? "Risk" : "Risk"}</th>
                    <th>{language === "tr" ? "Şikayet" : "Complaints"}</th>
                    <th>{language === "tr" ? "Sipariş (1 Ay)" : "Orders (1 Month)"}</th>
                    <th>{language === "tr" ? "Harcama (1 Ay)" : "Spend (1 Month)"}</th>
                    <th>{language === "tr" ? "Durum" : "Status"}</th>
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
                              {risk.level === "high" ? (language === "tr" ? "Yüksek" : "High") : risk.level === "medium" ? (language === "tr" ? "Orta" : "Medium") : language === "tr" ? "Düşük" : "Low"}
                            </span>
                          </td>
                          <td>
                            <div className="buyer-complaint-cell">
                              <strong>{totalComplaints}</strong>
                              {unresolved > 0 ? <span className="complaint-open-chip">{`${unresolved} ${language === "tr" ? "Açık" : "Open"}`}</span> : null}
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
                              <strong>{formatTry(Number(row.monthlySpentCurrent ?? 0))}</strong>
                              <span>{spendTrendMeta.symbol}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-pill ${row.status === "active" ? "is-active" : "is-neutral"}`}>
                              {row.status === "active" ? (language === "tr" ? "Aktif" : "Active") : language === "tr" ? "Pasif" : "Passive"}
                            </span>
                          </td>
                          <td className="cell-actions">
                            <button
                              className="ghost action-menu-btn"
                              type="button"
                              aria-label={language === "tr" ? "Aksiyon menüsü" : "Action menu"}
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
                              <span aria-hidden="true">◉ Detay</span>
                              <span className="sr-only">{dict.actions.detail}</span>
                            </button>
                          ) : null}
                          {isSuperAdmin && !isSellerPage ? (
                            <button
                              className="ghost action-btn"
                              type="button"
                              title={language === "tr" ? "Pasif Yap" : "Disable"}
                              aria-label={dict.actions.toggleStatus}
                              onClick={() => toggleStatusAction(row)}
                            >
                              <span aria-hidden="true">◔ {language === "tr" ? "Pasif Yap" : "Disable"}</span>
                              <span className="sr-only">{dict.actions.toggleStatus}</span>
                            </button>
                          ) : !isSellerPage ? (
                            <button className="ghost action-btn" type="button" disabled title={dict.users.onlySuperAdmin}>
                              Yetkiniz yok
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
          onPrev={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
          onNext={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
        />
      </section>

      <div className={`drawer-overlay ${isDrawerOpen ? "is-open" : ""}`} onClick={closeDrawer}>
        <aside className={`form-drawer ${isDrawerOpen ? "is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="form-drawer-header">
            <h2>{drawerMode === "edit" ? "Edit User" : createTitle}</h2>
            <button className="ghost" type="button" onClick={closeDrawer} disabled={saving}>
              Close
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
                {saving ? "Saving..." : dict.actions.create}
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
                {saving ? "Saving..." : dict.actions.save}
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
              Close
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
            <h2>{language === "tr" ? "Durum Değişikliğini Onayla" : "Confirm Status Change"}</h2>
          </div>
          <p className="panel-meta">
            {pendingStatusChange?.next === "active" ? (language === "tr" ? "Kullanıcı aktif yapılacak." : "User will be activated.") : (language === "tr" ? "Kullanıcı pasif yapılacak." : "User will be disabled.")}
          </p>
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={() => setPendingStatusChange(null)}>
              {language === "tr" ? "Vazgeç" : "Cancel"}
            </button>
            <button className="primary" type="button" onClick={() => confirmStatusChange().catch(() => setError(dict.users.updateFailed))}>
              {language === "tr" ? "Onayla" : "Confirm"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default UsersPage;
