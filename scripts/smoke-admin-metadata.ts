const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function main() {
  const login = await jsonRequest("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@coziyoo.local", password: "Admin12345!" }),
  });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.body)}`);
  const token = login.body.data.tokens.accessToken as string;

  const entities = await jsonRequest("/v1/admin/metadata/entities", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  if (entities.status !== 200 || entities.body.data.length < 5) {
    throw new Error(`metadata entities failed: ${JSON.stringify(entities.body)}`);
  }

  const fields = await jsonRequest("/v1/admin/metadata/tables/orders/fields", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  if (fields.status !== 200 || fields.body.data.fields.length < 5) {
    throw new Error(`metadata fields failed: ${JSON.stringify(fields.body)}`);
  }

  const setPref = await jsonRequest("/v1/admin/table-preferences/orders", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      visibleColumns: ["id", "status", "total_price", "created_at"],
      columnOrder: ["id", "created_at", "status", "total_price"],
    }),
  });
  if (setPref.status !== 200) throw new Error(`set table preferences failed: ${JSON.stringify(setPref.body)}`);

  const getPref = await jsonRequest("/v1/admin/table-preferences/orders", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  if (getPref.status !== 200 || getPref.body.data.isDefault !== false) {
    throw new Error(`get table preferences failed: ${JSON.stringify(getPref.body)}`);
  }

  console.log("Admin metadata smoke test passed", {
    entities: entities.body.data.length,
    fields: fields.body.data.fields.length,
    tableKey: getPref.body.data.tableKey,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

