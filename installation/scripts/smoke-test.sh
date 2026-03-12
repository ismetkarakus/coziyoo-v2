#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
REQUEST_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-20}"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

fail() {
  printf "ERROR: %s\n" "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi
  node -e 'console.log(require("node:crypto").randomUUID())'
}

json_get() {
  local json="$1"
  local path="$2"
  printf "%s" "${json}" | node -e '
    const fs = require("node:fs");
    const path = process.argv[1].split(".");
    const raw = fs.readFileSync(0, "utf8");
    const data = JSON.parse(raw);
    let cursor = data;
    for (const key of path) {
      if (cursor == null || !(key in cursor)) {
        process.exit(2);
      }
      cursor = cursor[key];
    }
    if (cursor == null) process.exit(2);
    process.stdout.write(String(cursor));
  ' "${path}" || return 1
}

request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local auth_token="${4:-}"
  local actor_role="${5:-}"

  local tmpfile
  tmpfile="$(mktemp)"
  local status

  local curl_args=(
    -sS
    -X "${method}"
    "${url}"
    --connect-timeout "${REQUEST_TIMEOUT_SECONDS}"
    --max-time "${REQUEST_TIMEOUT_SECONDS}"
    -o "${tmpfile}"
    -w "%{http_code}"
    -H "Content-Type: application/json"
  )

  if [[ -n "${auth_token}" ]]; then
    curl_args+=( -H "Authorization: Bearer ${auth_token}" )
  fi

  if [[ -n "${actor_role}" ]]; then
    curl_args+=( -H "x-actor-role: ${actor_role}" )
  fi

  if [[ -n "${body}" ]]; then
    curl_args+=( --data "${body}" )
  fi

  status="$(curl "${curl_args[@]}")"
  local response
  response="$(cat "${tmpfile}")"
  rm -f "${tmpfile}"

  printf "%s\n%s\n" "${status}" "${response}"
}

assert_status() {
  local got="$1"
  local expected_csv="$2"
  local label="$3"

  IFS=',' read -r -a expected <<< "${expected_csv}"
  for code in "${expected[@]}"; do
    if [[ "${got}" == "${code}" ]]; then
      log "PASS: ${label} (HTTP ${got})"
      return
    fi
  done

  fail "${label} expected [${expected_csv}] but got HTTP ${got}"
}

require_cmd curl
require_cmd node

log "Starting API smoke test against ${API_BASE_URL}"

readarray -t health < <(request "GET" "${API_BASE_URL}/v1/health")
assert_status "${health[0]}" "200" "Health check"

email="smoke.$(date +%s).$(uuid | cut -d'-' -f1)@coziyoo.local"
password="Smoke12345!"
display_name="smoke$(date +%s)"

register_payload="$(cat <<JSON
{"email":"${email}","password":"${password}","displayName":"${display_name}","fullName":"Smoke User","userType":"both","countryCode":"TR","language":"tr"}
JSON
)"

readarray -t register < <(request "POST" "${API_BASE_URL}/v1/auth/register" "${register_payload}")
assert_status "${register[0]}" "201" "Auth register"

access_token="$(json_get "${register[1]}" "data.tokens.accessToken")" || fail "Register response missing access token"
user_id="$(json_get "${register[1]}" "data.user.id")" || fail "Register response missing user id"

readarray -t orders < <(request "GET" "${API_BASE_URL}/v1/orders?page=1&pageSize=5" "" "${access_token}" "buyer")
assert_status "${orders[0]}" "200" "Orders list"

random_order_id="$(uuid)"
readarray -t payments < <(request "GET" "${API_BASE_URL}/v1/payments/${random_order_id}/status" "" "${access_token}" "buyer")
assert_status "${payments[0]}" "404" "Payments status lookup"

readarray -t finance < <(request "GET" "${API_BASE_URL}/v1/sellers/${user_id}/finance/summary" "" "${access_token}" "seller")
assert_status "${finance[0]}" "200" "Finance summary"

log "Smoke test completed successfully"
