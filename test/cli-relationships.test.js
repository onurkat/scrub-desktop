import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
test("CLI localizes uninspected-owner warning and removes chart mail address", () => {
  mkdirSync(".artifacts", { recursive: true });
  const dir = mkdtempSync(".artifacts/cli-rels-");
  const parts = unzipSync(readFileSync("test/fixtures/contract.docx"));
  const name = "word/charts/_rels/chart1.xml.rels";
  parts[name] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="a" Target="mailto:chart.private@example.com?subject=private%20subject"/></Relationships>',
  );
  writeFileSync(dir + "/in.docx", zipSync(parts));
  const result = spawnSync(
    process.execPath,
    [
      "cli/scrub.js",
      dir + "/in.docx",
      "--out",
      dir + "/out.docx",
      "--language",
      "tr",
      "--save-anyway",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const locale = JSON.parse(readFileSync("locales/tr.json"));
  assert(result.stderr.includes(locale.docxRelationships.replace("$1", "1")));
  assert(!result.stderr.includes("chart.private"));
  assert(!result.stderr.includes("private subject"));
  const xml = strFromU8(unzipSync(readFileSync(dir + "/out.docx"))[name]);
  assert(!xml.includes("chart.private"));
  assert(!xml.includes("subject="));
});
