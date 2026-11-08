# Source release preparation

The formulas refer to an unpublished release artifact. Nothing has been uploaded.
The prepared source archive is reproducible with:

```sh
git archive --format=tar.gz --prefix=scrub-desktop-1.0.3/ \
  -o scrub-desktop-1.0.3-source.tar.gz 86788ed
sha256sum scrub-desktop-1.0.3-source.tar.gz
```

Expected SHA-256: `7b0fba82a255682f554e477f7bb7d93333849e1e8cf614d16fd2665f432fd4f6`.
The owner must attach that exact archive to the v1.0.3 release before the public
formulas can install. If application code changes, regenerate the archive and
update both checksums before publishing. Formula metadata may be maintained in
later commits without changing the archived application source.

CI uses `tools/qa/local-tap.mjs` to generate a fresh archive of its checkout and
replace the URL/checksum only in the temporary local tap. This verifies the
actual checkout without depending on an already published release.
