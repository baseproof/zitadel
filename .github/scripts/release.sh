#!/usr/bin/env bash
# FILE PATH:
#     .github/scripts/release.sh
#
# DESCRIPTION:
#     Main's verified images, published once and promoted by digest. The run
#     on a push to main is the one verification: each image job builds,
#     smokes, then pushes the bytes it smoked; the promote job, which runs
#     only when every verification job passed, names them as the release.
#
#       release.sh push-verified LOCAL_IMAGE REPOSITORY
#           An image job, after its last smoke: LOCAL_IMAGE (what the smoke
#           ran) becomes REPOSITORY:sha-$GITHUB_SHA. Write-once: a re-run
#           finds the tag and leaves it, so the first verified bytes stay.
#
#       release.sh promote BEFORE REPOSITORY=VERSION_FILE...
#           The promote job. Each REPOSITORY:sha-$GITHUB_SHA gets
#             :<version>  when this push changed the version VERSION_FILE
#                         names. A version is one image: a version another
#                         digest already holds fails the run (bump the
#                         file), and a push that leaves the file alone
#                         leaves :<version> alone (the build is sha- only);
#             :latest     when this commit is still main's tip, so a slower
#                         run never moves it back.
#           BEFORE is the commit main pointed at before the push
#           (github.event.before). Every check runs before the first write,
#           so a refusal leaves every image as it was.
#
#     The registry is read with gcloud (credentials from
#     google-github-actions/auth) and written through its Docker API with the
#     docker login: docker push, and `docker buildx imagetools create
#     --prefer-index=false`, which copies a digest's manifest under a tag (no
#     pull, the same bytes) and so moves an existing tag with a writer's
#     rights. An answer other than "Image not found." is fatal: nothing is
#     pushed or tagged on a guess, and every tag written is read back.
#     .github/scripts/test_release.sh runs all of it against a fake registry.
set -euo pipefail
shopt -s inherit_errexit

die() { echo "::error::$*" >&2; exit 1; }
note() { echo "::notice::$*"; }

# digest_of REF → the digest REF (REPOSITORY:tag) names, or nothing when the
# registry holds no such image; any other answer is fatal.
digest_of() {
  local out err
  err="$(mktemp)"
  if out="$(gcloud artifacts docker images describe "$1" --format='value(image_summary.digest)' 2>"$err")"; then
    rm -f "$err"
    [[ "$out" =~ ^sha256:[0-9a-f]{64}$ ]] || die "$1: the registry answered '$out', not a digest"
    echo "$out"
  elif grep -q 'Image not found\.' "$err"; then
    rm -f "$err"
  else
    cat "$err" >&2
    rm -f "$err"
    die "$1: the registry lookup failed (above)"
  fi
}

# repository NAME → NAME when it is a registry image name (HOST/PATH, no tag
# or digest); an unset repository variable is a loud stop, not a skip.
repository() {
  [[ "$1" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]] \
    || die "'$1' is not an image repository (HOST/PATH): is its repository variable set?"
  echo "$1"
}

# tag_digest REPOSITORY@DIGEST REPOSITORY:TAG → TAG names DIGEST, read back.
# `gcloud artifacts docker tags add` moves a tag by deleting it first, which
# needs artifactregistry.tags.delete: refused for the publisher (a writer) on
# :latest in the promote job of proxy_validator's main run on c38ef4e,
# 2026-10-29 03:59:41Z. A writer's manifest PUT moves it, as every push of
# :latest did before. Without --prefer-index=false buildx would wrap the
# image in a new index, another digest: the read-back fails on that.
tag_digest() {
  local src="$1" dst="$2" got
  docker buildx imagetools create --prefer-index=false --tag "$dst" "$src"
  got="$(digest_of "$dst")"
  [ "$got" = "${src#*@}" ] || die "$dst names '${got:-nothing}' after the copy, not ${src#*@}"
  note "$dst names ${src#*@} (sha-$GITHUB_SHA)"
}

