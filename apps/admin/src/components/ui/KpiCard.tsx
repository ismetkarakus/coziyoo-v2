import type { ReactNode } from "react";

type KpiCardProps = {
  icon: string;
  iconVariant?: "good" | "warn" | "danger";
  colorVariant?: "green" | "orange";
  label: string;
  value: string | number;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
};

export function KpiCard({
  icon,
  iconVariant,
  colorVariant,
  label,
  value,
  selected,
  onClick,
  className,
  children,
}: KpiCardProps) {
  const colorClass = colorVariant === "green" ? "is-green" : colorVariant === "orange" ? "is-orange" : "";
  const selectedClass = selected ? "is-selected" : "";
  const clickableClass = onClick ? "is-clickable" : "";
  const classes = ["buyer-v2-kpi", colorClass, clickableClass, selectedClass, className ?? ""]
    .filter(Boolean)
    .join(" ");

  const iconClass = ["buyer-v2-kpi-icon", iconVariant ? `is-${iconVariant}` : ""].filter(Boolean).join(" ");

  const content = (
    <>
      <div className={iconClass}>{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {children}
      </div>
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
