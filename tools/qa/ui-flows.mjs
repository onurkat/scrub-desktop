import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { browser, bridge } from "./browser.mjs";
const root = resolve("ui");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." + decodeURIComponent(req.url === "/" ? "/index.html" : req.url),
    );
    if (!path.startsWith(root + "/")) throw Error();
    res.setHeader(
      "Content-Type",
      { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
        extname(path)
      ] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const b = await browser();
try {
  const page = await b.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await bridge(page);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.startsWith("Ready."),
  );
  await page.locator("#from-clipboard").click();
  await page.locator("#review").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#output").textContent(),
    "[EMAIL_1] [EMAIL_2]",
  );
  await page.locator(".match button").first().click();
  assert.equal(
    await page.locator("#output").textContent(),
    "a@example.com [EMAIL_1]",
  );
  await page.locator("#copy").click();
  assert.equal(
    await page.evaluate(() => qa.clipboard),
    "a@example.com [EMAIL_1]",
  );
  await page.evaluate(() => {
    qa.clipboard = "[EMAIL_1] [EMAIL_1] [EMAIL_99]";
  });
  await page.locator("#tab-restore").click();
  await page.locator("#restore-clipboard").click();
  assert.equal(
    await page.evaluate(() => qa.clipboard),
    "b@example.com b@example.com [EMAIL_99]",
  );
  assert.match(await page.locator("#unknown").textContent(), /EMAIL_99/);
  await page.locator("#tab-dictionary").click();
  await page.locator("#term").fill("Northstar");
  await page.locator("#aliases").fill("NS");
  await page.locator("#aliases").press("Enter");
  await page.locator("#dictionary-form button[type=submit]").click();
  await page.locator("#tab-scrub").click();
  await page.locator("#input").fill("NS and Northstar");
  await page.locator("#run").click();
  assert.equal(
    await page.locator("#output").textContent(),
    "[PERSON_1] and [PERSON_1]",
  );
  await page.locator("#tab-settings").click();
  assert.equal(
    await page.locator("#detectors input").last().isChecked(),
    false,
  );
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  for (const view of [
    "scrub",
    "restore",
    "dictionary",
    "documents",
    "settings",
  ]) {
    await page.locator("#tab-" + view).click();
    const violations = await page.evaluate(async () =>
      (await axe.run()).violations.filter((v) =>
        ["serious", "critical"].includes(v.impact),
      ),
    );
    assert.deepEqual(
      violations.map((v) => v.id),
      [],
      view,
    );
  }
  for (const [clipboard, error, notice] of [
    ["", false, "Nothing to scrub"],
    ["", true, "Nothing to scrub"],
    ["ordinary sentence", false, "No sensitive details"],
  ]) {
    await page.evaluate(
      async ({ clipboard, error }) => {
        qa.clipboard = clipboard;
        qa.clipboardError = error;
        qa.hidden = false;
        await qa.action({ payload: "scrub" });
      },
      { clipboard, error },
    );
    assert.equal(await page.evaluate(() => qa.clipboard), clipboard);
    assert.match(
      await page.evaluate(() => qa.notifications.at(-1)),
      new RegExp(notice),
    );
    assert.equal(await page.evaluate(() => qa.hidden), true);
    assert.equal(await page.locator("#review").isVisible(), false);
  }
  await page.evaluate(async () => {
    qa.clipboardError = false;
    qa.settings.skipReview = true;
    qa.clipboard = "new@example.com";
    await qa.action({ payload: "scrub" });
  });
  assert.match(await page.evaluate(() => qa.clipboard), /^\[EMAIL_\d+\]$/);
  await page.evaluate(async () => {
    qa.settings.skipReview = false;
    qa.clipboard = "new@example.com next@example.com";
    await qa.action({ payload: "scrub" });
  });
  const continued = await page.locator("#output").textContent();
  assert.match(continued, /^\[EMAIL_2\] \[EMAIL_3\]$/);
  await page.locator("#new-conversation").click();
  assert.equal(
    await page.locator("#output").textContent(),
    "[EMAIL_1] [EMAIL_2]",
  );
  await mkdir("qa/screens", { recursive: true });
  for (const lang of ["en", "de", "ar"]) {
    const reviewPage = await b.newPage({
      viewport: { width: 560, height: 640 },
    });
    await bridge(reviewPage);
    await reviewPage.addInitScript((lang) => {
      qa.settings.language = lang;
      qa.clipboard = "alex@example.com +44 7700 900123\n".repeat(12);
    }, lang);
    await reviewPage.goto(`http://127.0.0.1:${server.address().port}`);
    await reviewPage.waitForFunction(() => qa.action);
    await reviewPage.evaluate(() => qa.action({ payload: "scrub" }));
    assert.equal(await reviewPage.locator("nav").isVisible(), false);
    assert.equal(await reviewPage.locator("#status").textContent(), "");
    const first = await reviewPage
      .locator(".match-group")
      .first()
      .boundingBox();
    const bar = await reviewPage.locator("#review-actions").boundingBox();
    const output = await reviewPage.locator("#output").boundingBox();
    assert(
      first.y >= 0 && first.y + first.height <= bar.y,
      `${lang}: first category hidden`,
    );
    assert(
      first.y < output.y && output.height <= 160,
      `${lang}: list/preview order or height`,
    );
    assert(
      bar.y >= 0 && bar.y + bar.height <= 640,
      `${lang}: actions outside viewport`,
    );
    for (const mode of ["light", "dark"]) {
      await reviewPage.emulateMedia({ colorScheme: mode });
      await reviewPage.screenshot({
        path: `qa/screens/${lang}-clipboard-review-${mode}.png`,
      });
    }
    await reviewPage.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight),
    );
    const after = await reviewPage.locator("#review-actions").boundingBox();
    assert.equal(after.y, bar.y, `${lang}: action bar moved`);
    await reviewPage.locator("#open-full").click();
    assert.equal(await reviewPage.locator("nav").isVisible(), true);
    await reviewPage.close();
  }
  const mac = await b.newPage();
  await bridge(mac);
  await mac.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { value: "MacIntel" }),
  );
  await mac.goto(`http://127.0.0.1:${server.address().port}`);
  await mac.waitForFunction(() => qa.action);
  await mac.locator("#tab-settings").click();
  assert.equal(await mac.locator("#scrub-shortcut").inputValue(), "⌃⌥S");
  assert.match(await mac.evaluate(() => qa.menuLabels.scrubClipboard), /⌃⌥S/);
  const welcome = await mac
    .locator("[data-i18n=welcomeClipboard]")
    .textContent();
  assert(welcome.includes("⌃⌥S") && welcome.includes("⌃⌥R"));
  await mac.locator("#save-shortcuts").click();
  assert.equal(
    await mac.evaluate(() => qa.settings.scrubShortcut),
    "Ctrl+Alt+S",
  );
  await mac.close();
  assert.deepEqual(errors, []);
  console.log(
    "Review, partial restore, dictionary aliases, detector defaults and settings axe pass.",
  );
} finally {
  await b.close();
  server.close();
}