# version_at COMMIT FILE → FILE's content at COMMIT without whitespace, or
# nothing when FILE does not exist there.
version_at() {
  if git cat-file -e "$1:$2" 2>/dev/null; then
    git show "$1:$2" | tr -d '[:space:]'
  fi
}

push_verified() {
  [ $# -eq 2 ] || die "usage: release.sh push-verified LOCAL_IMAGE REPOSITORY"
  local image="$1" repo ref held pushed
  repo="$(repository "$2")"
  ref="$repo:sha-$GITHUB_SHA"
  held="$(digest_of "$ref")"
  if [ -n "$held" ]; then
    note "$ref already names $held (a re-run): the first verified bytes stay, this run's build is not pushed"
    return
  fi
  docker tag "$image" "$ref"
  docker push "$ref"
  pushed="$(digest_of "$ref")"
  [ -n "$pushed" ] || die "pushed $ref, and the registry does not answer it"
  note "$image (smoked above) is $ref: $pushed"
}

promote() {
  [ $# -ge 2 ] || die "usage: release.sh promote BEFORE REPOSITORY=VERSION_FILE..."
  local before="$1"; shift
  [[ "$before" =~ ^[0-9a-f]{40}$ && "$before" != 0000000000000000000000000000000000000000 ]] \
    || die "BEFORE must be the commit main pointed at before this push, not '$before'"
  git cat-file -e "$before^{commit}" 2>/dev/null || git fetch --quiet --no-tags --depth=1 origin "$before"
  local tip
  tip="$(git ls-remote --exit-code origin refs/heads/main | cut -f1)"
  [[ "$tip" =~ ^[0-9a-f]{40}$ ]] || die "origin answered '$tip' for main's tip"

  local -a writes=()
  local spec repo file d v was held
  for spec in "$@"; do
    [[ "$spec" == ?*=?* ]] || die "'$spec' is not REPOSITORY=VERSION_FILE"
    repo="$(repository "${spec%%=*}")"
    file="${spec#*=}"
    d="$(digest_of "$repo:sha-$GITHUB_SHA")"
    [ -n "$d" ] || die "no $repo:sha-$GITHUB_SHA although every verification job passed: its image job pushes it"
    v="$(version_at "$GITHUB_SHA" "$file")"
    [ -n "$v" ] || die "$file does not exist at $GITHUB_SHA"
    [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "$file holds '$v' at $GITHUB_SHA, not MAJOR.MINOR.PATCH"
    was="$(version_at "$before" "$file")"
    held="$(digest_of "$repo:$v")"
    if [ "$was" = "$v" ]; then
      if [ -n "$held" ]; then
        note "$repo: $file is still $v (:$v names $held); this build is sha-$GITHUB_SHA only"
      else
        note "$repo: $file is still $v and no :$v exists, so the push that set $v promoted nothing (its run failed): re-run that run's failed jobs, or bump $file. This build is sha-$GITHUB_SHA only"
      fi
    elif [ -z "$held" ]; then
      writes+=("$repo@$d" "$repo:$v")
    elif [ "$held" = "$d" ]; then
      note "$repo:$v already names $d (a re-run)"
    else
      die "$repo:$v already names $held, not this commit's $d: a version is one image and is never re-pointed. Bump $file"
    fi
    [ "$tip" != "$GITHUB_SHA" ] || writes+=("$repo@$d" "$repo:latest")
  done
  [ "$tip" = "$GITHUB_SHA" ] || note "main moved on to $tip: that push's run moves :latest"

  local i
  for ((i = 0; i < ${#writes[@]}; i += 2)); do
    tag_digest "${writes[i]}" "${writes[i + 1]}"
  done
}

[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die "GITHUB_SHA is '${GITHUB_SHA:-}', not a commit"
case "${1:-}" in
  push-verified) shift; push_verified "$@" ;;
  promote) shift; promote "$@" ;;
  *) die "usage: release.sh push-verified LOCAL_IMAGE REPOSITORY | promote BEFORE REPOSITORY=VERSION_FILE..." ;;
esac
