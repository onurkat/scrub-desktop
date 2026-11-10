import { readFile } from "node:fs/promises";
export async function loadLocale(code) {
  return JSON.parse(
    await readFile(new URL(`../locales/${code}.json`, import.meta.url), "utf8"),
  );
}
