import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubText } from "../engine/scrub.js";
import {
  emptyStore,
  commitMapping,
  currentMapping,
  bestRestore,
  validateStore,
} from "../ui/js/conversations.js";
const time = "2026-01-01T00:00:00Z";
test("continued conversation retains placeholders; a fresh one starts at one", () => {
  const first = scrubText("a@example.com");
  let store = commitMapping(emptyStore(), first.mapping, "one", time);
  const second = scrubText("b@example.com a@example.com", {
    mapping: currentMapping(store),
  });
  assert.equal(second.output, "[EMAIL_2] [EMAIL_1]");
  store = commitMapping(store, second.mapping, "unused", time);
  assert.equal(store.recent.length, 1);
  assert.equal(
    bestRestore("[EMAIL_2] [EMAIL_1] [EMAIL_2]", store).output,
    "b@example.com a@example.com b@example.com",
  );
  store = { ...store, current: null };
  assert.equal(
    scrubText("b@example.com", { mapping: currentMapping(store) }).output,
    "[EMAIL_1]",
  );
});
test("restore chooses complete recent mapping over partial current and preserves unknown tokens", () => {
  const one = scrubText("a@example.com b@example.com");
  let store = commitMapping(emptyStore(), one.mapping, "one", time);
  store = commitMapping(
    { ...store, current: null },
    scrubText("c@example.com").mapping,
    "two",
    time,
  );
  assert.equal(bestRestore("[EMAIL_1]", store).output, "c@example.com");
  assert.equal(
    bestRestore("[EMAIL_2] [EMAIL_1]", store).output,
    "b@example.com a@example.com",
  );
  assert.deepEqual(bestRestore("[EMAIL_2] [EMAIL_99]", store).unknown, [
    "[EMAIL_99]",
  ]);
  assert.equal(bestRestore("plain text", store).hasTokens, false);
});
test("bounded history and malformed store validation", () => {
  let store = emptyStore();
  for (let i = 0; i < 12; i++)
    store = commitMapping(
      { ...store, current: null },
      scrubText(`a${i}@example.com`).mapping,
      String(i),
      time,
    );
  assert.equal(store.recent.length, 10);
  assert.equal(store.current, "11");
  assert.throws(() => validateStore({ ...store, current: "missing" }));
  assert.throws(() =>
    validateStore({ ...store, recent: [store.recent[0], store.recent[0]] }),
  );
});
