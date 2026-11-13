#!/usr/bin/env bash
# Run only on the disposable Linux CI runner after API integration tests stop.
# Verify the packaged issuer, including routing, before it can be published.
set -euo pipefail

image="${1:?usage: smoke_issuer_image.sh IMAGE}"
revision="${GITHUB_SHA:?GITHUB_SHA is required}"
version="$(tr -d '[:space:]' < apps/api/VERSION)"
origin=http://localhost:18082
container=issuer-image-smoke
compose=(docker compose -p zitadel_issuer_image_smoke -f .devcontainer/docker-compose.yaml)
version_file="$(mktemp)"

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then docker logs "$container" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  rm -f "$version_file"
  exit "$status"
}
trap cleanup EXIT

test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/amd64
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$revision"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image")" = "$version"
test "$(docker run --rm "$image" --version)" = "zitadel version $version"

"${compose[@]}" up -d --wait db-api-integration cache-api-integration
docker run -d --name "$container" --network host \
  --mount "type=bind,source=${PWD}/apps/api/test-integration-api.yaml,target=/app/ci.yaml,readonly" \
  -e ZITADEL_DATABASE_POSTGRES_HOST=127.0.0.1 \
  -e ZITADEL_DATABASE_POSTGRES_PORT=5433 \
  -e ZITADEL_PORT=18082 -e ZITADEL_EXTERNALPORT=18082 \
  -e ZITADEL_FIRSTINSTANCE_PATPATH=/dev/null \
  "$image" start-from-init --config /app/ci.yaml --steps /app/ci.yaml \
  --masterkey MasterkeyNeedsToHave32Characters

curl --fail --silent --show-error --retry 60 --retry-connrefused --retry-delay 2 \
  --max-time 5 "$origin/debug/ready" >/dev/null
docker cp "$container:/app/VERSION" "$version_file"
cmp apps/api/VERSION "$version_file"

for path in /ui/login/ /ui/login/login /ui/login/register /ui/login/password /ui/login/device; do
  for method in GET POST; do
    status="$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' -X "$method" "$origin$path")"
    test "$status" = 404 || { echo "Legacy route $method $path returned $status, expected 404" >&2; exit 1; }
  done
done
target="$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "$origin/device?user_code=ABCD-EFGH")"
test "$target" = "302 $origin/ui/v2/login/device?user_code=ABCD-EFGH"
status="$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' -X POST "$origin/device")"
test "$status" = 405

echo "Packaged issuer version, revision, startup, and V2-only routing verified"
