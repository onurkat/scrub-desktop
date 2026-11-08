import { homedir } from "node:os";
import { join, dirname } from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  chmod,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
export function dataDir() {
  return (
    process.env.SCRUB_DATA_DIR ||
    join(
      process.platform === "win32"
        ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
        : process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support")
          : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
      "com.onurkat.scrub-desktop",
    )
  );
}
export async function atomicPrivate(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, data, { mode: 0o600, flag: "wx" });
    await rename(temp, file);
    if (process.platform !== "win32") await chmod(file, 0o600);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function loadStore() {
  try {
    const s = JSON.parse(
      await readFile(join(dataDir(), "mappings.json"), "utf8"),
    );
    if (s.version !== 1 || !Array.isArray(s.recent))
      throw Error("Invalid mapping store");
    return s;
  } catch (e) {
    if (e.code === "ENOENT") return { version: 1, current: null, recent: [] };
    throw Error("Cannot read mapping store");
  }
}
export async function lastMapping() {
  const s = await loadStore();
  return (
    s.recent.find((r) => r.id === s.current)?.mapping || s.recent[0]?.mapping
  );
}
export async function saveMapping(mapping) {
  const dir = dataDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "mappings.lock");
  let held = false;
  for (let i = 0; i < 30; i++) {
    try {
      await mkdir(lock);
      held = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!held) throw Error("Mapping store is busy");
  try {
    const s = await loadStore(),
      id = randomUUID();
    s.current = id;
    s.recent = [
      { id, time: new Date().toISOString(), mapping },
      ...s.recent,
    ].slice(0, 10);
    await atomicPrivate(join(dir, "mappings.json"), JSON.stringify(s) + "\n");
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
