import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  readdir,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

// POSIX hosts exercise both shells; Windows runs the real PowerShell asset smoke in CI.
if (process.platform !== "win32") {
  for (const shell of ["sh", "bash"])
    test(`installer ${shell}: dry-run, validation, truncation and manifest boundary`, async () => {
      await mkdir(".artifacts", { recursive: true });
      const home = await mkdtemp(resolve(".artifacts/installer-contract-"));
      const file = resolve("packaging/install/install.sh");
      const run = (args, input) =>
        spawnSync(shell, input === undefined ? [file, ...args] : [], {
          input,
          encoding: "utf8",
          env: { ...process.env, HOME: home },
        });
      try {
        const dry = run([
          "--dry-run",
          "--cli-only",
          "--version",
          "1.2.3",
          "--with-claude-code",
        ]);
        assert.equal(dry.status, 0, dry.stderr);
        assert.match(dry.stdout, /v1\.2\.3/);
        assert.match(dry.stdout, /hook install claude-code --user/);
        assert.deepEqual(await readdir(home), []);
        assert.notEqual(run(["--version", "../../oops"]).status, 0);
        assert.notEqual(run(["--unknown"]).status, 0);
        assert.notEqual(run(["--version"]).status, 0);
        const source = await readFile(file, "utf8");
        const truncated = run(
          [],
          source.slice(0, source.lastIndexOf('main "$@"')),
        );
        assert.equal(truncated.status, 0);
        assert.deepEqual(await readdir(home), []);
        const share = join(home, ".local/share/scrub");
        await mkdir(share, { recursive: true });
        const keep = join(home, "keep.txt");
        await writeFile(keep, "must survive");
        await writeFile(join(share, "install-manifest"), keep + "\n");
        assert.notEqual(run(["--uninstall"]).status, 0);
        assert.equal(await readFile(keep, "utf8"), "must survive");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
}
