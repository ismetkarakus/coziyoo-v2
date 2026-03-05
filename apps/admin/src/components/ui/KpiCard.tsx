import type { ReactNode } from "react";

/**
 * KpiCard — 4-area layout:
 *
 *   ┌──────────┬──────────────────┐
 *   │ topLeft  │ topRight         │
 *   │ (icon)   │ (label)          │
 *   ├──────────┼──────────────────┤
 *   │ bottomLeft│ bottomRight      │
 *   │ (empty)  │ (value + extra)  │
 *   └──────────┴──────────────────┘
 *
 * Default slot mapping from convenience props:
 *   icon          → topLeft
 *   label         → topRight
 *   value         → bottomRight (top of bottom-right area)
 *   children      → bottomRight (below value)
 *
 * Override any slot directly with topLeft/topRight/bottomLeft/bottomRight props.
 */
type KpiCardProps = {
  // Convenience props — fill standard slots
  icon?: string;
  iconVariant?: "good" | "warn" | "danger";
  label?: string;
  value?: string | number;
  // Named slot overrides (take priority over convenience props)
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
  bottomRight?: ReactNode;
  // Card-level props
  colorVariant?: "green" | "orange";
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  /** Fills bottomRight below value */
  children?: ReactNode;
};

export function KpiCard({
  icon,
  iconVariant,
  label,
  value,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  colorVariant,
  selected,
  onClick,
  className,
  children,
}: KpiCardProps) {
  const colorClass = colorVariant === "green" ? "is-green" : colorVariant === "orange" ? "is-orange" : "";
  const classes = [
    "buyer-v2-kpi",
    "kpi-card-grid",
    colorClass,
    onClick ? "is-clickable" : "",
    selected ? "is-selected" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const iconClass = ["buyer-v2-kpi-icon", iconVariant ? `is-${iconVariant}` : ""].filter(Boolean).join(" ");

  const tlContent = topLeft ?? (icon ? <div className={iconClass}>{icon}</div> : null);
  const trContent = topRight ?? (label ? <p>{label}</p> : null);
  const blContent = bottomLeft ?? null;
  const brContent =
    bottomRight ??
    (value !== undefined || children ? (
      <>
        {value !== undefined && <strong>{value}</strong>}
        {children}
      </>
    ) : null);

  const content = (
    <>
      <div className="kpi-card-tl">{tlContent}</div>
      <div className="kpi-card-tr">{trContent}</div>
      <div className="kpi-card-bl">{blContent}</div>
      <div className="kpi-card-br">{brContent}</div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <article className={classes}>{content}</article>;
}
