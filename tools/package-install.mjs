import {
  mkdir,
  copyFile,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const out = ".artifacts/install-assets";
await mkdir(out, { recursive: true });
const platform = process.platform,
  arch = process.arch;
if (platform === "win32")
  execFileSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path .artifacts/cli/scrub.exe -DestinationPath ${out}/scrub-cli-win32-${arch}.zip -Force`,
    ],
    { stdio: "inherit" },
  );
else
  execFileSync("tar", [
    "-czf",
    `${out}/scrub-cli-${platform}-${arch}.tar.gz`,
    "-C",
    ".artifacts/cli",
    "scrub",
  ]);
if (process.env.SCRUB_PACKAGE_CLI_ONLY) {
  // Additional CLI-only architecture runners do not build a desktop bundle.
} else if (platform === "linux") {
  for (const [dir, ext] of [
    ["appimage", "AppImage"],
    ["deb", "deb"],
  ]) {
    const root = `src-tauri/target/release/bundle/${dir}`;
    const candidates = (await readdir(root)).filter(
      (f) => f.includes(version) && f.endsWith(`.${ext}`),
    );
    if (candidates.length !== 1)
      throw Error(`Expected one ${version} ${ext} bundle`);
    await copyFile(
      `${root}/${candidates[0]}`,
      `${out}/Scrub_${arch === "x64" ? "amd64" : "aarch64"}.${ext}`,
    );
  }
  await copyFile("src-tauri/icons/128x128.png", `${out}/scrub.png`);
} else if (platform === "darwin") {
  const root = "src-tauri/target/universal-apple-darwin/release/bundle/macos";
  execFileSync(
    "codesign",
    ["--force", "--deep", "-s", "-", `${root}/Scrub.app`],
    { stdio: "inherit" },
  );
  execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", `${root}/Scrub.app`],
    { stdio: "inherit" },
  );
  execFileSync("codesign", ["-dv", `${root}/Scrub.app`], { stdio: "inherit" });
  execFileSync("tar", [
    "-czf",
    `${out}/Scrub_${version}_universal.app.tar.gz`,
    "-C",
    root,
    "Scrub.app",
  ]);
  await copyFile(
    `${out}/Scrub_${version}_universal.app.tar.gz`,
    `${out}/Scrub_universal.app.tar.gz`,
  );
}
if (platform === "win32" && !process.env.SCRUB_PACKAGE_CLI_ONLY)
  await copyFile(
    ".artifacts/Scrub-unsigned.msix",
    `${out}/Scrub_${version}_x64.msix`,
  );
for (const file of ["install.sh", "install.ps1"])
  await copyFile(`packaging/install/${file}`, `${out}/${file}`);
let sums = "";
for (const file of (await readdir(out)).sort()) {
  if (file === "SHA256SUMS") continue;
  sums += `${createHash("sha256")
    .update(await readFile(`${out}/${file}`))
    .digest("hex")}  ${file}\n`;
}
await writeFile(`${out}/SHA256SUMS`, sums);
