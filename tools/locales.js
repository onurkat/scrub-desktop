import { readFile, readdir, writeFile } from "node:fs/promises";
export async function checkLocales(prune = false) {
  const base = JSON.parse(await readFile("locales/en.json", "utf8"));
  const source =
    (await readFile("ui/index.html", "utf8")) +
    "\n" +
    (await readFile("ui/js/app.js", "utf8"));
  const keys = Object.keys(base).filter(
    (key) =>
      ["lang", "dir"].includes(key) ||
      source.includes("'" + key + "'") ||
      source.includes('"' + key + '"') ||
      source.includes(":" + key + '"'),
  );
  const files = (await readdir("locales")).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_"),
  );
  if (files.length !== 34) throw Error("Expected 34 locales");
  const tokens = (s) => (s.match(/\$\d+/g) || []).sort().join(",");
  for (const file of files) {
    const data = JSON.parse(await readFile("locales/" + file, "utf8"));
    const name = file.slice(0, -5);
    for (const key of keys) {
      if (typeof data[key] !== "string" || !data[key].trim())
        throw Error(name + ": missing " + key);
      if (tokens(data[key]) !== tokens(base[key]))
        throw Error(name + ": substitutions " + key);
    }
    if (data.dir !== (["ar", "he", "fa"].includes(name) ? "rtl" : "ltr"))
      throw Error(name + ": direction");
    if (prune)
      await writeFile(
        "locales/" + file,
        JSON.stringify(
          Object.fromEntries(keys.map((k) => [k, data[k]])),
          null,
          2,
        ) + "\n",
      );
    else
      for (const key of Object.keys(data))
        if (!keys.includes(key)) throw Error(name + ": unused " + key);
  }
  if (prune) {
    const context = JSON.parse(await readFile("locales/_context.json", "utf8"));
    const result = {
      _general:
        "Scrub Desktop: local clipboard and document anonymisation. Keep placeholders and $1 substitutions intact. Native, concise UI language; no browser-extension terminology.",
    };
    for (const key of keys) result[key] = context[key] || base[key];
    await writeFile(
      "locales/_context.json",
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  return { locales: files.length, keys: keys.length };
}
if (process.argv[1]?.endsWith("/locales.js"))
  console.log(await checkLocales(process.argv.includes("--prune")));
