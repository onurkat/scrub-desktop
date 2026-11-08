import {
  mkdir,
  copyFile,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
await mkdir("ui/engine", { recursive: true });
await mkdir("ui/vendor", { recursive: true });
for (const f of await readdir("engine"))
  if (f.endsWith(".js"))
    await writeFile(
      "ui/engine/" + f,
      (await readFile("engine/" + f, "utf8")).replace(
        'from "fflate"',
        'from "../vendor/fflate.js"',
      ),
    );
await copyFile("node_modules/fflate/esm/browser.js", "ui/vendor/fflate.js");
const localeDir = new URL("../locales/", import.meta.url);
const { readFile: readLocale } = await import("node:fs/promises");
const locales = {};
for (const name of await readdir(localeDir))
  if (name.endsWith(".json") && !name.startsWith("_"))
    locales[name.slice(0, -5)] = JSON.parse(
      await readLocale(new URL(name, localeDir), "utf8"),
    );
await writeFile(
  new URL("../ui/js/locales.js", import.meta.url),
  "export default " + JSON.stringify(locales) + ";\n",
);
