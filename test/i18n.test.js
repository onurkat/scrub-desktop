import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLocales } from "../tools/locales.js";
test("all 34 locales have exactly the used keys, substitutions and correct direction", async () => {
  const result = await checkLocales();
  assert.equal(result.locales, 34);
  assert.ok(result.keys > 70);
});
