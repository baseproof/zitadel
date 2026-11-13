#!/usr/bin/env bash
# Exercise the compiled proxy with runtime configuration, without calling
# Cloudflare or a real issuer. Browser challenge/verification needs acceptance tests.
set -euo pipefail

image="${1:?usage: smoke_login_turnstile.sh IMAGE}"
static_path="${LOGIN_STATIC_SMOKE_PATH:?LOGIN_STATIC_SMOKE_PATH must name a built public asset}"
container=login-turnstile-ci
artifacts="$(mktemp -d)"
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then docker logs "$container" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -r "$artifacts"
  exit "$status"
}
trap cleanup EXIT

docker run -d --name "$container" --network host \
  -e TURNSTILE_ENABLED=true \
  -e TURNSTILE_SITE_KEY=ci-runtime-public-site-key \
  -e TURNSTILE_SECRET_KEY=ci-runtime-turnstile-private-sentinel \
  -e TURNSTILE_APPEARANCE=interaction-only \
  -e TURNSTILE_ALLOWED_HOSTNAMES=id.example.com \
  -e CSP_FETCH_ENABLED=false \
  -e ZITADEL_API_URL=http://127.0.0.1:18080 \
  -e ZITADEL_SERVICE_USER_TOKEN=ci-runtime-service-pat-private-sentinel \
  -e ZITADEL_SESSION_COOKIE_SECRET=ci-runtime-session-cookie-private-sentinel \
  "$image"
curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 1 \
  --max-time 5 http://127.0.0.1:3000/ui/v2/login/healthy >/dev/null
# A static route still traverses the proxy. Its CSP proves enabled configuration
# was read from the shipped server; no backend settings fetch is needed.
curl --fail --silent --show-error --max-time 10 \
  -D "$artifacts/headers" -o "$artifacts/body" \
  "http://127.0.0.1:3000${static_path}"
grep -i '^content-security-policy:' "$artifacts/headers" | grep -q 'https://challenges.cloudflare.com'
if grep -q 'ci-runtime-.*-private-sentinel' "$artifacts/headers" "$artifacts/body"; then
  echo "Private runtime configuration appeared in an HTTP response" >&2
  exit 1
fi
echo "Packaged Login reads enabled Turnstile runtime configuration"

docker rm -f "$container"
# The same image must reject incomplete runtime configuration on user routes.
# Keep every enabled setting except the secret; health probes remain independent.
docker run -d --name "$container" --network host \
  -e TURNSTILE_ENABLED=true \
  -e TURNSTILE_SITE_KEY=ci-runtime-public-site-key \
  -e TURNSTILE_APPEARANCE=interaction-only \
  -e TURNSTILE_ALLOWED_HOSTNAMES=id.example.com \
  -e CSP_FETCH_ENABLED=false \
  -e ZITADEL_API_URL=http://127.0.0.1:18080 \
  -e ZITADEL_SERVICE_USER_TOKEN=ci-runtime-service-pat-private-sentinel \
  -e ZITADEL_SESSION_COOKIE_SECRET=ci-runtime-session-cookie-private-sentinel \
  "$image"
curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 1 \
  --max-time 5 http://127.0.0.1:3000/ui/v2/login/healthy >/dev/null
status="$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:3000${static_path}")"
test "$status" = 500 || { echo "Missing Turnstile secret returned $status, expected 500" >&2; exit 1; }
echo "Packaged Login rejects incomplete enabled configuration"
