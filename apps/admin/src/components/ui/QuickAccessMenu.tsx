import { forwardRef } from "react";
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
  const contactEmail = String(email ?? "").trim();
  const safePhoneHref = String(phoneHrefValue ?? "").trim();
  const hasEmail = contactEmail.includes("@");
  const hasPhone = safePhoneHref.length > 0;
  const summaryLabel = language === "tr" ? "Hızlı Erişim" : "Quick Access";

  const detailsClassName = ["seller-quick-access", className].filter(Boolean).join(" ");

  return (
    <details className={detailsClassName} ref={ref}>
      <summary>{summaryLabel}</summary>
      <div className="seller-quick-access-menu">
        {hasEmail ? (
          <a href={`mailto:${contactEmail}`}>{language === "tr" ? "E-mail" : "E-mail"}</a>
        ) : (
          <span className="is-disabled">{language === "tr" ? "E-mail yok" : "No e-mail"}</span>
        )}
        {hasPhone ? (
          <a href={`sms:${safePhoneHref}?body=${smsBody}`}>SMS</a>
        ) : (
          <span className="is-disabled">{language === "tr" ? "SMS yok" : "No SMS"}</span>
        )}
        {hasPhone ? (
          <a href={`tel:${safePhoneHref}`}>{language === "tr" ? "Telefon" : "Phone"}</a>
        ) : (
          <span className="is-disabled">{language === "tr" ? "Telefon yok" : "No phone"}</span>
        )}
      </div>
    </details>
  );
});
