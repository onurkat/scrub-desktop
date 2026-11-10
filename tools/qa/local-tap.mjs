import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const archive = resolve(".artifacts/source.tar.gz");
execFileSync("git", [
  "archive",
  "--format=tar.gz",
  "--prefix=scrub-desktop-1.0.4/",
  "-o",
  archive,
  "HEAD",
]);
const sha = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
execFileSync("brew", ["tap-new", "--no-git", "scrub/local"]);
const tap = execFileSync("brew", ["--repository", "scrub/local"], {
  encoding: "utf8",
}).trim();
await mkdir(tap + "/Formula", { recursive: true });
for (const name of ["scrub", "scrub-desktop"]) {
  const source = await readFile(`packaging/homebrew/${name}.rb`, "utf8");
  await writeFile(
    `${tap}/Formula/${name}.rb`,
    source
      .replace(/^  (sha256|version) .+\n/gm, "")
      .replace(
        /  url .+/,
        `  url "file://${archive}"\n  version "1.0.4"\n  sha256 "${sha}"`,
      ),
  );
}
