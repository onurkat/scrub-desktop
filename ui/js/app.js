import { docxWarnings } from "../vendor/docx-warnings.js";
import { defaults as detectorDefaults } from "../engine/detect.js";
import { scrubText, scrub } from "../engine/scrub.js";
import { restoreDocx } from "../engine/docx.js";
import { validateMapping } from "../engine/restore.js";
import {
  normalizeDictionary,
  importDictionary,
  exportDictionary,
} from "../engine/dictionary.js";
import {
  emptyStore,
  validateStore,
  currentMapping,
  commitMapping,
  bestRestore,
} from "./conversations.js";
import {
  t,
  setLanguage,
  translate,
  languages,
  formatShortcut,
} from "./i18n.js";
const invoke = window.__TAURI__.core.invoke;
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
let settings,
  store,
  review = null,
  clipboardMode = false,
  documentFile = null,
  documentResult = null,
  documentMapping = null,
  editIndex = -1,
  aliases = [];
const detectorKeys = {
  email: "detectEmail",
  phone: "detectPhone",
  iban: "detectIban",
  card: "detectCard",
  nationalId: "detectNationalId",
  secret: "detectSecret",
  url: "detectUrl",
  address: "detectAddress",
  money: "detectMoney",
  nameHeuristic: "detectNameHeuristic",
};
const categoryKeys = {
  EMAIL: "detectEmail",
  PHONE: "detectPhone",
  IBAN: "detectIban",
  CARD: "detectCard",
  ID: "detectNationalId",
  SECRET: "detectSecret",
  URL: "detectUrl",
  ADDRESS: "detectAddress",
  MONEY: "detectMoney",
  PERSON: "categoryPerson",
  ORG: "categoryOrg",
  TERM: "categoryTerm",
};
function status(key, ...args) {
  $("status").textContent = t(key, ...args);
}
function failure(error) {
  const key = String(error);
  status(
    [
      "shortcutConflict",
      "storageError",
      "fileError",
      "clipboardEmpty",
    ].includes(key)
      ? key
      : "genericError",
  );
}
function on(id, event, fn) {
  $(id).addEventListener(event, async (e) => {
    try {
      await fn(e);
    } catch (error) {
      failure(error);
    }
  });
}
function tab(name) {
  for (const button of document.querySelectorAll("[role=tab]")) {
    const selected = button.id === "tab-" + name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(button.getAttribute("aria-controls")).hidden = !selected;
  }
}
async function persist(next) {
  await invoke("set_mappings", { value: next });
  store = next;
  await renderRecent();
}
async function save(value) {
  settings = await invoke("save_settings", { value });
  status("settingsSaved");
  await renderRecent();
}
function policy() {
  return {
    dictionary: settings.dictionary,
    detectors: settings.detectors,
    mapping: review?.base ?? currentMapping(store),
    keep: review?.keep || [],
    manual: review?.manual || [],
  };
}
const count = (result) =>
  Object.values(result.report.counts).reduce((a, b) => a + b, 0);
