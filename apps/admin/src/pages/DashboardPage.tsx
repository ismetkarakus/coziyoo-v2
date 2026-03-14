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
  language,
}: {
  title: string;
  metricLabel: string;
  valueLabel: string;
  rows: Array<{ label: string; value: string }>;
  updatedAt: string;
  language: Language;
}) {
  const isTr = language === "tr";
  const axisLabels = ["16:30", "19:30", "22:30", "01:30", "04:30", "07:30", "10:30"];
  const queuePoints = [6, 4.5, 6, 5, 4, 4.1, 6.5];
  const sparkPoints = [6.2, 6.1, 5.8, 6.3, 6.2, 6, 5.9, 5.7];
  const queueRows = [
    { name: isTr ? "Yazdırma" : "Print", count: 14, tone: "dot-blue" },
    { name: isTr ? "İndirme" : "Download", count: 26, tone: "dot-cyan" },
    { name: isTr ? "Mesaj / İş" : "Message / Job", count: 36, tone: "dot-teal" },
    { name: isTr ? "Medya" : "Media", count: 24, tone: "dot-red" },
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
          <p className="kpi-updated">{isTr ? "Son Güncelleme" : "Last Updated"}: {updatedAt}</p>
        </div>
        <div className="kpi-right">
          <h3>{isTr ? "İşlem Yoğunluğu Testi" : "Job Load Test"}</h3>
          <LineChart labels={axisLabels} points={queuePoints} max={10} />
          <div className="chart-legend">
            <span><i className="dot dot-blue" />{isTr ? "Bekliyor" : "Waiting"}</span>
            <span><i className="dot dot-teal" />{isTr ? "İşlemde" : "Processing"}</span>
            <span><i className="dot dot-red" />{isTr ? "Hata Verdi" : "Failed"}</span>
          </div>
          <div className="queue-list">
            {queueRows.map((row) => (
              <div className="queue-row" key={row.name}>
                <span className="queue-name"><i className={`dot ${row.tone}`} />{row.name}</span>
                <span className="queue-status">{row.count} {isTr ? "Dosya" : "Files"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="line-chart-wrap">
        <SparklineChart labels={["16:30", "19:30", "22:30", "01:30", "04:30", "07:30", "10:30", "13:30"]} points={sparkPoints} />
        <div className="chart-legend compact">
          <span><i className="dot dot-blue" />{isTr ? "Bekliyor" : "Waiting"}</span>
          <span><i className="dot dot-cyan" />{isTr ? "İşlemde" : "Processing"}</span>
          <span><i className="dot dot-red" />{isTr ? "Hata Verdi" : "Failed"}</span>
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
  language,
  onOpenCompliance,
  onViewDisputes,
  onInspectAppUsers,
  onInspectAdminUsers,
}: {
  title: string;
  dict: Dictionary;
  updatedAt: string;
  queueSummary: { waiting: number; processing: number; failed: number };
  language: Language;
  onOpenCompliance: () => void;
  onViewDisputes: () => void;
  onInspectAppUsers: () => void;
  onInspectAdminUsers: () => void;
}) {
  const isTr = language === "tr";
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
          <h3>{isTr ? "İşlem Durumu" : "Processing Status"}</h3>
          <span>{updatedAt}</span>
        </div>
        <div className="queue-state-content">
          <div className="queue-state-labels">
            <p>{isTr ? "Yazdırma İşleri" : "Print Jobs"}</p>
            <p>{isTr ? "İndirme İşleri" : "Download Jobs"}</p>
            <p>{isTr ? "Mesaj / Görev İşleri" : "Message / Task Jobs"}</p>
            <p>{isTr ? "Medya İşleri" : "Media Jobs"}</p>
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
          <span><i className="dot dot-blue" />{isTr ? "Bekliyor" : "Waiting"}</span>
          <span><i className="dot dot-cyan" />{isTr ? "İşlemde" : "Processing"}</span>
          <span><i className="dot dot-red" />{isTr ? "Hata Verdi" : "Failed"}</span>
        </div>
        <p className="queue-foot">{isTr ? "Son Güncelleme" : "Last Updated"}: {updatedAt}</p>
      </div>
    </article>
  );
}

export default function DashboardPage({ language }: { language: Language }) {
  const navigate = useNavigate();
  const dict = DICTIONARIES[language];
  const [data, setData] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, []);

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
    { key: "totalUsers", label: language === "tr" ? "Toplam Kullanıcı" : "Total Users", icon: "users", value: metricValueOrMissing(data.totalUsers) },
    { key: "activeUsers", label: language === "tr" ? "Aktif Kullanıcı" : "Active Users", icon: "users", value: metricValueOrMissing(data.activeUsers) },
    { key: "disabledUsers", label: language === "tr" ? "Pasif Kullanıcı" : "Disabled Users", icon: "lock", value: metricValueOrMissing(data.disabledUsers) },
    { key: "activeOrders", label: language === "tr" ? "Aktif Sipariş" : "Active Orders", icon: "orders", value: metricValueOrMissing(data.activeOrders) },
    { key: "paymentPendingOrders", label: language === "tr" ? "Ödeme Bekleyen" : "Pending Payments", icon: "mail", value: metricValueOrMissing(data.paymentPendingOrders) },
    { key: "updatedAt", label: language === "tr" ? "Son Güncelleme" : "Last Updated", icon: "clock", value: updatedAtDisplay, trailingIcon: "refresh" },
  ];

  const tableRows = [
    { label: language === "tr" ? "Toplam Kullanıcı" : "Total Users", value: String(metrics[0].value) },
    { label: language === "tr" ? "Aktif Kullanıcı" : "Active Users", value: String(metrics[1].value) },
    { label: language === "tr" ? "Pasif Kullanıcı" : "Disabled Users", value: String(metrics[2].value) },
    { label: language === "tr" ? "Aktif Sipariş" : "Active Orders", value: String(metrics[3].value) },
    { label: language === "tr" ? "Ödeme Bekleyen Sipariş" : "Pending Payment Orders", value: String(metrics[4].value) },
    { label: language === "tr" ? "Bekleyen Uygunluk" : "Pending Compliance", value: String(metricValueOrMissing(data.complianceQueueCount)) },
    { label: language === "tr" ? "Ödeme İtirazı" : "Payment Disputes", value: String(metricValueOrMissing(data.openDisputeCount)) },
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
          language={language}
        />
        <ActionCard
          title={dict.dashboard.quickActions}
          dict={dict}
          updatedAt={updatedAtDisplay}
          queueSummary={{ waiting: 24, processing: 7, failed: 3 }}
          language={language}
          onOpenCompliance={() => navigate("/app/compliance-documents")}
          onViewDisputes={() => navigate("/app/investigation")}
          onInspectAppUsers={() => navigate("/app/users")}
          onInspectAdminUsers={() => navigate("/app/admins")}
        />
      </section>
    </div>
  );
}
