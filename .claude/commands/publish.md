---
description: Type-check, bump version, commit, tag, and push to publish Easy via GitHub Actions
argument-hint: patch | minor | major
allowed-tools: Bash, Read
---

Publish a new release of Easy to `ghcr.io/blueshed/easy`. The GitHub Actions workflow in `.github/workflows/publish.yml` builds and pushes the Docker image on `v*` tags.

Bump type from the invocation: `$ARGUMENTS` (default to `patch` if empty).

Run these steps sequentially, stopping on any failure:

1. **Type-check** — `bunx tsc --noEmit`. If it fails, show errors and stop.

2. **Check working tree** — `git status --porcelain`. If there are uncommitted changes, show them and ask whether to commit them first or abort. Do not auto-stage.

3. **Verify in browser** — the dev server is already running on `:8080`. `curl -sf http://localhost:8080 > /dev/null` to confirm. Remind the user that tags ship to real users via the registry — ask for explicit confirmation that the change has been tested in a browser before continuing.

4. **Bump version** — `npm version $ARGUMENTS --no-git-tag-version` (falling back to `patch` when no argument). Read the new version from `package.json`.

5. **Commit** — stage only `package.json` (and `bun.lock` if changed by the bump) and create a commit with message `vX.Y.Z`.

6. **Tag** — `git tag vX.Y.Z`.

7. **Confirm push** — show the commit and tag, then **ask for explicit permission** before pushing. A previous "yes" to push does NOT authorise this one.

8. **Push** — on approval, `git push && git push --tags`.

9. **Report** — state the published version and note that the GitHub Actions workflow will build and push `0.X.Y`, `0.X`, and `latest` tags to `ghcr.io/blueshed/easy`.

## Hard rules

- Never push without step 7 approval, even if a previous publish in this session was approved.
- Never `--amend` a published tag or force-push.
- If the type-check or the browser check fails, stop — do not attempt to "fix forward" as part of publish.
