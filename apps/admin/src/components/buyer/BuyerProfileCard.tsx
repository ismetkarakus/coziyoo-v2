import type { BuyerContactInfo, BuyerDetail } from "../../types/buyer";

function makeInitials(detail: BuyerDetail): string {
  const raw = detail.fullName?.trim() || detail.displayName?.trim() || detail.email;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function formatLocale(countryCode: string | null, language: string | null) {
  const country = countryCode === "TR" ? "Türkiye" : countryCode ? countryCode.toUpperCase() : "Türkiye";
  const lang = language?.toLowerCase().startsWith("tr") ? "Türkçe" : language ? language.toUpperCase() : "Türkçe";
  return `${country} / ${lang}`;
}

export function BuyerProfileCard({
  detail,
  contactInfo,
}: {
  detail: BuyerDetail;
  contactInfo: BuyerContactInfo | null;
}) {
  const avatarUrl = detail.profileImageUrl ?? contactInfo?.identity.profileImageUrl ?? null;
  const statusText = detail.status === "active" ? "Aktif" : "Pasif";

  return (
    <aside className="panel buyer-profile-card">
      <div className="buyer-avatar-wrap">
        {avatarUrl ? (
          <img className="buyer-avatar-image" src={avatarUrl} alt={`${detail.displayName} avatar`} />
        ) : (
          <span className="buyer-avatar-fallback">{makeInitials(detail)}</span>
        )}
        <span className="buyer-avatar-indicator" />
      </div>
      <h3>{detail.fullName ?? detail.displayName}</h3>
      <p className="buyer-profile-email">{detail.email}</p>
      <span className={`buyer-status-badge ${detail.status === "active" ? "is-active" : "is-passive"}`}>{statusText}</span>
      <div className="divider" />
      <p className="buyer-profile-line"><strong>Telefon:</strong> {contactInfo?.contact.phone ?? "Yok"}</p>
      <p className="buyer-profile-line">{formatLocale(detail.countryCode, detail.language)}</p>
    </aside>
  );
}
