import assert from "node:assert/strict";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { browser, bridge } from "./browser.mjs";
import { serve } from "./server.mjs";
const server = await serve(),
  b = await browser();
const results = [];
const documentParts = unzipSync(await readFile("test/fixtures/contract.docx"));
documentParts["word/charts/_rels/chart1.xml.rels"] = strToU8(
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="chart" Target="mailto:chart@example.com"/></Relationships>',
);
const documentBytes = Array.from(zipSync(documentParts));
await mkdir("qa/screens", { recursive: true });
try {
  for (const file of (await readdir("locales")).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_"),
  )) {
    const lang = file.slice(0, -5),
      dict = JSON.parse(await readFile("locales/" + file, "utf8"));
    for (const width of [480, 800]) {
      const page = await b.newPage({ viewport: { width, height: 720 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await bridge(page);
      await page.addInitScript((code) => {
        qa.settings.language = code;
      }, lang);
      await page.goto(server.url);
      await page.waitForFunction(() => window.qa.action);
      for (const view of [
        "scrub",
        "restore",
        "dictionary",
        "documents",
        "settings",
      ]) {
        await page.locator("#tab-" + view).click();
        if (view === "scrub") {
          await page.locator("#input").fill("alex@example.com +44 7700 900123");
          await page.locator("#run").click();
        }
        if (view === "documents") {
          await page.evaluate((bytes) => {
            qa.file = { name: "contract.docx", bytes };
          }, documentBytes);
          await page.locator("#choose-document").click();
          await page.locator("#document-scrub").click();
          await page.waitForFunction(
            () => !document.querySelector("#document-warnings").hidden,
          );
          assert(
            (await page.locator("#document-warnings").textContent()).includes(
              dict.docxImages.replace("$1", "2"),
            ),
          );
          assert(
            (await page.locator("#document-warnings").textContent()).includes(
              dict.docxRelationships.replace("$1", "1"),
            ),
          );
          await page.locator("#copy").click();
          assert.equal(
            await page.locator("#document-save-anyway").textContent(),
            dict.saveAnyway,
          );
          await page.locator("#document-cancel").click();
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false, `${lang}/${width}/${view}: overflow`);
        assert.equal(
          await page.locator("#tab-" + view).textContent(),
          dict["tab" + view[0].toUpperCase() + view.slice(1)],
        );
        results.push({ lang, width, view, overflow });
        if (width === 800 && ["en", "de", "ar"].includes(lang)) {
          for (const mode of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme: mode });
            await page.screenshot({
              path: `qa/screens/${lang}-${view}-${mode}.png`,
              fullPage: true,
            });
          }
        }
      }
      assert.deepEqual(errors, [], lang);
      await page.close();
    }
  }
  await writeFile(
    "qa/i18n-layout.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    `${results.length} localized views passed at 480/800 pixels; 30 screenshots saved.`,
  );
} finally {
  await b.close();
  server.close();
}
