# Releasing

Releases use annotated (ideally GPG-signed) git tags following semver:

- `vX.Y.Z` — immutable per-release tag (e.g. `v1.0.12`), never moved once pushed.
- `v1` — floating major tag that always points at the latest `v1.Y.Z` release.
  Consumers pin to it (`uses: ForAllSecure/mcode-action@v1`), so moving it
  after each release lets them pick up updates automatically.

> `v1-dev` is a stale, unrelated legacy tag — ignore it during releases.

## Steps

1. Merge a PR bumping `version` in `package.json` to the new release version.
2. On the merge commit, tag and push the release:
   ```bash
   git tag -a v1.0.12 -m "Release v1.0.12" -s
   git push origin v1.0.12
   ```
3. Move the floating major tag to the same commit and force-push:
   ```bash
   git tag -fa v1 -m "Update v1 tag to v1.0.12" -s
   git push origin v1 --force
   ```
4. Verify `git rev-list -n 1 v1` matches `git rev-list -n 1 v1.0.12`.
5. Optionally publish a GitHub Release for the new tag.
