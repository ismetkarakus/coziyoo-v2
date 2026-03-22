export type ParsedCurlResult = {
  base_url?: string;
  api_key?: string;
  model?: string;
  endpoint_path?: string;
  custom_headers?: Record<string, string>;
  custom_body_params?: Record<string, string>;
  voice_id?: string;
  text_field_name?: string;
};

export function tokenizeCurl(raw: string): string[] {
  const src = raw.replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    if (src[i] === "\"") {
      i++;
      let token = "";
      while (i < src.length && src[i] !== "\"") {
        if (src[i] === "\\" && i + 1 < src.length) {
          token += src[i + 1];
          i += 2;
        } else {
          token += src[i++];
        }
      }
      i++;
      tokens.push(token);
    } else if (src[i] === "'") {
      i++;
      let token = "";
      while (i < src.length && src[i] !== "'") token += src[i++];
      i++;
      tokens.push(token);
    } else {
      let token = "";
      while (i < src.length && !/\s/.test(src[i])) token += src[i++];
      tokens.push(token);
    }
  }
  return tokens;
}

export function parseCurlCommand(raw: string): ParsedCurlResult {
  const tokens = tokenizeCurl(raw);
  let url = "";
  const headers: Record<string, string> = {};
  const formFields: Array<{ key: string; value: string }> = [];
  let bodyRaw = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token === "curl" ||
      token === "-s" ||
      token === "-i" ||
      token === "-v" ||
      token === "-L" ||
      token === "--silent" ||
      token === "--compressed"
    ) continue;
    if (token === "-X" || token === "--request") {
      i++;
      continue;
    }
    if (
      token === "-o" ||
      token === "--output" ||
      token === "--max-time" ||
      token === "--connect-timeout" ||
      token === "-m"
    ) {
      i++;
      continue;
    }
    if (token === "-H" || token === "--header") {
      const header = tokens[++i] ?? "";
      const colon = header.indexOf(":");
      if (colon > 0) {
        const key = header.slice(0, colon).trim().toLowerCase();
        const value = header.slice(colon + 1).trim();
        headers[key] = value;
      }
    } else if (token === "-F" || token === "--form") {
      const field = tokens[++i] ?? "";
      const eq = field.indexOf("=");
      if (eq > 0) {
        const key = field.slice(0, eq).trim();
        const value = field.slice(eq + 1).trim();
        if (!value.startsWith("@")) formFields.push({ key, value });
      }
    } else if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-urlencode"
    ) {
      bodyRaw = tokens[++i] ?? "";
    } else if (!token.startsWith("-") && (token.startsWith("http://") || token.startsWith("https://"))) {
      url = token;
    }
  }

  if (!url) return {};

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }

  const authHeader = headers.authorization;
  let bodyObj: Record<string, unknown> = {};
  if (bodyRaw) {
    try {
      bodyObj = JSON.parse(bodyRaw) as Record<string, unknown>;
    } catch {
      bodyObj = {};
    }
  }

  const model =
    formFields.find((field) => field.key === "model")?.value ??
    (typeof bodyObj.model === "string" ? bodyObj.model : undefined) ??
    parsed.searchParams.get("model") ??
    undefined;

  const textFieldName =
    typeof bodyObj.input === "string" && typeof bodyObj.text !== "string" ? "input" : undefined;

  const voiceId =
    (typeof bodyObj.voice === "string" ? bodyObj.voice : undefined) ??
    (typeof bodyObj.voice_id === "string" ? bodyObj.voice_id : undefined) ??
    parsed.searchParams.get("voice") ??
    undefined;

  const customHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === "authorization") continue;
    customHeaders[key] = value;
  }

  let apiKey: string | undefined;
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
      apiKey = bearerMatch[1].trim();
    } else {
      customHeaders.Authorization = authHeader;
    }
  }

  const bodyParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(bodyObj)) {
    if (key === "text" || key === "input" || key === "model") continue;
    bodyParams[key] = String(value);
  }
  for (const field of formFields) {
    if (field.key === "file" || field.key === "model") continue;
    if (!(field.key in bodyParams)) bodyParams[field.key] = field.value;
  }

  const result: ParsedCurlResult = {
    base_url: parsed.origin,
    endpoint_path: parsed.pathname,
  };

  if (apiKey) result.api_key = apiKey;
  if (model) result.model = model;
  if (textFieldName) result.text_field_name = textFieldName;
  if (voiceId) result.voice_id = voiceId;
  if (Object.keys(customHeaders).length > 0) result.custom_headers = customHeaders;
  if (Object.keys(bodyParams).length > 0) result.custom_body_params = bodyParams;

  return result;
}
