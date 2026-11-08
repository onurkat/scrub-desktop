import { test } from "node:test";
import assert from "node:assert/strict";
import { docxWarnings } from "../cli/docx-warnings.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
test("all engine notices become keys/counts without original content", () => {
  const result = docxWarnings([
    "2 images not inspected",
    "3 embedded objects not inspected",
    "1 field instructions (including HYPERLINK/MAILTO codes; visible results inspected) not inspected",
    "tracked changes present; deleted text also inspected",
    "1 mailto: hyperlink targets replaced with placeholders (links no longer open a mail client)",
    "mailto: hyperlink targets kept (address not in the text): private@example.com, [EMAIL_1]",
    "reviewer names kept in tracked changes/comments (add them to your dictionary): Private Person",
    "document properties: creator and last-modified-by cleared",
    "people.xml: reviewer account identifiers removed",
    "unexpected sensitive content",
  ]);
  assert.deepEqual(result, [
    ["docxImages", 2],
    ["docxObjects", 3],
    ["docxFields", 1],
    ["docxTracked"],
    ["docxMailReplaced", 1],
    ["docxMailKept", 1],
    ["docxReviewers", 1],
    ["docxCleaned"],
    ["docxGeneral"],
  ]);
  assert(!JSON.stringify(result).includes("private@example.com"));
});
test("CLI warns in selected language before any output or mapping and requires explicit override", () => {
  mkdirSync(".artifacts", { recursive: true });
  const dir = mkdtempSync(".artifacts/warning-cli-"),
    out = dir + "/out.docx",
    map = dir + "/map.json";
  const args = [
    "cli/scrub.js",
    "test/fixtures/contract.docx",
    "--out",
    out,
    "--mapping",
    map,
    "--language",
    "tr",
  ];
  const denied = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(denied.status, 1);
  assert(!existsSync(out));
  assert(!existsSync(map));
  const locale = JSON.parse(readFileSync("locales/tr.json"));
  assert(denied.stderr.includes(locale.docxImages.replace("$1", "2")));
  assert(denied.stderr.includes("--save-anyway"));
  assert(!denied.stderr.includes("Reviewer"));
  const approved = spawnSync(process.execPath, [...args, "--save-anyway"], {
    encoding: "utf8",
  });
  assert.equal(approved.status, 0);
  assert(existsSync(out));
  assert(existsSync(map));
});

test("numeric retained mail diagnostics preserve counts without showing targets", () => {
  assert.deepEqual(
    docxWarnings([
      "3 mailto: hyperlink targets kept (unrecognised addresses; inspect before sharing)",
    ]),
    [["docxMailKept", 3]],
  );
});
