import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { request, parseJson } from "../../lib/api";
import { DICTIONARIES } from "../../lib/i18n";
import type { Language, ApiError, Dictionary } from "../../types/core";
import type { UserKind } from "../../types/users";
import BuyerDetailScreen from "./BuyerDetailScreen";
import SellerDetailScreen from "./SellerDetailScreen";

function DefaultUserDetailScreen({
  kind,
  isSuperAdmin,
  dict,
  id,
}: {
  kind: UserKind;
  isSuperAdmin: boolean;
  dict: Dictionary;
  id: string;
}) {
  const endpoint = kind === "admin" ? `/v1/admin/admin-users/${id}` : `/v1/admin/users/${id}`;
  const [row, setRow] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    request(endpoint)
      .then(async (response) => {
        if (response.status !== 200) {
          setMessage(dict.detail.loadFailed);
          return;
        }
        const body = await parseJson<{ data: any }>(response);
        setRow(body.data);
      })
      .catch(() => setMessage(dict.detail.requestFailed));
  }, [endpoint, dict.detail.loadFailed, dict.detail.requestFailed]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSuperAdmin) return;
    const formData = new FormData(event.currentTarget);
    const payload: Record<string, string> = { email: String(formData.get("email") ?? "") };
    const password = String(formData.get("password") ?? "").trim();
    if (password) payload.password = password;
    const update = await request(endpoint, { method: "PUT", body: JSON.stringify(payload) });
    if (update.status !== 200) {
      const body = await parseJson<ApiError>(update);
      setMessage(body.error?.message ?? dict.detail.updateFailed);
      return;
    }
    const updated = await parseJson<{ data: any }>(update);
    setRow(updated.data);
    setMessage(dict.common.saved);
  }

  if (!row) return <div className="panel">{dict.common.loading}</div>;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{kind === "admin" ? dict.detail.adminUser : kind === "sellers" ? dict.detail.seller : dict.detail.appUser}</h2>
      </div>
      <pre className="json-box">{JSON.stringify(row, null, 2)}</pre>
      <form className="form-grid" onSubmit={onSave}>
        <label>
          {dict.auth.email}
          <input name="email" defaultValue={row.email} disabled={!isSuperAdmin} />
        </label>
        <label>
          {dict.detail.passwordOptional}
          <input name="password" type="password" disabled={!isSuperAdmin} />
        </label>
        <button className="primary" disabled={!isSuperAdmin} type="submit">{dict.actions.save}</button>
      </form>
      {!isSuperAdmin ? <p className="panel-meta">{dict.detail.readOnly}</p> : null}
      {message ? <div className="panel-note">{message}</div> : null}
    </section>
  );
}

export function UserDetail({ kind, isSuperAdmin, language, id: idProp }: { kind: UserKind; isSuperAdmin: boolean; language: Language; id?: string }) {
  const dict = DICTIONARIES[language];
  const location = useLocation();
  const id = idProp ?? location.pathname.split("/").at(-1) ?? "";
  if (kind === "buyers") return <BuyerDetailScreen id={id} dict={dict} language={language} />;
  if (kind === "sellers") return <SellerDetailScreen id={id} isSuperAdmin={isSuperAdmin} dict={dict} language={language} />;
  return <DefaultUserDetailScreen kind={kind} isSuperAdmin={isSuperAdmin} dict={dict} id={id} />;
}

export default DefaultUserDetailScreen;
