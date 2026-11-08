import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { mergeHooks } from "../cli/hooks.js";
const cli = resolve("cli/scrub.js");
for (const [target, dir, event] of [
  ["claude-code", ".claude", "UserPromptSubmit"],
  ["gemini", ".gemini", "BeforeAgent"],
]) {
  test(`${target}: preserve settings, idempotence and surgical removal`, async () => {
    await mkdir(".artifacts", { recursive: true });
    const root = await mkdtemp(resolve(".artifacts/hook-"));
    try {
      const original = {
        permissions: { allow: ["Read"] },
        hooks: {
          Other: [{ hooks: [{ type: "command", command: "other" }] }],
          [event]: [
            { matcher: "", hooks: [{ type: "command", command: "existing" }] },
          ],
        },
      };
      await mkdir(join(root, dir));
      const file = join(root, dir, "settings.json");
      await writeFile(file, JSON.stringify(original));
      const call = (...args) =>
        spawnSync(process.execPath, [cli, "hook", ...args], {
          cwd: root,
          encoding: "utf8",
        });
      assert.equal(call("install", target).status, 0);
      const first = await readFile(file, "utf8");
      assert.equal(call("install", target, "--project").status, 0);
      assert.equal(await readFile(file, "utf8"), first);
      const installed = JSON.parse(first);
      assert.deepEqual(installed.permissions, original.permissions);
      installed.hooks[event]
        .at(-1)
        .hooks.push({ type: "command", command: "keep-me" });
      await writeFile(file, JSON.stringify(installed));
      assert.equal(call("uninstall", target).status, 0);
      const removed = JSON.parse(await readFile(file, "utf8"));
      assert.deepEqual(removed.hooks[event].at(-1).hooks, [
        { type: "command", command: "keep-me" },
      ]);
      assert.deepEqual(removed.hooks.Other, original.hooks.Other);
      assert.deepEqual(
        mergeHooks(mergeHooks(original, target, true), target, false),
        original,
      );
      await writeFile(file, "{invalid secret-canary");
      const bad = call("install", target);
      assert.equal(bad.status, 2);
      assert.ok(!bad.stderr.includes("secret-canary"));
      assert.equal(await readFile(file, "utf8"), "{invalid secret-canary");
      for (const hooks of [null, [], { [event]: null }, { [event]: [{}] }]) {
        // null event is invalid too; never silently replace settings.
        assert.throws(() => mergeHooks({ hooks }, target, true));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test(`${target}: stdin, dictionary, bypass and private errors`, async () => {
    const root = await mkdtemp(resolve(".artifacts/guard-"));
    const call = (input) =>
      spawnSync(process.execPath, [cli, "hook", "run", target], {
        input,
        encoding: "utf8",
        env: { ...process.env, SCRUB_DATA_DIR: root },
      });
    try {
      const clean = call(
        JSON.stringify({ prompt: "Explain a sorting algorithm." }),
      );
      assert.equal(clean.status, 0);
      assert.equal(clean.stdout + clean.stderr, "");
      for (const prompt of [
        "contact private-canary@example.com",
        "prefix #noscrub private-canary@example.com",
        "#noscrubbed private-canary@example.com",
      ]) {
        const result = call(JSON.stringify({ prompt }));
        assert.equal(result.status, 2);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /EMAIL: 1/);
        assert.ok(!result.stderr.includes("private-canary"));
      }
      for (const prompt of [
        "#noscrub private-canary@example.com",
        "#noscrub\nprivate-canary@example.com",
      ]) {
        const result = call(JSON.stringify({ prompt }));
        assert.equal(result.status, 0);
        assert.equal(result.stdout + result.stderr, "");
      }
      await writeFile(
        join(root, "settings.json"),
        JSON.stringify({
          dictionary: [
            {
              term: "ProjectCanary",
              category: "ORG",
              aliases: ["HiddenAlias"],
            },
          ],
          detectors: { email: false },
        }),
      );
      for (const prompt of [
        "ProjectCanary",
        "HiddenAlias",
        "private-canary@example.com",
      ]) {
        const result = call(JSON.stringify({ prompt }));
        assert.equal(result.status, 2);
        assert.ok(!result.stderr.includes(prompt));
      }
      for (const input of ["private-canary", "{}", '{"prompt":42}']) {
        const result = call(input);
        assert.equal(result.status, 2);
        assert.equal(result.stdout, "");
        assert.ok(!result.stderr.includes("private-canary"));
      }
      await writeFile(join(root, "settings.json"), "{broken-secret");
      assert.equal(call('{"prompt":"ordinary"}').status, 2);
      assert.deepEqual(await readdir(root), ["settings.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("user scope is isolated from project scope and uninstall is idempotent", async () => {
  const root = await mkdtemp(resolve(".artifacts/hook-home-"));
  try {
    const project = join(root, "project");
    await mkdir(project);
    for (const [target, dir] of [
      ["claude-code", ".claude"],
      ["gemini", ".gemini"],
    ]) {
      const call = (...args) =>
        spawnSync(process.execPath, [cli, "hook", ...args], {
          cwd: project,
          encoding: "utf8",
          env: { ...process.env, HOME: root, USERPROFILE: root },
        });
      assert.equal(call("install", target, "--user").status, 0);
      const file = join(root, dir, "settings.json");
      assert.ok(JSON.parse(await readFile(file, "utf8")).hooks);
      assert.deepEqual(await readdir(project), []);
      assert.equal(call("uninstall", target, "--user").status, 0);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
      assert.equal(call("uninstall", target, "--user").status, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
