import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  stat,
  mkdir,
  writeFile,
  readdir,
} from "node:fs/promises";
import { resolve } from "node:path";
await mkdir(".artifacts", { recursive: true });
const run = (args = [], input = "", env = {}) =>
  spawnSync(process.execPath, ["cli/scrub.js", ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
test("stdin/stdout, counts-only report and fail-on-detect", () => {
  const r = run(["--report", "--fail-on-detect"], "Contact jane@example.com");
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "Contact [EMAIL_1]");
  assert.deepEqual(JSON.parse(r.stderr), { EMAIL: 1 });
  assert.equal(run([], "ordinary clean text").stdout, "ordinary clean text");
});
test("mapping, continuation, reordered/repeated restore and unknown placeholders", async () => {
  const dir = await mkdtemp(".artifacts/cli-"),
    m = dir + "/map.json";
  assert.equal(run(["--mapping", m], "a@example.com").status, 0);
  const next = run(
    ["--continue", m, "--mapping", dir + "/next.json"],
    "b@example.com and a@example.com",
  );
  assert.equal(next.stdout, "[EMAIL_2] and [EMAIL_1]");
  const r = run(
    ["restore", "--mapping", dir + "/next.json"],
    "[EMAIL_2] [EMAIL_1] [EMAIL_2] [PERSON_9]",
  );
  assert.equal(
    r.stdout,
    "b@example.com a@example.com b@example.com [PERSON_9]",
  );
  assert.equal(r.stderr, "1 unknown placeholders remain.\n");
  if (process.platform !== "win32")
    assert.equal((await stat(m)).mode & 0o777, 0o600);
  assert.equal(run(["--continue", m, "--fail-on-detect"], "clean").status, 0);
});
test("private shared store is opt-in and interoperable", async () => {
  const dir = resolve(await mkdtemp(".artifacts/store-")),
    env = { SCRUB_DATA_DIR: dir };
  assert.equal(run([], "jane@example.com", env).status, 0);
  assert.deepEqual(await readdir(dir), []);
  assert.equal(run(["--keep"], "jane@example.com", env).status, 0);
  const s = JSON.parse(await readFile(dir + "/mappings.json", "utf8"));
  assert.equal(s.version, 1);
  assert.equal(
    s.recent[0].mapping.placeholders["[EMAIL_1]"].value,
    "jane@example.com",
  );
  assert.equal(
    run(["restore", "--last"], "Reply [EMAIL_1]", env).stdout,
    "Reply jane@example.com",
  );
  assert.equal(run(["--keep"], "new@example.com", env).stdout, "[EMAIL_2]");
  if (process.platform !== "win32")
    assert.equal((await stat(dir + "/mappings.json")).mode & 0o777, 0o600);
});
test("usage/input errors never echo originals and do not overwrite inputs", async () => {
  const dir = await mkdtemp(".artifacts/errors-"),
    input = dir + "/input.txt";
  await writeFile(input, "private-canary@example.com");
  assert.equal(run([input, "--out", input]).status, 1);
  assert.equal(await readFile(input, "utf8"), "private-canary@example.com");
  assert.equal(run(["restore"]).status, 1);
  assert.equal(run(["missing-file"]).status, 2);
  const r = run(["--policy", input]);
  assert.equal(r.status, 2);
  assert(!r.stderr.includes("private-canary"));
  assert.equal(run(["--unknown"]).status, 1);
});
test("DOCX requires output and round-trips through a named mapping", async () => {
  const dir = await mkdtemp(".artifacts/docx-"),
    out = dir + "/scrubbed.docx",
    map = dir + "/map.json";
  assert.equal(run(["test/fixtures/contract.docx"]).status, 1);
  assert.equal(
    run(["test/fixtures/contract.docx", "--out", out, "--mapping", map, "--save-anyway"]).status,
    0,
  );
  assert.equal(
    run(["restore", out, "--mapping", map, "--out", dir + "/restored.docx"])
      .status,
    0,
  );
  const { unzipSync, strFromU8 } = await import("fflate");
  const original = unzipSync(await readFile("test/fixtures/contract.docx")),
    restored = unzipSync(await readFile(dir + "/restored.docx"));
  const text = (bytes) => strFromU8(bytes).replace(/<[^>]*>/g, "");
  assert.equal(
    text(restored["word/document.xml"]),
    text(original["word/document.xml"]),
  );
  assert(strFromU8(restored["word/document.xml"]).includes("<w:b/><w:i/>"));
});
