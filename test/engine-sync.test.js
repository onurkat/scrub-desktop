import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { scrub } from "../engine/scrub.js";
await mkdir(".artifacts", { recursive: true });
const source = resolve(process.env.SCRUB_SOURCE || "../scrub");
const manifest = JSON.parse(await readFile("engine/SOURCE.json", "utf8"));
test("engine modules retain their recorded hashes", async () => {
  for (const [file, hash] of Object.entries(manifest.files))
    assert.equal(
      createHash("sha256")
        .update(await readFile("engine/" + file))
        .digest("hex"),
      hash,
      file,
    );
});
test(
  "engine modules are byte-identical to source when available",
  { skip: !existsSync(source + "/src") },
  async () => {
    for (const file of Object.keys(manifest.files))
      assert.deepEqual(
        await readFile("engine/" + file),
        await readFile(source + "/src/" + file),
        file,
      );
  },
);
test(
  "copied fixtures produce exactly the upstream CLI output",
  { skip: !existsSync(source + "/tools/cli.js") },
  async () => {
    const dir = await mkdtemp(".artifacts/engine-");
    try {
      for (const file of [
        "clean.txt",
        "mixed.txt",
        "csv.csv",
        "contract.docx",
      ]) {
        const bytes = await readFile("test/fixtures/" + file);
        const result = await scrub(
          file.endsWith(".docx")
            ? { kind: "docx", bytes }
            : { kind: "text", text: bytes.toString() },
        );
        const out = resolve(dir, file);
        execFileSync(process.execPath, [
          source + "/tools/cli.js",
          "scrub",
          resolve("test/fixtures", file),
          "--out",
          out,
        ]);
        assert.deepEqual(Buffer.from(result.output), await readFile(out), file);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
