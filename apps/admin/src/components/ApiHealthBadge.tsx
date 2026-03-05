import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";

export default function ApiHealthBadge() {
  const [status, setStatus] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/health`, {
          method: "GET",
          cache: "no-store",
        });
        if (disposed) return;
        setStatus(response.status === 200 ? "up" : "down");
      } catch {
        if (disposed) return;
        setStatus("down");
      }
    };

    check().catch(() => setStatus("down"));
    const timer = window.setInterval(() => {
      check().catch(() => setStatus("down"));
    }, 20000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const label = status === "up" ? "API up" : status === "down" ? "API down" : "API check";
  return (
    <span className={`health-chip health-chip-icon is-${status}`} title={label} aria-label={label}>
      <svg className="wifi-icon" viewBox="0 0 24 24" role="img" aria-hidden="true">
        <path d="M2.5 9.5A14.8 14.8 0 0 1 12 6c3.7 0 7.3 1.3 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M5.8 12.8A10.2 10.2 0 0 1 12 10.6c2.4 0 4.8.8 6.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M9.1 16.1A5.2 5.2 0 0 1 12 15c1.1 0 2.2.4 2.9 1.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="12" cy="19" r="1.7" fill="currentColor" />
      </svg>
    </span>
  );
}
