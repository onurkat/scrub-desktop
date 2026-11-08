import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { browser, bridge } from "./browser.mjs";
import { serve } from "./server.mjs";
const server = await serve(),
  b = await browser();
try {
  const page = await b.newPage();
  await bridge(page);
  await page.goto(server.url);
  await page.waitForFunction(() => qa.action);
  const source = Array.from(await readFile("test/fixtures/contract.docx"));
  await page.evaluate((bytes) => {
    qa.file = { name: "contract.docx", bytes };
  }, source);
  await page.locator("#tab-documents").click();
  await page.locator("#choose-document").click();
  await page.locator("#document-scrub").click();
  await page.waitForFunction(
    () => document.querySelector("#review").parentElement.id === "documents",
  );
  await page.locator("#copy").click();
  await page.waitForFunction(() => qa.saved);
  const processed = await page.evaluate(() => qa.saved.bytes);
  assert.notDeepEqual(processed, source);
  await page.locator("#mapping-save").click();
  const mapping = await page.evaluate(() => qa.saved.bytes);
  assert.equal(
    JSON.parse(new TextDecoder().decode(new Uint8Array(mapping))).version,
    1,
  );
  await page.evaluate((bytes) => {
    qa.file = { name: "mapping.json", bytes };
  }, mapping);
  await page.locator("#choose-mapping").click();
  await page.evaluate((bytes) => {
    qa.file = { name: "processed.docx", bytes };
  }, processed);
  await page.locator("#choose-document").click();
  await page.locator("#document-restore").click();
  await page.locator("#document-save").waitFor({ state: "visible" });
  await page.locator("#document-save").click();
  const restored = await page.evaluate(() => qa.saved.bytes);
  const text = (bytes) =>
    strFromU8(unzipSync(new Uint8Array(bytes))["word/document.xml"]).replace(
      /<[^>]*>/g,
      "",
    );
  assert.equal(text(restored), text(source));
  await page.locator("#tab-dictionary").click();
  await page.evaluate(() => {
    qa.file = {
      name: "dictionary.csv",
      bytes: Array.from(
        new TextEncoder().encode(
          "term,category,aliases\nNorthstar,ORG,NS|Northern Star\n",
        ),
      ),
    };
  });
  await page.locator("#import-csv").click();
  await page.waitForFunction(() => qa.settings.dictionary.length === 1);
  await page.locator("#dictionary-list button").first().click();
  await page.locator("#term").fill("Northstar Labs");
  await page.locator("#dictionary-form button[type=submit]").click();
  await page.locator("#export-csv").click();
  const csv = await page.evaluate(() =>
    new TextDecoder().decode(new Uint8Array(qa.saved.bytes)),
  );
  assert.match(csv, /Northstar Labs/);
  assert.match(csv, /NS\|Northern Star/);
  console.log(
    "Document UI saves DOCX and mapping, restores original document text; dictionary CSV import, inline edit and export pass.",
  );
} finally {
  await b.close();
  server.close();
}
