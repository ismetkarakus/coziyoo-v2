import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request, parseJson } from "../lib/api";
import { DICTIONARIES } from "../lib/i18n";
import { StatCard, LineChart, SparklineChart } from "../components/dashboard";
import type { Language, Dictionary, ApiError } from "../types/core";

function DataTableCard({
  title,
  metricLabel,
  valueLabel,
  rows,
  updatedAt,
  dict,
}: {
  title: string;
  metricLabel: string;
  valueLabel: string;
  rows: Array<{ label: string; value: string }>;
  updatedAt: string;
  dict: Dictionary;
}) {
  const axisLabels = ["16:30", "19:30", "22:30", "01:30", "04:30", "07:30", "10:30"];
  const queuePoints = [6, 4.5, 6, 5, 4, 4.1, 6.5];
  const sparkPoints = [6.2, 6.1, 5.8, 6.3, 6.2, 6, 5.9, 5.7];
  const queueRows = [
    { name: dict.dashboard.queuePrint, count: 14, tone: "dot-blue" },
    { name: dict.dashboard.queueDownload, count: 26, tone: "dot-cyan" },
    { name: dict.dashboard.queueMessageJob, count: 36, tone: "dot-teal" },
    { name: dict.dashboard.queueMedia, count: 24, tone: "dot-red" },
  ];

  return (
    <article className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="kpi-detail-grid">
        <div className="kpi-left">
          <div className="kpi-table">
            <div className="kpi-table-row kpi-table-head">
              <span>{metricLabel}</span>
              <span>{valueLabel}</span>
            </div>
            {rows.map((row) => (
              <div className="kpi-table-row" key={row.label}>
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
          <p className="kpi-updated">{dict.dashboard.lastUpdated}: {updatedAt}</p>
        </div>
        <div className="kpi-right">
          <h3>{dict.dashboard.jobLoadTest}</h3>
          <LineChart labels={axisLabels} points={queuePoints} max={10} />
          <div className="chart-legend">
            <span><i className="dot dot-blue" />{dict.dashboard.waiting}</span>
            <span><i className="dot dot-teal" />{dict.dashboard.processing}</span>
            <span><i className="dot dot-red" />{dict.dashboard.failed}</span>
          </div>
          <div className="queue-list">
            {queueRows.map((row) => (
              <div className="queue-row" key={row.name}>
                <span className="queue-name"><i className={`dot ${row.tone}`} />{row.name}</span>
                <span className="queue-status">{row.count} {dict.dashboard.files}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="line-chart-wrap">
        <SparklineChart labels={["16:30", "19:30", "22:30", "01:30", "04:30", "07:30", "10:30", "13:30"]} points={sparkPoints} />
        <div className="chart-legend compact">
          <span><i className="dot dot-blue" />{dict.dashboard.waiting}</span>
          <span><i className="dot dot-cyan" />{dict.dashboard.processing}</span>
          <span><i className="dot dot-red" />{dict.dashboard.failed}</span>
        </div>
      </div>
    </article>
  );
}

function ActionCard({
  title,
  dict,
  updatedAt,
  queueSummary,
  onOpenCompliance,
  onViewDisputes,
  onInspectAppUsers,
  onInspectAdminUsers,
}: {
  title: string;
  dict: Dictionary;
  updatedAt: string;
  queueSummary: { waiting: number; processing: number; failed: number };
  onOpenCompliance: () => void;
  onViewDisputes: () => void;
  onInspectAppUsers: () => void;
  onInspectAdminUsers: () => void;
}) {
  const total = Math.max(queueSummary.waiting + queueSummary.processing + queueSummary.failed, 1);
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const waitingLength = (queueSummary.waiting / total) * circumference;
  const processingLength = (queueSummary.processing / total) * circumference;
  const failedLength = (queueSummary.failed / total) * circumference;

  return (
    <article className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="actions">
        <button className="ghost has-arrow quick-action-btn" type="button" onClick={onOpenCompliance}>{dict.actions.openComplianceQueue}</button>
        <button className="ghost has-arrow quick-action-btn" type="button" onClick={onViewDisputes}>{dict.actions.viewPaymentDisputes}</button>
        <button className="ghost has-arrow quick-action-btn" type="button" onClick={onInspectAppUsers}>{dict.actions.inspectAppUsers}</button>
        <button className="ghost has-arrow quick-action-btn" type="button" onClick={onInspectAdminUsers}>{dict.actions.inspectAdminUsers}</button>
      </div>
      <div className="queue-state-card">
        <div className="queue-state-header">
          <h3>{dict.dashboard.processingStatus}</h3>
          <span>{updatedAt}</span>
        </div>
        <div className="queue-state-content">
          <div className="queue-state-labels">
            <p>{dict.dashboard.printJobs}</p>
            <p>{dict.dashboard.downloadJobs}</p>
            <p>{dict.dashboard.messageTaskJobs}</p>
            <p>{dict.dashboard.mediaJobs}</p>
          </div>
          <div className="donut-wrap">
            <svg className="donut-chart" viewBox="0 0 160 160" role="presentation" aria-hidden="true">
              <circle className="donut-bg" cx="80" cy="80" r={radius} />
              <circle
                className="donut-segment donut-segment-blue"
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${waitingLength} ${circumference}`}
                strokeDashoffset="0"
              />
              <circle
                className="donut-segment donut-segment-cyan"
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${processingLength} ${circumference}`}
                strokeDashoffset={`${-waitingLength}`}
              />
              <circle
                className="donut-segment donut-segment-red"
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${failedLength} ${circumference}`}
                strokeDashoffset={`${-(waitingLength + processingLength)}`}
              />
            </svg>
            <div className="donut-center">24/7</div>
          </div>
        </div>
        <div className="chart-legend compact">
          <span><i className="dot dot-blue" />{dict.dashboard.waiting}</span>
          <span><i className="dot dot-cyan" />{dict.dashboard.processing}</span>
          <span><i className="dot dot-red" />{dict.dashboard.failed}</span>
        </div>
        <p className="queue-foot">{dict.dashboard.lastUpdated}: {updatedAt}</p>
      </div>
    </article>
  );
}

export default function DashboardPage({ language }: { language: Language }) {
  const navigate = useNavigate();
  const dict = DICTIONARIES[language];
  const [data, setData] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const counterpartNotFound = dict.common.counterpartNotFound;

  const metricValueOrMissing = (value: unknown): number | string => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return counterpartNotFound;
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
    return counterpartNotFound;
  };

  useEffect(() => {
    let intervalId: number | null = null;
    const tick = () => setLiveTick((prev) => prev + 1);
    const restartInterval = () => {
      if (intervalId) window.clearInterval(intervalId);
      if (document.visibilityState === "visible") {
        intervalId = window.setInterval(tick, 15000);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
      restartInterval();
    };
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    restartInterval();
    return () => {
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    request("/v1/admin/dashboard/overview")
      .then(async (response) => {
        if (response.status !== 200) {
          const body = (await parseJson<ApiError>(response)) ?? {};
          setError(body.error?.message ?? dict.dashboard.loadFailed);
          return;
        }
        const body = await parseJson<{ data: Record<string, number | string> }>(response);
        setData(body.data);
      })
      .catch(() => setError(dict.dashboard.requestFailed));
  }, [dict.dashboard.loadFailed, dict.dashboard.requestFailed, liveTick]);

  if (error) return <div className="alert">{error}</div>;
  if (!data) return <div className="panel">{dict.common.loading}</div>;
  const updatedAtRaw = typeof data.updatedAt === "string" ? data.updatedAt : null;
  const updatedAtDisplay = updatedAtRaw ? updatedAtRaw.replace("T", " ").replace("Z", "").slice(0, 19) : counterpartNotFound;
  const metrics: Array<{
    key: string;
    label: string;
    icon: "users" | "lock" | "orders" | "mail" | "clock";
    value: string | number;
    trailingIcon?: "refresh";
  }> = [
    { key: "totalUsers", label: dict.dashboard.totalUsers, icon: "users", value: metricValueOrMissing(data.totalUsers) },
    { key: "activeUsers", label: dict.dashboard.activeUsers, icon: "users", value: metricValueOrMissing(data.activeUsers) },
    { key: "disabledUsers", label: dict.dashboard.disabledUsers, icon: "lock", value: metricValueOrMissing(data.disabledUsers) },
    { key: "activeOrders", label: dict.dashboard.activeOrders, icon: "orders", value: metricValueOrMissing(data.activeOrders) },
    { key: "paymentPendingOrders", label: dict.dashboard.pendingPayments, icon: "mail", value: metricValueOrMissing(data.paymentPendingOrders) },
    { key: "updatedAt", label: dict.dashboard.lastUpdated, icon: "clock", value: updatedAtDisplay, trailingIcon: "refresh" },
  ];

  const tableRows = [
    { label: dict.dashboard.totalUsers, value: String(metrics[0].value) },
    { label: dict.dashboard.activeUsers, value: String(metrics[1].value) },
    { label: dict.dashboard.disabledUsers, value: String(metrics[2].value) },
    { label: dict.dashboard.activeOrders, value: String(metrics[3].value) },
    { label: dict.dashboard.pendingPaymentOrders, value: String(metrics[4].value) },
    { label: dict.dashboard.pendingCompliance, value: String(metricValueOrMissing(data.complianceQueueCount)) },
    { label: dict.dashboard.paymentDisputes, value: String(metricValueOrMissing(data.openDisputeCount)) },
  ];

  return (
    <div className="app dashboard-view">
      <header className="topbar">
        <div>
          <h1>{dict.dashboard.title}</h1>
          <p className="subtext">{dict.dashboard.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => window.location.reload()}>{dict.actions.refresh}</button>
          <button className="primary" type="button" onClick={() => navigate("/app/review-queue")}>{dict.actions.reviewQueue}</button>
        </div>
      </header>
      <div className="kpi-grid">
        {metrics.map((item) => (
          <StatCard key={item.key} label={item.label} value={item.value} icon={item.icon} trailingIcon={item.trailingIcon} />
        ))}
      </div>
      <section className="content-grid">
        <DataTableCard
          title={dict.dashboard.kpiSnapshot}
          metricLabel={dict.dashboard.metric}
          valueLabel={dict.dashboard.value}
          rows={tableRows}
          updatedAt={updatedAtDisplay}
          dict={dict}
        />
        <ActionCard
          title={dict.dashboard.quickActions}
          dict={dict}
          updatedAt={updatedAtDisplay}
          queueSummary={{ waiting: 24, processing: 7, failed: 3 }}
          onOpenCompliance={() => navigate("/app/compliance-documents")}
          onViewDisputes={() => navigate("/app/investigation")}
          onInspectAppUsers={() => navigate("/app/users")}
          onInspectAdminUsers={() => navigate("/app/admins")}
        />
      </section>
    </div>
  );
}
