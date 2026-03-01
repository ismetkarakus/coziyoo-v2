import type { BuyerContactInfo } from "../../types/buyer";

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
  const other = contactInfo?.addresses.other[0]?.addressLine ?? "Yok";
  const phone = contactInfo?.contact.phone ?? "Yok";
  const id = contactInfo?.identity.id ? `${contactInfo.identity.id.slice(0, 8)}...` : "-";

  return (
    <aside className="panel buyer-contact-card">
      <div className="panel-header">
        <h2>İletişim Bilgisi & Adres</h2>
      </div>
      <AddressSection title="Ev" value={home} accent="HAB" />
      <AddressSection title="Ofis" value={office} />
      <AddressSection title="Diğer" value={other} />
      <div className="divider" />
      <p className="buyer-contact-line"><strong>Telefon:</strong> {phone}</p>
      <p className="buyer-contact-line"><strong>Kimlik:</strong> {id}</p>
    </aside>
  );
}
