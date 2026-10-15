#!/usr/bin/env bash
# Lands the refreshed model catalogue on main — through the checks main requires.
#
# ⚠️ The job used to `git push` to main. Since main is protected (three required checks), every
# daily run was refused — "GH006: Protected branch update failed" — and the catalogue stopped
# moving on 2026-10-12. A pull request is not an option either: this repository does not let
# Actions create one, and a PR opened with the job's token would not start CI anyway.
#
# So: the commit goes to a branch of its own, CI and the security baseline are started on it by
# hand (a dispatch is the one event the job's token may cause), and once the required checks have
# passed ON THAT COMMIT main is fast-forwarded to it — which protection accepts, since the checks
# it asks for are there. If main moved meanwhile, the commit is replayed on top and checked again.
#
# Needs: GH_TOKEN (contents: write, actions: write, checks: read), GITHUB_REPOSITORY, a commit on
# HEAD that is the refresh, and a checkout with push credentials.
set -euo pipefail

REQUIRED=("CI complete" "security / Secret scanning (gitleaks)" "security / Workflow audit (actionlint + zizmor)")
PREFIX="bot/models-$(date -u +%Y%m%d)-${GITHUB_RUN_ID:-local}"
ATTEMPTS=3
# CI with the integration suite takes a quarter of an hour; an hour is a stuck run, not a slow one.
WAIT_SECONDS=3600

# The state of one required check on a commit: success, failure, or pending.
state_of() {
  local sha=$1 name=$2
  gh api "repos/${GITHUB_REPOSITORY}/commits/${sha}/check-runs?per_page=100" \
    --jq "[.check_runs[] | select(.name == \"${name}\")] | sort_by(.started_at) | last
          | if . == null then \"pending\"
            elif .status != \"completed\" then \"pending\"
            elif .conclusion == \"success\" then \"success\"
            else \"failure\" end"
}

checks_pass() {
  local sha=$1 waited=0
  while (( waited < WAIT_SECONDS )); do
    local pending=0
    for name in "${REQUIRED[@]}"; do
      case "$(state_of "$sha" "$name")" in
        success) ;;
        failure) echo "::error::required check failed on ${sha}: ${name}"; return 1 ;;
        *) pending=1 ;;
      esac
    done
    (( pending == 0 )) && return 0
    sleep 30
    waited=$(( waited + 30 ))
  done
  echo "::error::required checks still not finished after ${WAIT_SECONDS}s on ${sha}"
  return 1
}

# One branch per attempt, so nothing is ever rewritten; all of them go when the job ends.
PUSHED=()
# shellcheck disable=SC2329 # run by the trap below
cleanup() { for b in "${PUSHED[@]}"; do git push --quiet origin --delete "$b" 2>/dev/null || true; done; }
trap cleanup EXIT

for (( attempt = 1; attempt <= ATTEMPTS; attempt++ )); do
  sha=$(git rev-parse HEAD)
  BRANCH="${PREFIX}-${attempt}"
  git push --quiet origin "HEAD:refs/heads/${BRANCH}"
  PUSHED+=("$BRANCH")
  gh workflow run ci.yml --ref "$BRANCH"
  gh workflow run security.yml --ref "$BRANCH"
  echo "checking ${sha} on ${BRANCH} (attempt ${attempt})"
  checks_pass "$sha"

  # Fast-forward only: never over somebody else's commit.
  if git push --quiet origin "${sha}:refs/heads/main"; then
    echo "main is now ${sha}"
    exit 0
  fi
  echo "main moved while the checks ran: replaying the refresh on top"
  git fetch --quiet origin main
  git rebase --quiet origin/main
done
echo "::error::main kept moving; the refresh is left for tomorrow's run"
exit 1
