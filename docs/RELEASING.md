# Release with Git tags

Pushing a stable `vMAJOR.MINOR.PATCH` tag publishes a GitHub Release with a manually installable Chrome extension ZIP and SHA-256 checksum. Branch pushes run CI without creating releases. No Release Please, release PR, custom token, or Chrome Web Store publishing is used.

## Publish a version

1. Start from a clean, up-to-date `main` checkout.
2. For later versions, run `npm version 0.1.1 --no-git-tag-version` (substitute your version), and set `manifest.json` to the same version. The initial version is `0.1.0`.
3. Verify and commit the changes:

   ```sh
   npm ci
   npm run check
   npm run format:check
   git add package.json package-lock.json manifest.json
   git commit -m "chore: prepare v0.1.1"
   git push origin main
   ```

4. Create and push an annotated tag matching those files:

   ```sh
   git tag -a v0.1.1 -m "Release v0.1.1"
   git push origin v0.1.1
   ```

5. Follow **Actions → Release**. It validates the version and confirms the tagged commit belongs to `main`, runs unit and isolated browser tests, tests the extracted ZIP, and builds the production package.
6. The workflow creates a draft GitHub Release, uploads `pi-x-vX.Y.Z.zip` and `SHA256SUMS.txt`, adds installation instructions, then publishes it. Users download the ZIP from [Releases](https://github.com/sugarforever/pi-x/releases) and follow [INSTALL.md](../INSTALL.md).

Versions must contain three numeric components, each at most 65535, and cannot be `0.0.0`. Prerelease suffixes and mismatches between the tag, package, lockfile, and Chrome manifest are rejected. Tags are immutable once published.

## Retry a failed release

Use **Actions → Release → Run workflow**, select `main`, and enter the existing tag, for example `v0.1.0`. The same tag is verified and rebuilt; uploaded assets are replaced and the draft is published only after success. If the tagged source itself is broken, fix it and release a new version instead of moving the tag.

## Local package verification

```sh
npm run test:browser:release
```

This builds a production ZIP, extracts it into a disposable directory, and tests it using an isolated Chromium profile. It never uses your personal Chrome session. The ZIP has `manifest.json` at its root, includes `INSTALL.md` and `LICENSE`, and excludes source maps and development metadata.

The workflow uses the built-in `GITHUB_TOKEN`, scoped to read access for verification and Contents write access for publishing. Third-party Actions are pinned to commit SHAs. GitHub Actions must be enabled for the repository.
