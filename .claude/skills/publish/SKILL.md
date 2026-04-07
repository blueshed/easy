---
name: publish
description: Type-check, patch version, commit, push, and tag to publish Easy to the Docker registry via GitHub Actions.
user-invocable: true
allowed-tools: Bash, Read
---

# Publish

Publish a new patch release of Easy to `ghcr.io/blueshed/easy`.

## Steps

Run these steps sequentially, stopping on any failure:

1. **Type-check**: Run `bunx tsc --noEmit`. If it fails, show the errors and stop.

2. **Check working tree**: Run `git status --porcelain`. If there are uncommitted changes, show them and ask the user whether to commit them first or abort.

3. **Bump version**: Run `npm version patch --no-git-tag-version` to bump the patch version in package.json. Read the new version from package.json.

4. **Commit**: Stage package.json and create a commit with message `vX.Y.Z` (the new version).

5. **Tag**: Create a git tag `vX.Y.Z`.

6. **Confirm**: Show the user what will be pushed (the commit and tag) and ask for explicit permission before pushing.

7. **Push**: Run `git push && git push --tags`.

8. **Report**: Tell the user the version that was published and that the GitHub Actions workflow will build and push the Docker image.
