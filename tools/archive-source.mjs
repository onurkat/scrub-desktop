// Formula metadata pins a reproducible source revision, independently of later metadata commits.
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
const { version, revision, sha256 } = JSON.parse(
  await readFile("packaging/homebrew/source.json", "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(revision))
  throw Error("Invalid source archive metadata");
const out = process.argv[2] || ".artifacts/install-assets";
await mkdir(out, { recursive: true });
const file = join(out, `scrub-desktop-${version}-source.tar.gz`);
execFileSync("git", [
  "archive",
  "--format=tar.gz",
  `--prefix=scrub-desktop-${version}/`,
  "-o",
  file,
  revision,
]);
if (
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex") !== sha256
)
  throw Error("Source archive checksum mismatch");
console.log("Verified source archive", file);
