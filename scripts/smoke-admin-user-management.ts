const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const now = Date.now();

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

async function adminLogin(email: string, password: string) {
  const login = await jsonRequest("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200) {
    throw new Error(`admin login failed (${email}): ${JSON.stringify(login.body)}`);
  }

  const tokens = (login.body as any).data.tokens;
  return {
    accessToken: tokens.accessToken as string,
    refreshToken: tokens.refreshToken as string,
  };
}

async function main() {
  const superAdmin = await adminLogin("admin@coziyoo.local", "Admin12345!");

  const overview = await jsonRequest("/v1/admin/dashboard/overview", {
    headers: { authorization: `Bearer ${superAdmin.accessToken}` },
  });
  if (overview.status !== 200) {
    throw new Error(`dashboard overview failed: ${JSON.stringify(overview.body)}`);
  }

  const adminEmail = `readonly-admin-${now}@coziyoo.test`;
  const adminCreate = await jsonRequest("/v1/admin/admin-users", {
    method: "POST",
    headers: { authorization: `Bearer ${superAdmin.accessToken}` },
    body: JSON.stringify({ email: adminEmail, password: "Admin12345!", role: "admin" }),
  });

  if (adminCreate.status !== 201) {
    throw new Error(`admin create failed: ${JSON.stringify(adminCreate.body)}`);
  }

  const readonlyAdmin = await adminLogin(adminEmail, "Admin12345!");

  const forbiddenCreate = await jsonRequest("/v1/admin/users", {
    method: "POST",
    headers: { authorization: `Bearer ${readonlyAdmin.accessToken}` },
    body: JSON.stringify({
      email: `app-user-denied-${now}@coziyoo.test`,
      password: "Buyer12345!",
      displayName: `denied${now}`,
      userType: "buyer",
    }),
  });

  if (forbiddenCreate.status !== 403) {
    throw new Error(`readonly admin mutation should be forbidden: ${JSON.stringify(forbiddenCreate.body)}`);
  }

  const appCreate = await jsonRequest("/v1/admin/users", {
    method: "POST",
    headers: { authorization: `Bearer ${superAdmin.accessToken}` },
    body: JSON.stringify({
      email: `app-user-${now}@coziyoo.test`,
      password: "Buyer12345!",
      displayName: `appuser${now}`,
      userType: "buyer",
      language: "en",
      countryCode: "TR",
    }),
  });

  if (appCreate.status !== 201) {
    throw new Error(`super admin user create failed: ${JSON.stringify(appCreate.body)}`);
  }

  const appUserId = (appCreate.body as any).data.id as string;
  const disable = await jsonRequest(`/v1/admin/users/${appUserId}/status`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${superAdmin.accessToken}` },
    body: JSON.stringify({ status: "disabled" }),
  });

  if (disable.status !== 200) {
    throw new Error(`disable app user failed: ${JSON.stringify(disable.body)}`);
  }

  const roleUpdate = await jsonRequest(`/v1/admin/users/${appUserId}/role`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${superAdmin.accessToken}` },
    body: JSON.stringify({ role: "seller" }),
  });

  if (roleUpdate.status !== 200) {
    throw new Error(`app user role update failed: ${JSON.stringify(roleUpdate.body)}`);
  }

  const list = await jsonRequest("/v1/admin/users?page=1&pageSize=20&sortBy=createdAt&sortDir=desc", {
    headers: { authorization: `Bearer ${superAdmin.accessToken}` },
  });

  if (list.status !== 200) {
    throw new Error(`users list failed: ${JSON.stringify(list.body)}`);
  }

  console.log("Admin user management smoke test passed", {
    appUserId,
    readonlyStatus: forbiddenCreate.status,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
