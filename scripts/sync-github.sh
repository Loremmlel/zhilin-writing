#!/usr/bin/env bash
set -euo pipefail

remote="github"
branch="main"
oauth_client_id="178c6fc778ccc68e1d6a"
oauth_scope="${GITHUB_SYNC_SCOPE:-public_repo}"

die() {
  echo "GitHub sync: $*" >&2
  exit 1
}

json_lines() {
  JSON_INPUT="$1" node -e '
    const data = JSON.parse(process.env.JSON_INPUT);
    for (const key of process.argv.slice(1)) {
      process.stdout.write(String(data[key] ?? "") + "\n");
    }
  ' "${@:2}"
}

command -v curl >/dev/null || die "curl is required."
command -v git >/dev/null || die "git is required."
command -v node >/dev/null || die "node is required."

git rev-parse --show-toplevel >/dev/null 2>&1 || die "run this inside the repository."
[[ "$(git branch --show-current)" == "$branch" ]] || die "switch to $branch first."
[[ -z "$(git status --porcelain)" ]] || die "commit or stash local changes first."

remote_url="$(git remote get-url "$remote" 2>/dev/null)" || die "remote '$remote' is missing."
[[ "$remote_url" == https://github.com/* ]] || die "remote '$remote' must use GitHub HTTPS."

echo "Checking $remote/$branch..."
git fetch --quiet "$remote" "$branch"
local_sha="$(git rev-parse "$branch")"
remote_sha="$(git rev-parse FETCH_HEAD)"

if [[ "$local_sha" == "$remote_sha" ]]; then
  echo "GitHub is already synchronized at $local_sha."
  exit 0
fi

git merge-base --is-ancestor "$remote_sha" "$local_sha" ||
  die "$remote/$branch has diverged; resolve it manually instead of forcing."

device_response="$(
  curl -fsS --connect-timeout 10 --max-time 30 \
    -X POST \
    -H "Accept: application/json" \
    --data "client_id=$oauth_client_id&scope=$oauth_scope" \
    https://github.com/login/device/code
)" || die "could not start GitHub device authorization."

mapfile -t device_fields < <(
  json_lines "$device_response" device_code user_code verification_uri interval expires_in
)
device_code="${device_fields[0]:-}"
user_code="${device_fields[1]:-}"
verification_uri="${device_fields[2]:-}"
interval="${device_fields[3]:-5}"
expires_in="${device_fields[4]:-900}"
[[ -n "$device_code" && -n "$user_code" && -n "$verification_uri" ]] ||
  die "GitHub returned an invalid device authorization response."

echo
echo "Open $verification_uri and enter: $user_code"
echo "Waiting for authorization..."

deadline=$((SECONDS + expires_in))
access_token=""
while ((SECONDS < deadline)); do
  sleep "$interval"
  token_response="$(
    curl -fsS --connect-timeout 10 --max-time 30 \
      -X POST \
      -H "Accept: application/json" \
      --data "client_id=$oauth_client_id&device_code=$device_code&grant_type=urn:ietf:params:oauth:grant-type:device_code" \
      https://github.com/login/oauth/access_token
  )" || die "GitHub authorization check failed."

  mapfile -t token_fields < <(json_lines "$token_response" access_token error error_description)
  access_token="${token_fields[0]:-}"
  oauth_error="${token_fields[1]:-}"
  oauth_error_description="${token_fields[2]:-}"

  [[ -n "$access_token" ]] && break
  case "$oauth_error" in
    authorization_pending) ;;
    slow_down) interval=$((interval + 5)) ;;
    *) die "${oauth_error_description:-device authorization failed.}" ;;
  esac
done

[[ -n "$access_token" ]] || die "device authorization expired."
trap 'access_token=""; unset GITHUB_SYNC_TOKEN' EXIT

credential_helper='!f() { if [ "$1" = get ]; then printf "%s\n" "username=x-access-token" "password=$GITHUB_SYNC_TOKEN"; fi; }; f'
echo "Authorization complete. Pushing $branch..."
GIT_TERMINAL_PROMPT=0 GITHUB_SYNC_TOKEN="$access_token" \
  git -c credential.helper= -c "credential.helper=$credential_helper" \
  push "$remote" "$branch:$branch"

access_token=""
remote_sha="$(git ls-remote --heads "$remote" "$branch" | awk '{print $1}')"
[[ "$remote_sha" == "$local_sha" ]] || die "push finished, but the remote SHA does not match."

echo "GitHub synchronized successfully at $local_sha."
