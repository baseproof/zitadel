#!/usr/bin/env bash
# FILE PATH:
#     .github/scripts/test_release.sh
#
# DESCRIPTION:
#     release.sh against a fake registry, with no network and no credentials:
#     gcloud (reads) and docker (push, and the manifest copy that writes a
#     tag) are stand-ins on PATH that keep the registry's tags in a file; the
#     copy wraps the image in a new index (another digest) unless told
#     --prefer-index=false, as buildx does. The history is a throwaway repository with its own origin,
#     checked out one commit deep as actions/checkout does (so promote fetches
#     BEFORE itself, as on a runner). Every refusal is checked to have written
#     nothing.
#
#       bash .github/scripts/test_release.sh
set -euo pipefail
RELEASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release.sh"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
export FAKE_REGISTRY="$W/registry" FAKE_LOCAL="$W/local" FAKE_WRITES="$W/writes"
: > "$FAKE_REGISTRY"; : > "$FAKE_LOCAL"; : > "$FAKE_WRITES"
mkdir "$W/bin"
export PATH="$W/bin:$PATH"

# gcloud artifacts docker images describe REPOSITORY:TAG --format=value(image_summary.digest);
# anything else (tags add included) is a call release.sh must not make
cat > "$W/bin/gcloud" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [ -n "${FAKE_DENY:-}" ]; then
  echo "ERROR: (gcloud.artifacts.docker.images.describe) PERMISSION_DENIED: denied" >&2
  exit 1
fi
case "$*" in
  "artifacts docker images describe "*" --format=value(image_summary.digest)")
    d="$(awk -v r="$5" '$1 == r { print $2 }' "$FAKE_REGISTRY")"
    if [ -n "$d" ]; then echo "$d"; exit 0; fi
    printf 'ERROR: (gcloud.artifacts.docker.images.describe) Image not found.\n\nA valid container image can be referenced by tag or digest\n' >&2
    exit 1 ;;
  *) echo "fake gcloud: unexpected: $*" >&2; exit 2 ;;
esac
FAKE

# docker tag SOURCE TARGET; docker push TARGET (a local image's digest is its
# line in $FAKE_LOCAL, the last line wins: a rebuild); docker buildx
# imagetools create [--prefer-index=false] --tag TARGET REPOSITORY@DIGEST.
# FAKE_WRAP makes the copy wrap even with the flag (a buildx that ignores it).
cat > "$W/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
local_digest() { awk -v r="$1" '$1 == r { d = $2 } END { print d }' "$FAKE_LOCAL"; }
if [ "$1 ${2:-} ${3:-}" = "buildx imagetools create" ]; then
  shift 3; prefer=true; dst=""; src=""
  while [ $# -gt 0 ]; do
    case "$1" in --prefer-index=false) prefer=false ;; --tag) dst="$2"; shift ;; *) src="$1" ;; esac
    shift
  done
  [[ "$src" == *@sha256:* && "$dst" == *:* ]] || { echo "fake docker: imagetools create --tag $dst $src" >&2; exit 2; }
  d="${src#*@}"
  if [ "$prefer" = true ] || [ -n "${FAKE_WRAP:-}" ]; then d="sha256:$(printf '%064d' 0 | tr 0 e)"; fi
  echo "tag $dst $d" >> "$FAKE_WRITES"
  { awk -v r="$dst" '$1 != r' "$FAKE_REGISTRY"; echo "$dst $d"; } > "$FAKE_REGISTRY.new"
  mv "$FAKE_REGISTRY.new" "$FAKE_REGISTRY"
  exit 0
fi
case "$1" in
  tag)
    d="$(local_digest "$2")"; [ -n "$d" ] || { echo "fake docker: no local image $2" >&2; exit 1; }
    echo "$3 $d" >> "$FAKE_LOCAL" ;;
  push)
    d="$(local_digest "$2")"; [ -n "$d" ] || { echo "fake docker: no local image $2" >&2; exit 1; }
    echo "push $2 $d" >> "$FAKE_WRITES"
    { awk -v r="$2" '$1 != r' "$FAKE_REGISTRY"; echo "$2 $d"; } > "$FAKE_REGISTRY.new"
    mv "$FAKE_REGISTRY.new" "$FAKE_REGISTRY" ;;
  *) echo "fake docker: unexpected: $*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$W/bin/gcloud" "$W/bin/docker"

export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.com GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.com
git init -q --bare "$W/origin.git"
git -C "$W/origin.git" config uploadpack.allowAnySHA1InWant true
git init -q -b main "$W/src"
git -C "$W/src" remote add origin "file://$W/origin.git"

