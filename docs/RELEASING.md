# Versioning and releases

pi-x uses **Semantic Versioning**, **Conventional Commits**, and **Release Please**. Releases are GitHub Releases containing a production extension ZIP and SHA-256 checksum. No npm or Chrome Web Store publishing is configured.

## One-time GitHub setup

1. Push the project and workflow files to `main` on `sugarforever/pi-x`.
2. In **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. Organization policy may need to allow this setting. The workflows explicitly scope their token permissions.
3. Optionally add a repository secret named `RELEASE_PLEASE_TOKEN` using a GitHub App installation token or fine-grained PAT with repository Contents, Pull requests, and Issues read/write access. This lets the release bot's PRs trigger CI automatically. Without it, the built-in `GITHUB_TOKEN` works for creating release PRs and releases, but GitHub suppresses workflows triggered by the bot's own PR/tag events. Run **CI → Run workflow** on the release PR branch before merging if you use required checks. The release workflow independently runs CI on `main` before publishing either way.
4. If you use branch protection, require the **verify** job from **CI**, review PRs, and prefer squash merging with Conventional Commit PR titles. Do not require deployment or publishing credentials for contributors.

Workflow files do not run until they are committed and pushed. There are no custom release credentials required for the default configuration. Release automation needs a releasable commit (`feat`, `fix`, or a breaking change); a history containing only `chore` commits may not produce a release PR.

## Normal release flow

1. Use Conventional Commit messages (or squash PR titles):
   - `fix: preserve a typed draft` → patch, e.g. `1.2.3` to `1.2.4`.
   - `feat: add a quote prompt` → minor, e.g. `1.2.3` to `1.3.0`.
   - `feat!: change saved prompt schema` or a `BREAKING CHANGE:` footer → major, e.g. `1.2.3` to `2.0.0`.
   - Documentation and maintenance commits are included with the next releasable change; they do not independently require a new release.
2. On a successful push to `main`, **Release** runs CI and Release Please creates or updates a release PR.
3. Review that PR. It updates `package.json`, `package-lock.json`, `manifest.json`, `.release-please-manifest.json`, and `CHANGELOG.md` together. **Merge the release PR when ready to release.**
4. The next `main` run verifies the project, creates a `vX.Y.Z` tag and a **draft** GitHub Release, checks out the exact tag, rechecks it, and builds its production package.
5. Only after `pi-x-vX.Y.Z.zip` and `SHA256SUMS.txt` upload successfully does the workflow publish the draft. The ZIP has `manifest.json` at its root and includes `INSTALL.md` and `LICENSE`. Development source maps, build metadata, and dotfiles are excluded.
6. Users download from [GitHub Releases](https://github.com/sugarforever/pi-x/releases/latest), extract the ZIP, and follow [INSTALL.md](../INSTALL.md).

The empty initial `.release-please-manifest.json` and explicit `initial-version: 0.1.0` config bootstrap the first release as `0.1.0`. The bootstrap SHA points to the existing license-only commit so the initial implementation is included in the changelog. After the first release, Release Please manages the version metadata automatically. Features always bump minor and breaking changes bump major, including before `1.0.0`; the config explicitly disables Release Please's alternative pre-1.0 bump rules.

Stable releases use only `MAJOR.MINOR.PATCH` numeric versions. Chrome's manifest does not accept SemVer suffixes such as `-beta.1`, so prerelease version mapping is outside this workflow. Every component must be at most 65535 and the version cannot be `0.0.0`. CI rejects version drift and tags that disagree with the package.

## Retry or repair an upload

If verification, packaging, or upload fails after Release Please created a release, it stays a draft. Fix the problem first. From **Actions → Release → Run workflow**, select `main` and enter its existing tag, such as `v0.1.0`, in **tag**. The workflow checks out and verifies that tag, requires an existing GitHub Release, replaces its two assets, and publishes it after successful upload.

A retry rebuilds the existing tagged code. If that code is broken, fix the source and make a new version instead of moving the tag. Keep tags immutable once published. Leaving the manual **tag** input blank reruns the normal release-PR/release discovery flow.

## Local checks and packaging

```sh
npm ci
npm run check
npm run format:check
npx playwright install chromium
npm run test:browser
npm run package:extension
npm run test:browser:release
```

The final command creates `release/pi-x-v0.1.0.zip` and `release/SHA256SUMS.txt` for the current version. To require a particular tag locally, set `RELEASE_TAG=v0.1.0` when running that command. Package files are allowlisted and ZIP timestamps are fixed for repeatable output from identical production assets.

Third-party Actions are pinned to commit SHAs. Dependabot proposes updates for Actions and npm dependencies. The publishing job has only Contents write access; release PR creation additionally needs Pull requests and Issues write access.
