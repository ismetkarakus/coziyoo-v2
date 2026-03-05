import type { BuyerContactInfo } from "../../types/buyer";

function formatDob(value: string | null | undefined) {
  if (!value) return "Yok";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("tr-TR");
}

function AddressSection({ title, value, accent }: { title: string; value: string; accent?: string }) {
  return (
    <div className="buyer-address-section">
      <div className="buyer-address-head">
        <h4>{title}</h4>
        {accent ? <span className="buyer-address-chip">{accent}</span> : null}
      </div>
      <p>{value}</p>
    </div>
  );
}

export function BuyerContactAddressCard({ contactInfo }: { contactInfo: BuyerContactInfo | null }) {
  const home = contactInfo?.addresses.home?.addressLine ?? "Yok";
  const office = contactInfo?.addresses.office?.addressLine ?? "Yok";
  const otherRow = contactInfo?.addresses.other[0] ?? null;
  const other = otherRow?.addressLine ?? "Yok";
  const homeAccent = contactInfo?.addresses.home?.isDefault ? "Varsayılan" : "HAB";
  const officeAccent = contactInfo?.addresses.office?.isDefault ? "Varsayılan" : undefined;
  const otherAccent = otherRow?.isDefault ? "Varsayılan" : undefined;
  const phone = contactInfo?.contact.phone ?? "Yok";
  const dob = formatDob(contactInfo?.contact.dob);
  const id = contactInfo?.identity.id ? `${contactInfo.identity.id.slice(0, 10)}...` : "-";

  return (
    <aside className="panel buyer-contact-card">
      <div className="panel-header">
        <h2>İletişim Bilgisi & Adres</h2>
      </div>
      <AddressSection title="Ev" value={home} accent={homeAccent} />
      <AddressSection title="Ofis" value={office} accent={officeAccent} />
      <AddressSection title="Diğer" value={other} accent={otherAccent} />
      <div className="divider" />
      <p className="buyer-contact-line"><strong>Telefon:</strong> {phone}</p>
      <p className="buyer-contact-line"><strong>Doğum Tarihi:</strong> {dob}</p>
      <p className="buyer-contact-line"><strong>Kimlik:</strong> {id}</p>
    </aside>
  );
}
