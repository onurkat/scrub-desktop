# Source release preparation

The formulas refer to an unpublished release artifact. Nothing has been uploaded.
The prepared source archive is reproducible with:

```sh
git archive --format=tar.gz --prefix=scrub-desktop-1.0.4/ \
  -o scrub-desktop-1.0.4-source.tar.gz 4eab9ac39842870963d108ddafbdf8e3a63595d0
sha256sum scrub-desktop-1.0.4-source.tar.gz
```

Expected SHA-256: `9be3cbf27b509aa408d5341c84c7b80d455b42b0c02f4cac91feb63c5c4000b5`.
The owner must attach that exact archive to the v1.0.4 release before the public
formulas can install. If application code changes, regenerate the archive and
update both checksums before publishing. Formula metadata may be maintained in
later commits without changing the archived application source.

CI uses `tools/qa/local-tap.mjs` to generate a fresh archive of its checkout and
replace the URL/checksum only in the temporary local tap. This verifies the
actual checkout without depending on an already published release.

`node tools/archive-source.mjs` verifies this pinned archive; the aggregate CI artifact includes it with SHA256SUMS.
