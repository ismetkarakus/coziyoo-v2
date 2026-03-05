export default function StatCard({
  label,
  value,
  icon,
  trailingIcon,
}: {
  label: string;
  value: string | number;
  icon?: "users" | "lock" | "orders" | "mail" | "clock";
  trailingIcon?: "refresh";
}) {
  return (
    <article className={`card ${/updated|güncelleme/i.test(label) ? "card-updated" : ""}`}>
      <div className="card-head">
        <p className="card-label">
          <i className={`metric-icon metric-icon-${icon ?? "users"}`} />
          {label}
        </p>
        {trailingIcon ? <i className={`metric-icon metric-icon-${trailingIcon} metric-icon-trailing`} /> : null}
      </div>
      <p className={`card-value ${/updated|date|time|güncelleme/i.test(label) ? "card-value-long" : ""}`}>{String(value)}</p>
    </article>
  );
}
