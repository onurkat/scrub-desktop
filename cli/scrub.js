#!/usr/bin/env node
import { docxWarnings } from "./docx-warnings.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scrub } from "../engine/scrub.js";
import { restoreDetailed, validateMapping } from "../engine/restore.js";
import { restoreDocx } from "../engine/docx.js";
import { importDictionary } from "../engine/dictionary.js";
import { atomicPrivate, lastMapping, saveMapping } from "./store.js";
const usage = `Usage: scrub [FILE|-] [--out FILE] [--dictionary CSV] [--policy JSON]
             [--language CODE] [--save-anyway]
             [--mapping FILE] [--continue FILE] [--keep] [--report] [--json] [--fail-on-detect]
       scrub restore [FILE|-] (--mapping FILE | --last) [--out FILE] [--json]
Text defaults to stdin/stdout. DOCX requires --out. Mapping storage is opt-in.
Exit codes: 0 success, 1 usage, 2 input/storage error, 3 detected (--fail-on-detect).`;
class Failure extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}
async function jsonFile(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Failure("Cannot read valid " + label + " JSON.");
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return;
  }
  if (args.includes("--version")) {
    console.log("1.0.0");
    return;
  }
  const restoring = args[0] === "restore";
  if (restoring) args.shift();
  const opts = {};
  let input;
  const values = new Set([
    "--out",
    "--dictionary",
    "--policy",
    "--mapping",
    "--continue",
    "--language",
  ]);
  const flags = new Set([
    "--keep",
    "--report",
    "--json",
    "--fail-on-detect",
    "--last",
    "--save-anyway",
  ]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (values.has(a)) {
      if (!args[i + 1] || args[i + 1].startsWith("--") || a in opts)
        throw new Failure("Missing or duplicate option value.", 1);
      opts[a] = args[++i];
    } else if (flags.has(a)) {
      opts[a] = true;
    } else if (a === "-" || !a.startsWith("-")) {
      if (input !== undefined)
        throw new Failure("Only one input is allowed.", 1);
      input = a;
    } else throw new Failure("Unknown option. Use --help.", 1);
  }
  if (restoring && !opts["--mapping"] && !opts["--last"])
    throw new Failure("Restore requires --mapping or --last.", 1);
  if (
    restoring &&
    [
      "--dictionary",
      "--policy",
      "--continue",
      "--keep",
      "--fail-on-detect",
    ].some((k) => opts[k])
  )
    throw new Failure("Scrub-only option used with restore.", 1);
  if (!restoring && opts["--last"])
    throw new Failure("--last requires restore.", 1);
  if (restoring && opts["--last"] && opts["--mapping"])
    throw new Failure("Choose --last or --mapping.", 1);
  const docx = /\.docx$/i.test(input || "");
  if (docx && (!opts["--out"] || opts["--json"]))
    throw new Failure("DOCX requires --out and does not support --json.", 1);
  const outputs = [opts["--out"], !restoring && opts["--mapping"]]
    .filter(Boolean)
    .map((p) => resolve(p));
  const inputs = [
    input && input !== "-" ? input : null,
    opts["--policy"],
    opts["--dictionary"],
    opts["--continue"],
    restoring && opts["--mapping"],
  ]
    .filter(Boolean)
    .map((p) => resolve(p));
  if (
    new Set(outputs).size !== outputs.length ||
    outputs.some((p) => inputs.includes(p))
  )
    throw new Failure("Output paths must be distinct from all input paths.", 1);
  let bytes;
  try {
    if (input && input !== "-") bytes = await readFile(input);
    else {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      bytes = Buffer.concat(chunks);
    }
  } catch {
    throw new Failure("Cannot read input.");
  }
  let text;
  if (!docx)
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Failure("Input is not valid UTF-8 text.");
    }
  let result;
  if (restoring) {
    const mapping = opts["--last"]
      ? await lastMapping()
      : await jsonFile(opts["--mapping"], "mapping");
    if (!mapping)
      throw new Failure("No saved mapping. Use scrub --keep first.");
    try {
      validateMapping(mapping);
      result = docx
        ? restoreDocx(bytes, mapping)
        : restoreDetailed(text, mapping);
    } catch {
      throw new Failure("Cannot restore: invalid mapping or document.");
    }
  } else {
    const policy = opts["--policy"]
      ? await jsonFile(opts["--policy"], "policy")
      : {};
    if (!policy || typeof policy !== "object" || Array.isArray(policy))
      throw new Failure("Policy must be a JSON object.");
    if (opts["--dictionary"])
      try {
        policy.dictionary = importDictionary(
          await readFile(opts["--dictionary"], "utf8"),
        );
      } catch {
        throw new Failure("Cannot read a valid dictionary CSV.");
      }
    if (opts["--continue"])
      policy.mapping = await jsonFile(
        opts["--continue"],
        "continuation mapping",
      );
    else if (opts["--keep"]) policy.mapping = await lastMapping();
    try {
      result = await scrub(
        docx ? { kind: "docx", bytes } : { kind: "text", text },
        policy,
      );
    } catch {
      throw new Failure("Cannot scrub: invalid policy, mapping or document.");
    }
    const warnings = docxWarnings(result.report?.skipped);
    if (warnings.length) {
      const requested =
        opts["--language"] || process.env.LC_ALL || process.env.LANG || "en";
      const code = requested.split(".")[0].replace("-", "_");
      let locale;
      for (const candidate of [code, code.split("_")[0], "en"]) {
        if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(candidate)) continue;
        try {
          locale = JSON.parse(
            await readFile(
              new URL(`../locales/${candidate}.json`, import.meta.url),
              "utf8",
            ),
          );
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      const translate = (key, ...args) =>
        locale[key].replace(/\$(\d+)/g, (_, n) => String(args[Number(n) - 1]));
      for (const [key, ...args] of warnings)
        process.stderr.write(translate(key, ...args) + "\n");
      if (!opts["--save-anyway"])
        throw new Failure(translate("saveAnyway") + ": --save-anyway", 1);
    }
    if (opts["--mapping"])
      await atomicPrivate(
        opts["--mapping"],
        JSON.stringify(result.mapping, null, 2) + "\n",
      );
    if (opts["--keep"]) await saveMapping(result.mapping);
  }
  const output = opts["--json"]
    ? JSON.stringify({
        output: result.output,
        report: result.report,
        unknown: result.unknown,
      }) + "\n"
    : result.output;
  if (opts["--out"]) await atomicPrivate(opts["--out"], output);
  else process.stdout.write(output);
  if (opts["--report"] && result.report)
    process.stderr.write(
      JSON.stringify(result.report.categories || result.report.counts || {}) +
        "\n",
    );
  if (restoring && result.unknown.length)
    process.stderr.write(
      `${result.unknown.length} unknown placeholders remain.\n`,
    );
  if (
    opts["--fail-on-detect"] &&
    Object.values(result.report.counts).some((n) => n > 0)
  )
    process.exitCode = 3;
}
main().catch((e) => {
  process.stderr.write(
    (e instanceof Failure
      ? e.message
      : "Cannot access the mapping store or output file.") + "\n",
  );
  process.exitCode = e instanceof Failure ? e.code : 2;
});
