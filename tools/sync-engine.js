import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.env.SCRUB_SOURCE || resolve(root, "../scrub"));
const names = ["detect", "dictionary", "scrub", "restore", "report", "docx"];
const files = {};
await mkdir(resolve(root, "engine"), { recursive: true });
for (const name of names) {
  const file = name + ".js",
    bytes = await readFile(resolve(source, "src", file));
  await writeFile(resolve(root, "engine", file), bytes);
  files[file] = createHash("sha256").update(bytes).digest("hex");
}
const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await writeFile(
  resolve(root, "engine/SOURCE.json"),
  JSON.stringify(
    { repository: "https://github.com/onurkat/scrub", commit, files },
    null,
    2,
  ) + "\n",
);
console.log("Synced six engine modules from " + commit);