async function notify(key, ...args) {
  status(key, ...args);
  await invoke("notify", { message: t(key, ...args) });
}
function clearReview() {
  document.body.classList.remove("clipboard-review");
  review = null;
  $("review").hidden = true;
  $("input").value = "";
  $("output").textContent = "";
  $("highlights").replaceChildren();
  $("matches").replaceChildren();
}
async function renderRecent() {
  $("recent").replaceChildren(new Option(t("recentChoose"), ""));
  const rows = store.recent.map((row) => ({
    id: row.id,
    label:
      new Intl.DateTimeFormat(document.documentElement.lang, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(row.time)) +
      " · " +
      Object.keys(row.mapping.placeholders).length,
  }));
  for (const row of rows) $("recent").add(new Option(row.label, row.id));
  $("recent").value = store.current || "";
  await invoke("menu_labels", {
    labels: {
      scrubClipboard:
        t("scrubClipboard") +
        " (" +
        formatShortcut(settings.scrubShortcut) +
        ")",
      restoreClipboard:
        t("restoreClipboard") +
        " (" +
        formatShortcut(settings.restoreShortcut) +
        ")",
      openScrub: t("actionTitle"),
      dictionary: t("tabDictionary"),
      recent: t("recentLabel"),
      settings: t("tabSettings"),
      quit: t("quit"),
    },
    recent: rows,
  });
}
function renderReview() {
  review.candidates = scrubText(review.original, {
    ...policy(),
    keep: [],
  }).matches;
  review.result = scrubText(review.original, policy());
  $("output").textContent = review.result.output;
  $("review").hidden = false;
  $("matches").replaceChildren();
  $("highlights").replaceChildren();
  const groups = new Map();
  for (const match of review.candidates) {
    if (!groups.has(match.category)) groups.set(match.category, []);
    groups.get(match.category).push(match);
  }
  const kept = (m) =>
    review.keep.some((k) => k.start === m.start && k.end === m.end);
  const toggle = (matches, keep) => {
    review.keep = review.keep.filter(
      (k) => !matches.some((m) => m.start === k.start && m.end === k.end),
    );
    if (keep)
      review.keep.push(...matches.map(({ start, end }) => ({ start, end })));
    renderReview();
  };
  for (const [category, matches] of groups) {
    const group = el("section", undefined, "match-group");
    group.append(el("h3", t(categoryKeys[category]) + " · " + matches.length));
    const actions = el("div", undefined, "actions");
    for (const [key, keep] of [
      ["keepCategory", true],
      ["replaceAll", false],
    ]) {
      const button = el("button", t(key));
      button.addEventListener("click", () => {
        toggle(matches, keep);
        $("matches").querySelector("button")?.focus();
      });
      actions.append(button);
    }
    group.append(actions);
    const rows = new Map();
    for (const m of matches) {
      const key = m.placeholder || m.value;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(m);
    }
    for (const occurrences of rows.values()) {
      const m = occurrences[0];
      const row = el("div", undefined, "match");
      row.id = "match-" + m.start;
      const text = el("span", m.value + " → " + m.placeholder);
      const button = el(
        "button",
        t(occurrences.every(kept) ? "replaceItem" : "keepOriginal"),
      );
      button.setAttribute("aria-pressed", String(occurrences.every(kept)));
      button.addEventListener("click", () => {
        toggle(occurrences, !occurrences.every(kept));
        $("match-" + m.start)
          ?.querySelector("button")
          .focus();
      });
      row.append(text, button);
      group.append(row);
    }
    $("matches").append(group);
  }
  let offset = 0;
  for (const m of review.candidates) {
    $("highlights").append(
      document.createTextNode(review.original.slice(offset, m.start)),
    );
    const button = el(
      "button",
      review.original.slice(m.start, m.end),
      kept(m) ? "kept" : "highlight",
    );
    button.addEventListener("click", () => {
      const first = review.candidates.find(
        (x) =>
          x.category === m.category &&
          (x.placeholder || x.value) === (m.placeholder || m.value),
      );
      $("match-" + first.start)?.scrollIntoView({ block: "nearest" });
      $("match-" + first.start)
        ?.querySelector("button")
        .focus();
    });
    $("highlights").append(button);
    offset = m.end;
  }
  $("highlights").append(
    document.createTextNode(review.original.slice(offset)),
  );
  for (const suggestion of review.result.report.review) {
    if (
      review.candidates.some(
        (m) =>
          m.start === suggestion.offset &&
          m.end === suggestion.offset + suggestion.text.length,
      )
    )
      continue;
    const row = el("div", undefined, "match");
    row.append(el("span", t("reviewSuggestion", suggestion.text)));
    const accept = el("button", t("replaceItem"));
    accept.addEventListener("click", () => {
      review.manual = [
        ...(review.manual || []),
        {
          start: suggestion.offset,
          end: suggestion.offset + suggestion.text.length,
          category: "PERSON",
        },
      ];
      renderReview();
    });
    row.append(accept);
    $("matches").append(row);
  }
  $("review-count").textContent = t("replacementsCount", count(review.result));
  if (clipboardMode) $("status").textContent = "";
  else status("replacementsCount", count(review.result));
}
function runText(text) {
  $("scrub").append($("review"));
  $("copy").textContent = t("copyScrubbed");
  review = {
    original: text,
    base: currentMapping(store),
    keep: [],
    result: null,
    candidates: [],
  };
  review.candidates = scrubText(text, policy()).matches;
  renderReview();
}
function showDocumentWarnings(result) {
  const notices = docxWarnings(result.report?.skipped);
  $("document-warnings").replaceChildren(
    ...notices.map(([key, ...args]) => el("li", t(key, ...args))),
  );
  $("document-warnings").hidden = !notices.length;
  return notices;
}
async function approveDocument(result) {
  if (!showDocumentWarnings(result).length) return true;
  const dialog = $("document-confirm");
  dialog.returnValue = "";
  const answer = new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "save"),
      { once: true },
    ),
  );
  dialog.showModal();
  $("document-cancel").focus();
  return answer;
}
async function copyReview() {
  if (!review) throw new Error("genericError");
  if (review.file) {
    const file = review.file;
    const result = await scrub(
      /\.docx$/i.test(file.name)
        ? { kind: "docx", bytes: file.bytes }
        : { kind: "text", text: review.original },
      policy(),
    );
    if (!(await approveDocument(result))) return;
    if (
      await fileSave(
        file.name.replace(/(\.[^.]+)$/, "-scrubbed$1"),
        result.output,
      )
    ) {
      await persist(
        commitMapping(
          store,
          result.mapping,
          crypto.randomUUID(),
          new Date().toISOString(),
        ),
      );
      documentResult = result;
      $("mapping-save").hidden = false;
    }
    return;
  }
  const result = review.result;
  await persist(
    commitMapping(
      store,
      result.mapping,
      crypto.randomUUID(),
      new Date().toISOString(),
    ),
  );
  await invoke("write_clipboard", { text: result.output });
  const n = count(result);
  if (clipboardMode) {
    clearReview();
    await invoke("hide_window");
    const categories = Object.entries(result.report.counts)
      .map(([key, value]) => t(categoryKeys[key]) + ": " + value)
      .join(", ");
    status("scrubbedNotice", n);
    await invoke("notify", {
      message: t("scrubbedNotice", n) + " " + categories,
    });
  } else status("copiedScrubbed");
}
async function clipboardScrub() {
  clearReview();
  const boot = await invoke("bootstrap");
  settings = boot.settings;
  store = validateStore(boot.mappings);
  clipboardMode = true;
  document.body.classList.add("clipboard-review");
  tab("scrub");
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  let text;
  try {
    text = await invoke("read_clipboard");
  } catch {
    await notify("clipboardEmpty");
    await invoke("hide_window");
    return;
  }
  if (!text.trim()) {
    await notify("clipboardEmpty");
    await invoke("hide_window");
    return;
  }
  $("input").value = text;
  runText(text);
  if (!count(review.result) && !review.result.report.review.length) {
    clearReview();
    await notify("noSensitive");
    await invoke("hide_window");
    return;
  }
  if (settings.skipReview) await copyReview();
  else $("copy").focus();
}
async function restoreText(text, clipboard = false) {
  const result = bestRestore(text, store);
  $("answer").value = text;
  $("restored").textContent = result.output;
  $("restored").hidden = false;
  $("copy-restored").hidden = false;
  $("unknown").textContent = result.unknown.length
    ? t("unknownKept", result.unknown.join(", "))
    : t("allRestored");
  if (clipboard) {
    if (!result.hasTokens) {
      await notify("noPlaceholders");
      return;
    }
    await invoke("write_clipboard", { text: result.output });
    if (result.unknown.length) tab("restore");
    else {
      $("answer").value = "";
      $("restored").textContent = "";
      await invoke("hide_window");
    }
    await notify("restoredNotice", result.count);
  } else status(result.hasTokens ? "allRestored" : "noPlaceholders");
}
async function selfTest() {
  let previous,
    success = false;
  try {
    previous = await invoke("read_clipboard");
    const result = scrubText("canary@example.invalid");
    if (result.output !== "[EMAIL_1]") throw new Error();
    await invoke("write_clipboard", { text: result.output });
    success =
      (await invoke("read_clipboard")) === result.output &&
      bestRestore(
        result.output,
        commitMapping(
          emptyStore(),
          result.mapping,
          "test",
          new Date().toISOString(),
        ),
      ).output === "canary@example.invalid";
  } catch {
    success = false;
  } finally {
    if (previous !== undefined) {
      try {
        await invoke("write_clipboard", { text: previous });
        success = success && (await invoke("read_clipboard")) === previous;
      } catch {
        success = false;
      }
    }
    await invoke("finish_self_test", { success, previous: previous ?? null });
  }
}
async function action(name) {
  if (name === "self-test") return selfTest();
  if (name === "scrub") return clipboardScrub();
  clipboardMode = false;
  document.body.classList.remove("clipboard-review");
  if (name === "restore") {
    const boot = await invoke("bootstrap");
    store = validateStore(boot.mappings);
    return restoreText(await invoke("read_clipboard"), true);
  }
  if (name.startsWith("recent:")) {
    await persist({ ...store, current: name.slice(7) });
    tab("restore");
    status("mappingSelected");
    return;
  }
  tab(["dictionary", "settings"].includes(name) ? name : "scrub");
}
function renderAliases() {
  $("alias-chips").replaceChildren();
  for (const [index, alias] of aliases.entries()) {
    const chip = el("span", alias, "chip");
    const button = el("button", "×");
    button.type = "button";
    button.setAttribute("aria-label", t("removeAlias", alias));
    button.addEventListener("click", () => {
      aliases.splice(index, 1);
      renderAliases();
      $("aliases").focus();
    });
    chip.append(button);
    $("alias-chips").append(chip);
  }
}
function addAlias() {
  const value = $("aliases").value.trim().replace(/,$/, "");
  if (value && !aliases.includes(value)) aliases.push(value);
  $("aliases").value = "";
  renderAliases();
}
function resetForm() {
  editIndex = -1;
  aliases = [];
  $("dictionary-form").reset();
  $("form-home").after($("dictionary-form"));
  $("edit-cancel").hidden = true;
  renderAliases();
}
function renderDictionary() {
  if (editIndex >= 0) resetForm();
  const query = $("dictionary-search").value.toLocaleLowerCase();
  $("dictionary-list").replaceChildren();
  if (!settings.dictionary.length)
    $("dictionary-list").append(el("p", t("dictionaryEmpty")));
  for (const [index, entry] of settings.dictionary.entries()) {
    if (
      ![entry.term, ...entry.aliases]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    )
      continue;
    const row = el("article", undefined, "entry");
    row.append(el("strong", entry.term), el("p", entry.aliases.join(" · ")));
    const edit = el("button", t("edit"));
    edit.addEventListener("click", () => {
      editIndex = index;
      $("term").value = entry.term;
      $("category").value = entry.category;
      aliases = [...entry.aliases];
      row.append($("dictionary-form"));
      $("edit-cancel").hidden = false;
      renderAliases();
      $("term").focus();
    });
    const remove = el("button", t("delete"));
    remove.addEventListener("click", async () => {
      try {
        await save({
          dictionary: settings.dictionary.filter((_, i) => i !== index),
        });
        resetForm();
        renderDictionary();
      } catch (error) {
        failure(error);
      }
    });
    row.append(edit, remove);
    $("dictionary-list").append(row);
  }
}
async function fileSave(name, bytes) {
  return invoke("save_file", {
    name,
    bytes: Array.from(
      typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
    ),
  });
}
function selectFile(file) {
  if (!/\.(docx|txt|csv|md)$/i.test(file.name)) throw new Error("fileError");
  documentFile = { name: file.name, bytes: new Uint8Array(file.bytes) };
  documentResult = null;
  $("document-warnings").replaceChildren();
  $("document-warnings").hidden = true;
  $("document-name").textContent = file.name;
  $("document-scrub").disabled = false;
  $("document-restore").disabled = !documentMapping;
  $("document-save").hidden = true;
  $("mapping-save").hidden = true;
  $("document-preview").hidden = true;
}
async function runDocument(restore = false) {
  if (!documentFile) return;
  const docx = /\.docx$/i.test(documentFile.name);
  if (restore) {
    if (!documentMapping) throw new Error("fileError");
    documentResult = docx
      ? await restoreDocx(documentFile.bytes, documentMapping)
      : bestRestore(
          new TextDecoder().decode(documentFile.bytes),
          commitMapping(
            emptyStore(),
            documentMapping,
            "import",
            new Date().toISOString(),
          ),
        );
  } else
    documentResult = await scrub(
      docx
        ? { kind: "docx", bytes: documentFile.bytes }
        : { kind: "text", text: new TextDecoder().decode(documentFile.bytes) },
      {
        dictionary: settings.dictionary,
        detectors: settings.detectors,
        mapping: currentMapping(store),
      },
    );
  showDocumentWarnings(documentResult);
  if (!restore) {
    runText(documentResult.inputText);
    review.file = documentFile;
    $("documents").append($("review"));
    $("copy").textContent = t("saveDocument");
    $("document-save").hidden = true;
    $("document-preview").hidden = true;
    return;
  }
  $("document-preview").textContent =
    documentResult.outputText ??
    (typeof documentResult.output === "string"
      ? documentResult.output
      : t("allRestored"));
  $("document-preview").hidden = false;
  $("document-save").hidden = false;
  $("mapping-save").hidden = restore;
}
function renderSettings() {
  for (const [id, key] of [
    ["skip-review", "skipReview"],
    ["keep-mappings", "keepMappings"],
    ["autostart", "autostart"],
  ])
    $(id).checked = settings[key];
  $("scrub-shortcut").dataset.accelerator = settings.scrubShortcut;
  $("scrub-shortcut").value = formatShortcut(settings.scrubShortcut);
  $("restore-shortcut").dataset.accelerator = settings.restoreShortcut;
  $("restore-shortcut").value = formatShortcut(settings.restoreShortcut);
  $("detectors").replaceChildren();
  for (const [key, label] of Object.entries(detectorKeys)) {
    const wrapper = el("label", undefined, "check");
    const input = el("input");
    input.type = "checkbox";
    input.checked = settings.detectors[key] ?? detectorDefaults[key];
    input.addEventListener("change", async () => {
      try {
        await save({
          detectors: { ...settings.detectors, [key]: input.checked },
        });
      } catch (error) {
        input.checked = !input.checked;
        failure(error);
      }
    });
    wrapper.append(input, el("span", t(label)));
    $("detectors").append(wrapper);
  }
  $("language").replaceChildren(new Option(t("automaticLanguage"), "auto"));
  for (const code of languages)
    $("language").add(
      new Option(
        new Intl.DisplayNames([code.replace("_", "-")], {
          type: "language",
        }).of(code.replace("_", "-")),
        code,
      ),
    );
  $("language").value = settings.language;
}
for (const button of document.querySelectorAll("[role=tab]")) {
  button.addEventListener("click", () => {
    tab(button.id.slice(4));
    status("statusReady");
  });
  button.addEventListener("keydown", (e) => {
    const buttons = [...document.querySelectorAll("[role=tab]")];
    let index = buttons.indexOf(button);
    const direction = document.documentElement.dir === "rtl" ? -1 : 1;
    if (e.key === "ArrowRight") index += direction;
    else if (e.key === "ArrowLeft") index -= direction;
    else if (e.key === "Home") index = 0;
    else if (e.key === "End") index = buttons.length - 1;
    else return;
    e.preventDefault();
    const next = buttons[(index + buttons.length) % buttons.length];
    tab(next.id.slice(4));
    next.focus();
  });
}
on("run", "click", () => {
  clipboardMode = false;
  document.body.classList.remove("clipboard-review");
  runText($("input").value);
});
on("copy", "click", copyReview);
on("open-full", "click", () => action("open"));
on("from-clipboard", "click", clipboardScrub);
on("cancel", "click", async () => {
  clearReview();
  if (clipboardMode) await invoke("hide_window");
});
on("new-conversation", "click", async () => {
  await persist({ ...store, current: null });
  if (review) {
    review.base = undefined;
    runText(review.original);
  }
});
on("restore-run", "click", () => restoreText($("answer").value));
on("restore-clipboard", "click", () => action("restore"));
on("copy-restored", "click", async () => {
  await invoke("write_clipboard", { text: $("restored").textContent });
  status("copiedRestored");
});
on("recent", "change", async () => {
  await persist({ ...store, current: $("recent").value || null });
  status("mappingSelected");
});
on("dictionary-search", "input", renderDictionary);
on("aliases", "keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addAlias();
  }
});
on("edit-cancel", "click", resetForm);
on("dictionary-form", "submit", async (e) => {
  e.preventDefault();
  addAlias();
  const entry = normalizeDictionary([
    { term: $("term").value, category: $("category").value, aliases },
  ])[0];
  const next = [...settings.dictionary];
  if (editIndex < 0) next.push(entry);
  else next[editIndex] = entry;
  await save({ dictionary: next });
  resetForm();
  renderDictionary();
});
on("import-csv", "click", async () => {
  const file = await invoke("choose_file", { kind: "dictionary" });
  if (!file) return;
  if (file.bytes.length > 5 * 1024 * 1024) {
    status("errCsvSize");
    return;
  }
  await save({
    dictionary: importDictionary(
      new TextDecoder().decode(new Uint8Array(file.bytes)),
    ),
  });
  resetForm();
  renderDictionary();
  status("dictionaryImported");
});
on("export-csv", "click", () =>
  fileSave("dictionary.csv", exportDictionary(settings.dictionary)),
);
on("choose-document", "click", async () => {
  const file = await invoke("choose_file", { kind: "document" });
  if (file) selectFile(file);
});
on("drop-zone", "dragover", (e) => e.preventDefault());
on("drop-zone", "drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) selectFile({ name: file.name, bytes: await file.arrayBuffer() });
});
on("choose-mapping", "click", async () => {
  const file = await invoke("choose_file", { kind: "mapping" });
  if (file) {
    documentMapping = validateMapping(
      JSON.parse(new TextDecoder().decode(new Uint8Array(file.bytes))),
    );
    $("document-restore").disabled = !documentFile;
  }
});
on("document-scrub", "click", () => runDocument());
on("document-restore", "click", () => runDocument(true));
on("document-save", "click", async () => {
  if (
    await fileSave(
      documentFile.name.replace(/(\.[^.]+)$/, "-processed$1"),
      documentResult.output,
    )
  ) {
    if (documentResult.mapping)
      await persist(
        commitMapping(
          store,
          documentResult.mapping,
          crypto.randomUUID(),
          new Date().toISOString(),
        ),
      );
  }
});
on("mapping-save", "click", () =>
  fileSave("mapping.json", JSON.stringify(documentResult.mapping, null, 2)),
);
for (const [id, key] of [
  ["skip-review", "skipReview"],
  ["keep-mappings", "keepMappings"],
  ["autostart", "autostart"],
])
  on(id, "change", async () => {
    try {
      await save({ [key]: $(id).checked });
    } catch (error) {
      $(id).checked = settings[key];
      throw error;
    }
  });