# commit PATH=CONTENT... → writes the files, commits, pushes main; prints the commit
commit() {
  local kv
  for kv in "$@"; do
    mkdir -p "$(dirname "$W/src/${kv%%=*}")"
    printf '%s\n' "${kv#*=}" > "$W/src/${kv%%=*}"
  done
  git -C "$W/src" add -A
  git -C "$W/src" commit -q -m change
  git -C "$W/src" push -q origin main
  git -C "$W/src" rev-parse HEAD
}

# checkout SHA → a checkout of SHA alone, one commit deep; prints its path
checkout() {
  local dir="$W/checkout-$1"
  if [ ! -d "$dir" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "file://$W/origin.git"
    git -C "$dir" fetch -q --depth=1 origin "$1"
    git -C "$dir" checkout -q FETCH_HEAD
  fi
  echo "$dir"
}

digest() { printf 'sha256:%064d' "$1"; }
built() { echo "$1 $(digest "$2")" >> "$FAKE_LOCAL"; }        # built LOCAL_IMAGE N
seed() { echo "$1 $(digest "$2")" >> "$FAKE_REGISTRY"; }       # seed REPOSITORY:TAG N
tag_of() { awk -v r="$1" '$1 == r { print $2 }' "$FAKE_REGISTRY"; }
writes() { wc -l < "$FAKE_WRITES" | tr -d ' '; }
fail() { echo "FAIL: $*" >&2; exit 1; }
passed=0
pass() { echo "ok - $*"; passed=$((passed + 1)); }

# run SHA ARGS... → release.sh in SHA's checkout; its status in $rc, its output in $W/out
run() {
  local dir sha="$1"; shift
  dir="$(checkout "$sha")"
  rc=0
  (cd "$dir" && GITHUB_SHA="$sha" "$RELEASE" "$@") > "$W/out" 2>&1 || rc=$?
}
succeeded() { [ "$rc" = 0 ] || { cat "$W/out" >&2; fail "$1: exit $rc"; }; pass "$1"; }
said() { grep -q -- "$1" "$W/out" || { cat "$W/out" >&2; fail "no '$1' in the output"; }; }
# refused NAME PATTERN WRITES_BEFORE → the run failed saying PATTERN and wrote nothing
refused() {
  [ "$rc" != 0 ] || { cat "$W/out" >&2; fail "$1: it succeeded"; }
  said "$2"
  [ "$(writes)" = "$3" ] || fail "$1: $(( $(writes) - $3 )) write(s) before the refusal"
  pass "$1"
}
is() { [ "$(tag_of "$1")" = "$2" ] || fail "$1 names '$(tag_of "$1")', expected '$2'"; }

R=us-docker.pkg.dev/p/r
A="$R/alpha" B="$R/beta"
IMAGES=("$A=VERSION" "$B=beta/VERSION")

c0="$(commit VERSION=1.0.0 beta/VERSION=0.1.0 README=one)"
seed "$A:1.0.0" 100; seed "$B:0.1.0" 200                        # what the old flow published
c1="$(commit VERSION=1.1.0)"

# ── push-verified ──────────────────────────────────────────────────────
built alpha:ci 1; built beta:ci 2
run "$c1" push-verified alpha:ci "$A"
succeeded "push-verified pushes the smoked image as :sha-<commit>"
is "$A:sha-$c1" "$(digest 1)"
run "$c1" push-verified beta:ci "$B"; succeeded "push-verified, a second image"

built alpha:ci 9; n="$(writes)"                                  # a re-run rebuilt other bytes
run "$c1" push-verified alpha:ci "$A"
succeeded "a re-run leaves :sha-<commit> on the first verified bytes"
said "already names"; is "$A:sha-$c1" "$(digest 1)"; [ "$(writes)" = "$n" ] || fail "a re-run pushed"

run "$c1" push-verified alpha:ci ""
refused "an unset repository variable is a stop, not a skip" "is not an image repository" "$n"
FAKE_DENY=1 run "$c1" push-verified alpha:ci "$R/gamma"
refused "a registry error is never read as 'absent'" "the registry lookup failed" "$n"

# ── promote ────────────────────────────────────────────────────────────
run "$c1" promote "$c0" "${IMAGES[@]}"
succeeded "a VERSION bump promotes :<version> and :latest"
is "$A:1.1.0" "$(digest 1)"; is "$A:latest" "$(digest 1)"
is "$B:0.1.0" "$(digest 200)"; is "$B:latest" "$(digest 2)"; said "beta/VERSION is still 0.1.0"

n="$(writes)"
run "$c1" promote "$c0" "${IMAGES[@]}"
succeeded "a re-run of the promotion re-points nothing"
said "already names"; is "$A:1.1.0" "$(digest 1)"
[ "$(grep -c ":1.1.0 " "$FAKE_WRITES")" = 1 ] || fail "a re-run wrote :1.1.0 again"

c2="$(commit README=two)"
built alpha:ci 3; built beta:ci 4
run "$c2" push-verified alpha:ci "$A"; run "$c2" push-verified beta:ci "$B"
run "$c2" promote "$c1" "${IMAGES[@]}"
succeeded "a push that leaves VERSION alone leaves :<version> alone (sha- only)"
said "VERSION is still 1.1.0"; is "$A:1.1.0" "$(digest 1)"; is "$A:latest" "$(digest 3)"; is "$B:latest" "$(digest 4)"

run "$c1" promote "$c0" "${IMAGES[@]}"
succeeded "an older run's promotion leaves :latest at main's tip"
said "main moved on to $c2"; is "$A:latest" "$(digest 3)"

n="$(writes)"
FAKE_WRAP=1 run "$c2" promote "$c1" "${IMAGES[@]}"
[ "$rc" != 0 ] || { cat "$W/out" >&2; fail "a tag copied under another digest passed"; }
said "after the copy, not $(digest 3)"
[ "$(writes)" = $((n + 1)) ] || fail "the run went on writing after a copy that changed the digest"
pass "every tag written is read back: a copy under another digest stops the run"

c3="$(commit VERSION=1.0.0 beta/VERSION=0.2.0)"                  # back to a published version
built alpha:ci 5; built beta:ci 6
run "$c3" push-verified alpha:ci "$A"; run "$c3" push-verified beta:ci "$B"
n="$(writes)"                                                    # beta's bump is fine and comes first
run "$c3" promote "$c2" "$B=beta/VERSION" "$A=VERSION"
refused "a version another digest holds fails the run, before any write" "already names $(digest 100)" "$n"
is "$B:latest" "$(digest 4)"; [ -z "$(tag_of "$B:0.2.0")" ] || fail "beta:0.2.0 was written"

c4="$(commit VERSION=1.2.0)"
built alpha:ci 7; built beta:ci 8
run "$c4" push-verified alpha:ci "$A"; run "$c4" push-verified beta:ci "$B"
run "$c4" promote "$c3" "${IMAGES[@]}"
succeeded "a version whose bump never promoted is named, not taken"
said "no :0.2.0 exists"; is "$A:1.2.0" "$(digest 7)"; [ -z "$(tag_of "$B:0.2.0")" ] || fail "beta:0.2.0 was written"

c5="$(commit README=three)"; n="$(writes)"
run "$c5" promote "$c4" "${IMAGES[@]}"
refused "no :sha-<commit> image is a failure, not a skip" "no $A:sha-$c5" "$n"

c6="$(commit VERSION=v1.3.0)"
built alpha:ci 10; built beta:ci 11
run "$c6" push-verified alpha:ci "$A"; run "$c6" push-verified beta:ci "$B"; n="$(writes)"
run "$c6" promote "$c5" "${IMAGES[@]}"
refused "a VERSION that is not MAJOR.MINOR.PATCH" "not MAJOR.MINOR.PATCH" "$n"
run "$c6" promote "$c5" "$A=NO_SUCH_FILE"
refused "a VERSION file that does not exist" "NO_SUCH_FILE does not exist" "$n"
run "$c6" promote 0000000000000000000000000000000000000000 "${IMAGES[@]}"
refused "BEFORE must name a commit" "BEFORE must be" "$n"
FAKE_DENY=1 run "$c6" promote "$c5" "${IMAGES[@]}"
refused "a registry error stops the promotion" "the registry lookup failed" "$n"
run "$c6" promote "$c5" "$A"
refused "an image without its VERSION file" "is not REPOSITORY=VERSION_FILE" "$n"
run "$c6" publish
refused "an unknown command" "usage: release.sh" "$n"
rc=0; (cd "$(checkout "$c6")" && GITHUB_SHA=main "$RELEASE" promote "$c5" "${IMAGES[@]}") > "$W/out" 2>&1 || rc=$?
refused "GITHUB_SHA must be a commit" "not a commit" "$n"

echo "ALL $passed CHECKS PASSED"
