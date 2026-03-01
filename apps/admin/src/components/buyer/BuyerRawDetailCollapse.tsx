export function BuyerRawDetailCollapse({ raw }: { raw: unknown }) {
  return (
    <details className="buyer-raw-collapse">
      <summary>Ham Alıcı Detayı</summary>
      <pre className="json-box">{JSON.stringify(raw, null, 2)}</pre>
    </details>
  );
}
