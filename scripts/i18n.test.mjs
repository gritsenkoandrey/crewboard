import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Load the real TypeScript modules without introducing a separate test framework or build output.
function compile(file) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function moduleUrl(source) { return "data:text/javascript;base64," + Buffer.from(source).toString("base64"); }
const catalogUrl = moduleUrl(compile("../src/locales.ts"));
const { ru } = await import(catalogUrl);
const source = compile("../src/i18n.ts")
  .replace('"./locales"', JSON.stringify(catalogUrl))
  .replace('"react"', JSON.stringify(import.meta.resolve("react")));
const { resolveLanguage, translate, formatTaskCount, setLanguage, getLanguage } = await import(moduleUrl(source));

test("stored preference takes precedence and unsupported languages fall back safely", () => {
  assert.equal(resolveLanguage("en", "ru-RU"), "en");
  assert.equal(resolveLanguage("ru", "en-US"), "ru");
  assert.equal(resolveLanguage(null, "ru-RU"), "ru");
  assert.equal(resolveLanguage(null, "en-GB"), "en");
  assert.equal(resolveLanguage("de", "fr-FR"), "en");
});

test("all messages preserve the same interpolation values in both languages", () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [en, translated] of Object.entries(ru)) {
    assert.ok(translated.trim(), en);
    assert.deepEqual(placeholders(en), placeholders(translated), en);
  }
  assert.equal(translate("Create “{name}”", { name: "План $& {draft}" }, "en"), "Create “План $& {draft}”");
  assert.equal(translate("Create “{name}”", { name: "План $& {draft}" }, "ru"), "Создать «План $& {draft}»");
});

test("task counts use English and Russian plural rules", () => {
  for (const [n, expected] of [[0,"0 задач"],[1,"1 задача"],[2,"2 задачи"],[5,"5 задач"],[11,"11 задач"],[21,"21 задача"],[22,"22 задачи"],[25,"25 задач"]]) {
    assert.equal(formatTaskCount(n, "ru"), expected);
  }
  assert.equal(formatTaskCount(1, "en"), "1 task");
  assert.equal(formatTaskCount(2, "en"), "2 tasks");
  assert.equal(formatTaskCount(21, "en"), "21 tasks");
});

test("language updates are persisted and storage failures do not block switching", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const writes = new Map();
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (key, value) => writes.set(key, value) } });
    setLanguage("ru");
    assert.equal(getLanguage(), "ru");
    assert.equal(writes.get("tasktrack-language"), "ru");
    assert.equal(translate("Participants"), "Исполнители");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { throw new Error("Storage unavailable"); } } });
    setLanguage("en");
    assert.equal(getLanguage(), "en");
    assert.equal(translate("Participants"), "Participants");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});