for (const id of ["scrub-shortcut", "restore-shortcut"])
  on(id, "keydown", (e) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
    const accelerator = [
      e.ctrlKey ? "Ctrl" : null,
      e.altKey ? "Alt" : null,
      e.shiftKey ? "Shift" : null,
      e.metaKey ? "Super" : null,
      e.code.replace(/^Key|^Digit/, ""),
    ]
      .filter(Boolean)
      .join("+");
    $(id).dataset.accelerator = accelerator;
    $(id).value = formatShortcut(accelerator);
  });
on("save-shortcuts", "click", () =>
  save({
    scrubShortcut: $("scrub-shortcut").dataset.accelerator,
    restoreShortcut: $("restore-shortcut").dataset.accelerator,
  }),
);
on("language", "change", async () => {
  await save({ language: $("language").value });
  setLanguage(settings.language);
  translate();
  renderSettings();
  renderDictionary();
  await renderRecent();
  if (review) renderReview();
});
on("clear-mappings", "click", () => {
  $("confirmation-text").textContent = t("confirmClear");
  $("confirmation").showModal();
  $("confirm-no").focus();
});
on("confirm-no", "click", () => $("confirmation").close());
on("confirm-yes", "click", async () => {
  await invoke("clear_mappings");
  store = emptyStore();
  clearReview();
  documentMapping = null;
  documentResult = null;
  $("answer").value = "";
  $("restored").textContent = "";
  $("confirmation").close();
  await renderRecent();
  status("allDeleted");
});
on("dismiss-welcome", "click", async () => {
  await save({ welcomed: true });
  $("welcome").hidden = true;
});
on("sample", "click", async () => {
  await save({ welcomed: true });
  $("welcome").hidden = true;
  tab("scrub");
  $("input").value = t("sampleText");
  clipboardMode = false;
  document.body.classList.remove("clipboard-review");
  runText($("input").value);
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !$("confirmation").open &&
    !$("document-confirm").open &&
    review
  ) {
    e.preventDefault();
    $("cancel").click();
  }
  if (
    e.key === "Enter" &&
    review &&
    !$("scrub").hidden &&
    !["TEXTAREA", "INPUT", "BUTTON", "SELECT"].includes(e.target.tagName)
  ) {
    e.preventDefault();
    $("copy").click();
  }
});
for (const link of document.querySelectorAll("a[href]"))
  link.addEventListener("click", (event) => {
    event.preventDefault();
    invoke("open_link", { url: link.href }).catch(failure);
  });
try {
  const boot = await invoke("bootstrap");
  settings = boot.settings;
  store = validateStore(boot.mappings);
  setLanguage(settings.language);
  translate();
  renderSettings();
  renderDictionary();
  await renderRecent();
  $("version").textContent = boot.version;
  $("wayland").hidden = !boot.wayland;
  $("welcome").hidden = settings.welcomed;
  status(boot.shortcutError ? "shortcutConflict" : "statusReady");
  await window.__TAURI__.event.listen("action", (event) =>
    action(event.payload).catch(failure),
  );
  for (const pending of await invoke("frontend_ready")) await action(pending);
} catch (error) {
  failure(error);
}
