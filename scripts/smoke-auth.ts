const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const now = Date.now();
const email = `buyer${now}@coziyoo.test`;
const displayName = `buyer${now}`;

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
  const register = await jsonRequest("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "Buyer12345!",
      displayName,
      userType: "buyer",
      countryCode: "TR",
      language: "tr",
    }),
  });
  if (register.status !== 201) throw new Error(`register failed: ${JSON.stringify(register.body)}`);

  const accessToken = register.body.data.tokens.accessToken as string;
  const refreshToken = register.body.data.tokens.refreshToken as string;

  const me = await jsonRequest("/v1/auth/me", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (me.status !== 200) throw new Error(`auth me failed: ${JSON.stringify(me.body)}`);

  const refresh = await jsonRequest("/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
  if (refresh.status !== 200) throw new Error(`refresh failed: ${JSON.stringify(refresh.body)}`);

  const adminLogin = await jsonRequest("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@coziyoo.local",
      password: "Admin12345!",
    }),
  });
  if (adminLogin.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(adminLogin.body)}`);

  const adminAccessToken = adminLogin.body.data.tokens.accessToken as string;
  const adminMe = await jsonRequest("/v1/admin/auth/me", {
    method: "GET",
    headers: { authorization: `Bearer ${adminAccessToken}` },
  });
  if (adminMe.status !== 200) throw new Error(`admin me failed: ${JSON.stringify(adminMe.body)}`);

  const realmIsolation = await jsonRequest("/v1/admin/auth/me", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (realmIsolation.status !== 401 && realmIsolation.status !== 403) {
    throw new Error(`realm isolation failed: ${JSON.stringify(realmIsolation.body)}`);
  }

  console.log("Auth smoke test passed", {
    registerUserId: register.body.data.user.id,
    adminId: adminLogin.body.data.admin.id,
    realmIsolationStatus: realmIsolation.status,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

