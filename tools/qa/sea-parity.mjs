import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
await mkdir(".artifacts/sea-parity", { recursive: true });
const binary = resolve(
  `.artifacts/cli/scrub${process.platform === "win32" ? ".exe" : ""}`,
);
function check(args, input = "") {
  const options = { input, encoding: "utf8" };
  const source = spawnSync(
    process.execPath,
    ["cli/scrub.js", ...args],
    options,
  );
  const native = spawnSync(binary, args, options);
  assert.equal(native.status, source.status);
  assert.equal(native.stdout, source.stdout);
  assert.equal(native.stderr, source.stderr);
}
check(["--report", "--fail-on-detect"], "Contact jane@example.com");
check(
  ["--mapping", ".artifacts/sea-parity/map.json"],
  "Contact jane@example.com",
);
check(
  ["restore", "--mapping", ".artifacts/sea-parity/map.json"],
  "Reply [EMAIL_1]",
);
for (const file of await readdir("locales")) {
  if (!/^[a-z]{2}(?:_[A-Z]{2})?\.json$/.test(file)) continue;
  check([
    "test/fixtures/contract.docx",
    "--out",
    ".artifacts/sea-parity/out.docx",
    "--language",
    file.slice(0, -5),
  ]);
}
console.log(
  "SEA/source parity: scrub, restore and all 34 localized DOCX warnings",
);
