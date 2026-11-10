// Exercise the real build assets via an explicit loopback server, never fixtures.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".artifacts/install-assets");
const home = resolve(".artifacts/install home");
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
const win = process.platform === "win32";
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(req.url.slice(1));
    if (basename(name) !== name) throw Error();
    res.end(await readFile(join(root, name)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: join(home, "AppData"),
  SCRUB_DATA_DIR: join(home, "data"),
  APPIMAGE_EXTRACT_AND_RUN: "1",
  WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  SCRUB_BASE_URL: `http://127.0.0.1:${server.address().port}`,
};
const binary = win
  ? join(env.LOCALAPPDATA, "ScrubCLI/scrub.exe")
  : join(home, ".local/bin/scrub");
const manifest = win
  ? join(env.LOCALAPPDATA, "ScrubCLI/install-manifest")
  : join(home, ".local/share/scrub/install-manifest");
function run(cmd, args = [], ok = true) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    p.stdout.on("data", (b) => {
      text += b;
      process.stdout.write(b);
    });
    p.stderr.on("data", (b) => process.stderr.write(b));
    p.on("error", reject);
    p.on("close", (code) => {
      try {
        assert.equal(code === 0, ok, `${cmd} exit ${code}`);
        resolve(text.trim());
      } catch (e) {
        reject(e);
      }
    });
  });
}
const cliOnly = !!process.env.SCRUB_SMOKE_CLI_ONLY;
const install = (args = [], ok = true) =>
  win
    ? run(
        "pwsh",
        ["-NoProfile", "-File", "packaging/install/install.ps1", ...args],
        ok,
      )
    : run(
        process.env.INSTALL_SHELL || "sh",
        [
          "packaging/install/install.sh",
          ...(cliOnly ? ["--cli-only"] : []),
          ...args,
        ],
        ok,
      );
const flag = (name) =>
  win
    ? "-" + name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    : "--" + name;
try {
  const sumsPath = join(root, "SHA256SUMS");
  const sums = await readFile(sumsPath, "utf8");
  const broken = sums.replace(
    /^[a-f0-9]{64}(?=\s+scrub-cli-)/gm,
    "0".repeat(64),
  );
  assert.notEqual(broken, sums);
  await writeFile(sumsPath, broken);
  try {
    await install([], false);
    await assert.rejects(access(binary));
  } finally {
    await writeFile(sumsPath, sums);
  }
  await install();
  assert.equal(await run(binary, ["--version"]), "1.0.4");
  if (process.platform === "linux" && !cliOnly)
    await run("sh", [
      "-c",
      "printf previous-clipboard | xclip -selection clipboard >/dev/null 2>&1",
    ]);
  if (process.platform === "darwin" && !cliOnly)
    await run("sh", ["-c", "printf previous-clipboard | pbcopy"]);
  if (!win && !cliOnly)
    await run(join(home, ".local/bin/scrub-desktop"), ["--self-test"]);
  if (process.platform === "linux" && !cliOnly)
    assert.equal(
      await run("xclip", ["-selection", "clipboard", "-o"]),
      "previous-clipboard",
    );
  if (process.platform === "darwin" && !cliOnly)
    assert.equal(await run("pbpaste"), "previous-clipboard");
  await mkdir(env.SCRUB_DATA_DIR, { recursive: true });
  await writeFile(join(env.SCRUB_DATA_DIR, "preserve.txt"), "user mappings");
  await install();
  const entries = (await readFile(manifest, "utf8")).trim().split(/\r?\n/);
  await install([flag("uninstall")]);
  await assert.rejects(access(manifest));
  for (const file of entries) await assert.rejects(access(file));
  assert.equal(
    await readFile(join(env.SCRUB_DATA_DIR, "preserve.txt"), "utf8"),
    "user mappings",
  );
  await install([flag("uninstall")]);
  // The opt-in hook must preserve pre-existing handlers and ownership.
  const settingsFile = join(home, ".claude/settings.json");
  await mkdir(join(home, ".claude"), { recursive: true });
  const original = {
    permissions: { allow: ["Read"] },
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "existing-handler" }] },
      ],
    },
  };
  await writeFile(settingsFile, JSON.stringify(original));
  await install([flag("cli-only"), flag("with-claude-code")]);
  let settings = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  await install([flag("uninstall")]);
  assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), original);
  await install([flag("cli-only")]);
  await run(binary, ["hook", "install", "claude-code", "--user"]);
  const existing = await readFile(settingsFile, "utf8");
  await install([flag("cli-only"), flag("with-claude-code")]);
  await install([flag("uninstall")]);
  assert.equal(await readFile(settingsFile, "utf8"), existing);
  console.log(
    `PASS real assets: tamper rejection, version, ${win || cliOnly ? "CLI" : "desktop self-test and clipboard"}, upgrade, uninstall, settings preservation`,
  );
} finally {
  server.close();
}
