import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate, toCustomId } from "../dist/template.js";

test("interpolate replaces {content}", () => {
  assert.equal(
    interpolate("Summarize: {content}", { content: "hello", filename: "a.txt", index: 0 }),
    "Summarize: hello",
  );
});

test("interpolate replaces all three variables", () => {
  const out = interpolate("{index}:{filename}:{content}", {
    content: "body",
    filename: "doc.md",
    index: 3,
  });
  assert.equal(out, "3:doc.md:body");
});

test("interpolate replaces multiple occurrences of {content}", () => {
  const out = interpolate("{content} and again {content}", {
    content: "x",
    filename: "f",
    index: 0,
  });
  assert.equal(out, "x and again x");
});

test("interpolate leaves unknown tokens untouched", () => {
  const out = interpolate("{content} {unknown}", {
    content: "hi",
    filename: "f",
    index: 0,
  });
  assert.equal(out, "hi {unknown}");
});

test("toCustomId produces API-safe ids", () => {
  assert.equal(toCustomId(0, "review1.txt"), "0_review1_txt");
  assert.equal(toCustomId(2, "my report.md"), "2_my_report_md");
});

test("toCustomId only allows [a-zA-Z0-9_-]", () => {
  const id = toCustomId(1, "wéird näme!@#.txt");
  assert.match(id, /^[a-zA-Z0-9_-]+$/);
});

test("toCustomId truncates to 64 chars", () => {
  const long = "a".repeat(200) + ".txt";
  const id = toCustomId(5, long);
  assert.ok(id.length <= 64, `expected <=64, got ${id.length}`);
});
