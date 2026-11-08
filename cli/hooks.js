import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { scrubText } from "../engine/scrub.js";
import { atomicPrivate, dataDir } from "./store.js";

const targets = {
  "claude-code": { dir: ".claude", event: "UserPromptSubmit" },
  gemini: { dir: ".gemini", event: "BeforeAgent" },
};
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const command = (target) => `scrub hook run ${target}`;
const ours = (h, target) =>
  object(h) && h.type === "command" && h.command === command(target);

// Preserve unknown settings and every unrelated handler, including handlers in
// the same group. Never replace malformed settings with an empty configuration.
export function mergeHooks(settings, target, install) {
  if (!object(settings) || !targets[target]) throw Error("Invalid settings");
  const next = structuredClone(settings);
  if (next.hooks !== undefined && !object(next.hooks))
    throw Error("Invalid hooks");
  const event = targets[target].event;
  const groups = next.hooks?.[event] === undefined ? [] : next.hooks[event];
  if (
    !Array.isArray(groups) ||
    groups.some((g) => !object(g) || !Array.isArray(g.hooks))
  )
    throw Error("Invalid hook groups");
  if (install && groups.some((g) => g.hooks.some((h) => ours(h, target))))
    return next;
  if (!install && !groups.some((g) => g.hooks.some((h) => ours(h, target))))
    return next;
  const updated = install
    ? [...groups, { hooks: [{ type: "command", command: command(target) }] }]
    : groups.flatMap((g) => {
        const hooks = g.hooks.filter((h) => !ours(h, target));
        return hooks.length || !g.hooks.length ? [{ ...g, hooks }] : [];
      });
  next.hooks ??= {};
  if (updated.length) next.hooks[event] = updated;
  else delete next.hooks[event];
  if (!Object.keys(next.hooks).length) delete next.hooks;
  return next;
}

async function run() {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw Error("Input limit");
      chunks.push(chunk);
    }
    const input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (!object(input) || typeof input.prompt !== "string")
      throw Error("Invalid input");
    if (/^#noscrub(?:\s|$)/u.test(input.prompt)) return 0;
    let dictionary = [];
    try {
      const settings = JSON.parse(
        await readFile(join(dataDir(), "settings.json"), "utf8"),
      );
      if (!object(settings)) throw Error("Invalid settings");
      dictionary = settings.dictionary ?? [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Use the engine's default detectors even if desktop switches are disabled.
    // No mappings, prompt text or engine reports are persisted or printed.
    const { report } = scrubText(input.prompt, { dictionary });
    const counts = Object.entries(report.counts).filter(([, n]) => n > 0);
    if (!counts.length) return 0;
    process.stderr.write(
      `Scrub blocked this prompt: ${counts.map(([category, n]) => `${category}: ${n}`).join(", ")}.\nScrub the text with Ctrl+Alt+S or scrub, then submit it again; or prefix the prompt with #noscrub to send anyway.\n`,
    );
    return 2;
  } catch {
    process.stderr.write(
      "Scrub could not check this prompt. Check the hook input and shared dictionary, then retry.\n",
    );
    return 2;
  }
}

export async function hookMain(args) {
  const [action, target, ...flags] = args;
  if (
    !targets[target] ||
    !["install", "uninstall", "run"].includes(action) ||
    flags.length > 1 ||
    (flags.length && !["--project", "--user"].includes(flags[0])) ||
    (action === "run" && flags.length)
  ) {
    process.stderr.write(
      "Usage: scrub hook install|uninstall claude-code|gemini [--project|--user]\n       scrub hook run claude-code|gemini\n",
    );
    return 2;
  }
  if (action === "run") return run();
  try {
    const file = join(
      flags[0] === "--user" ? homedir() : process.cwd(),
      targets[target].dir,
      "settings.json",
    );
    let settings = {};
    try {
      settings = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const next = mergeHooks(settings, target, action === "install");
    if (JSON.stringify(next) !== JSON.stringify(settings))
      await atomicPrivate(file, JSON.stringify(next, null, 2) + "\n");
    process.stdout.write(
      `Scrub hook ${action === "install" ? "installed" : "removed"} (${flags[0] === "--user" ? "user" : "project"}).\n`,
    );
    return 0;
  } catch {
    process.stderr.write(
      "Cannot update hook settings. Check valid JSON and file permissions; existing settings were not replaced.\n",
    );
    return 2;
  }
}
