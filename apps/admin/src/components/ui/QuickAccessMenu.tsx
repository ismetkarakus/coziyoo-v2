import { forwardRef, useEffect, useRef } from "react";
import type { Language } from "../../types/core";

type QuickAccessMenuProps = {
  language: Language;
  email?: string | null;
  phoneHrefValue?: string | null;
  smsBody?: string;
  className?: string;
};

export const QuickAccessMenu = forwardRef<HTMLDetailsElement, QuickAccessMenuProps>(function QuickAccessMenu(
  { language, email, phoneHrefValue, smsBody = "", className },
  ref
) {
  const localRef = useRef<HTMLDetailsElement | null>(null);
  const contactEmail = String(email ?? "").trim();
  const safePhoneHref = String(phoneHrefValue ?? "").trim();
  const hasEmail = contactEmail.includes("@");
  const hasPhone = safePhoneHref.length > 0;
  const summaryLabel = language === "tr" ? "Hızlı Erişim" : "Quick Access";

  const detailsClassName = ["seller-quick-access", className].filter(Boolean).join(" ");

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const root = localRef.current;
      if (!root?.open) return;
      if (root.contains(event.target as Node)) return;
      root.open = false;
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const assignRef = (node: HTMLDetailsElement | null) => {
    localRef.current = node;
    if (!ref) return;
    if (typeof ref === "function") {
      ref(node);
      return;
    }
    ref.current = node;
  };

  return (
    <details className={detailsClassName} ref={assignRef}>
      <summary aria-label={summaryLabel}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6.6 3.8h3.1l1.3 4.2-1.9 1.9a14.2 14.2 0 0 0 5 5l1.9-1.9 4.2 1.3v3.1a1.8 1.8 0 0 1-1.8 1.8A15.6 15.6 0 0 1 4.8 5.6 1.8 1.8 0 0 1 6.6 3.8Z" />
        </svg>
      </summary>
      <div className="seller-quick-access-menu">
        {hasEmail ? (
          <button type="button" onClick={() => { window.location.href = `mailto:${contactEmail}`; }}>{language === "tr" ? "E-mail" : "E-mail"}</button>
        ) : (
          <span className="is-disabled">{language === "tr" ? "E-mail yok" : "No e-mail"}</span>
        )}
        {hasPhone ? (
          <button type="button" onClick={() => { window.location.href = `sms:${safePhoneHref}?body=${smsBody}`; }}>SMS</button>
        ) : (
          <span className="is-disabled">{language === "tr" ? "SMS yok" : "No SMS"}</span>
        )}
        {hasPhone ? (
          <button type="button" onClick={() => { window.location.href = `tel:${safePhoneHref}`; }}>{language === "tr" ? "Telefon" : "Phone"}</button>
        ) : (
          <span className="is-disabled">{language === "tr" ? "Telefon yok" : "No phone"}</span>
        )}
      </div>
    </details>
  );
});
