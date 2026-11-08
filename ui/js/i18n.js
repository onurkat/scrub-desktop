import locales from "./locales.js";
let language = "en";
export const languages = Object.keys(locales);
export function setLanguage(code) {
  const requested = code === "auto" ? navigator.language : code;
  language =
    languages.find(
      (x) =>
        x.replace("_", "-").toLowerCase() ===
        requested.replace("_", "-").toLowerCase(),
    ) ||
    languages.find((x) => x === requested.split("-")[0]) ||
    "en";
  document.documentElement.lang = language.replace("_", "-");
  document.documentElement.dir = locales[language].dir;
}
export function formatShortcut(value) {
  if (!/Mac/i.test(navigator.platform)) return value;
  return value
    .replace(/Ctrl\+/g, "⌃")
    .replace(/Alt\+/g, "⌥")
    .replace(/Shift\+/g, "⇧")
    .replace(/Super\+|Meta\+/g, "⌘");
}
export function t(key, ...args) {
  const value = locales[language][key];
  if (typeof value !== "string") throw new Error("Missing translation: " + key);
  return formatShortcut(
    value.replace(/\$(\d+)/g, (_, n) => String(args[Number(n) - 1] ?? "")),
  );
}
export function translate() {
  document
    .querySelectorAll("[data-i18n]")
    .forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const part of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = part.split(":");
      el.setAttribute(attr, t(key));
    }
  });
}
