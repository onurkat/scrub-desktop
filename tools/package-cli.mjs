// Build a native Node SEA: no installed Node, node_modules or locale files needed.
import { build } from "esbuild";
import { inject } from "postject";
import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  copyFile,
  chmod,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const out = resolve(".artifacts/cli");
await mkdir(out, { recursive: true });
const locales = {};
for (const file of await readdir("locales")) {
  if (/^[a-z]{2}(?:_[A-Z]{2})?\.json$/.test(file))
    locales[file.slice(0, -5)] = JSON.parse(
      await readFile(`locales/${file}`, "utf8"),
    );
}
await build({
  entryPoints: ["cli/scrub.js"],
  outfile: `${out}/main.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  plugins: [
    {
      name: "embedded-locales",
      setup(b) {
        b.onLoad({ filter: /cli[/\\]locale\.js$/ }, () => ({
          contents: `const locales=${JSON.stringify(locales)}; export async function loadLocale(code) { if (!locales[code]) { const e=new Error('Missing locale'); e.code='ENOENT'; throw e; } return locales[code]; }`,
          loader: "js",
        }));
      },
    },
  ],
});
await writeFile(
  `${out}/sea.json`,
  JSON.stringify({
    main: `${out}/main.cjs`,
    output: `${out}/sea.blob`,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }),
);
execFileSync(
  process.execPath,
  ["--experimental-sea-config", `${out}/sea.json`],
  { stdio: "inherit" },
);
const binary = `${out}/scrub${process.platform === "win32" ? ".exe" : ""}`;
await copyFile(process.execPath, binary);
if (process.platform === "darwin")
  execFileSync("codesign", ["--remove-signature", binary]);
await inject(binary, "NODE_SEA_BLOB", await readFile(`${out}/sea.blob`), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});
await chmod(binary, 0o755);
if (process.platform === "darwin")
  execFileSync("codesign", ["--sign", "-", binary]);
execFileSync(binary, ["--version"], { stdio: "inherit" });

execFileSync(process.execPath, ["tools/qa/sea-parity.mjs"], {
  stdio: "inherit",
});
