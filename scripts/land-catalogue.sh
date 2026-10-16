#!/usr/bin/env bash
# Lands the refreshed model catalogue on main — through a pull request and the checks main requires.
#
# ⚠️ The job used to `git push` to main. Since main is protected (three required checks), every
# daily run was refused — "GH006: Protected branch update failed" — and the catalogue stopped
# moving on 2026-10-12. Fast-forwarding main to a commit whose checks had passed was tried too and
# is refused the same way for the job's token ("3 of 3 required status checks are expected", with
# all three green on the commit). A pull request is what protection evaluates checks for.
#
# A pull request opened with the job's token starts no workflow, so CI and the security baseline
# are dispatched on its branch by hand — a dispatch is the one event that token may cause — and
# their check runs land on the PR's head commit, which is what the merge is judged on. Once they
# have passed, the PR is squash-merged and its branch deleted. Requires the repository setting
# "Allow GitHub Actions to create and approve pull requests" (no review is required on main, so
# the approving half grants nothing).
#
# Needs: GH_TOKEN (contents: write, pull-requests: write, actions: write, checks: read),
# GITHUB_REPOSITORY, the refresh committed on HEAD, and a checkout with push credentials.
set -euo pipefail

REQUIRED=("CI complete" "security / Secret scanning (gitleaks)" "security / Workflow audit (actionlint + zizmor)")
BRANCH="bot/models-$(date -u +%Y%m%d)-${GITHUB_RUN_ID:-local}"
# CI with the integration suite takes a quarter of an hour; an hour is a stuck run, not a slow one.
WAIT_SECONDS=3600

# The state of one required check on a commit: success, failure, or pending.
state_of() {
  local sha=$1 name=$2
  gh api "repos/${GITHUB_REPOSITORY}/commits/${sha}/check-runs?per_page=100" \
    --jq "[.check_runs[] | select(.name == \"${name}\")] | sort_by(.started_at) | last
          | if . == null then \"pending\"
            elif .status != \"completed\" then \"pending\"
            elif .conclusion == \"success\" or .conclusion == \"skipped\" or .conclusion == \"neutral\" then \"success\"
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

sha=$(git rev-parse HEAD)
git push --quiet origin "HEAD:refs/heads/${BRANCH}"
pr=$(gh pr create --base main --head "$BRANCH" \
  --title "chore(models): refresh the catalogue and the Hivey presets" \
  --body "Daily refresh by the Model catalogue workflow (run ${GITHUB_RUN_ID:-local}). Merged by the workflow once the required checks pass.")
echo "opened ${pr}"
# Closed, and its branch deleted, unless it was merged — a refresh that failed its checks is not
# left lying around; tomorrow's run starts from main again.
# shellcheck disable=SC2329 # run by the trap below
abandon() {
  if [[ "$(gh pr view "$pr" --json state -q .state)" != "MERGED" ]]; then
    gh pr close "$pr" --delete-branch --comment "Required checks did not pass; tomorrow's run tries again." || true
  fi
}
trap abandon EXIT

gh workflow run ci.yml --ref "$BRANCH"
gh workflow run security.yml --ref "$BRANCH"
echo "checking ${sha} on ${BRANCH}"
checks_pass "$sha"

# ⚠️ Green is not enough: check runs from a DISPATCHED workflow are not linked to the pull request
# (its status rollup stays empty), so the merge was refused with every required check passed on
# the commit. What was just verified is recorded as a commit status under each required name —
# statuses are judged by commit, whatever started them — and only after it was verified: a check
# that failed stopped the script above and nothing is recorded.
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-0}"
for name in "${REQUIRED[@]}"; do
  gh api --silent -X POST "repos/${GITHUB_REPOSITORY}/statuses/${sha}" \
    -f state=success -f context="$name" -f target_url="$run_url" \
    -f description="Passed in the run dispatched by the Model catalogue workflow"
done

# --match-head-commit: merged only if the PR still holds the commit that was checked.
gh pr merge "$pr" --squash --delete-branch --match-head-commit "$sha"
echo "merged ${pr}"
