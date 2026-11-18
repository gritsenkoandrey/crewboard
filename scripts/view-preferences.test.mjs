import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("../src/viewPreferences.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { loadViewPreferences, saveViewPreferences } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
const defaults = { filtersOpen: false, scrollTop: 0, scrollLeft: 0, descriptionSize: null, releaseId: null };

function withStorage(run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try { run(values, storage); }
  finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
}

test("missing, malformed and incompatible preferences fall back without blocking the board", () => withStorage((values) => {
  assert.deepEqual(loadViewPreferences("project"), defaults);
  saveViewPreferences("project", { filtersOpen: true });
  const key = [...values.keys()][0];
  for (const invalid of ["{", "null", "false", '"text"', "[]"]) {
    values.set(key, invalid);
    assert.deepEqual(loadViewPreferences("project"), defaults);
  }
  values.set(key, JSON.stringify({ filtersOpen: "true", scrollTop: -1, scrollLeft: "40", descriptionSize: 101 }));
  assert.deepEqual(loadViewPreferences("project"), defaults);
}));

test("independent updates preserve the latest scroll, filter disclosure and description size", () => withStorage(() => {
  saveViewPreferences("project", { filtersOpen: true, scrollTop: 310 });
  saveViewPreferences("project", { descriptionSize: 65 });
  saveViewPreferences("project", { scrollTop: 500.5, scrollLeft: 72 });
  assert.deepEqual(loadViewPreferences("project"), { ...defaults, filtersOpen: true, scrollTop: 500.5, scrollLeft: 72, descriptionSize: 65 });
  saveViewPreferences("project", { filtersOpen: false });
  saveViewPreferences("project", { descriptionSize: null });
  assert.deepEqual(loadViewPreferences("project"), { ...defaults, scrollTop: 500.5, scrollLeft: 72 });
}));

test("projects and data folders with identical project IDs retain separate views", () => withStorage(() => {
  const first = "D:/DataA/projects/task-track";
  const second = "D:/DataB/projects/task-track";
  saveViewPreferences(first, { filtersOpen: true, scrollTop: 600, descriptionSize: 70, releaseId: "release-a" });
  saveViewPreferences(second, { scrollLeft: 45, descriptionSize: 30 });
  saveViewPreferences(first, { scrollTop: 620 });
  assert.deepEqual(loadViewPreferences(first), { ...defaults, filtersOpen: true, scrollTop: 620, descriptionSize: 70, releaseId: "release-a" });
  assert.deepEqual(loadViewPreferences(second), { ...defaults, scrollLeft: 45, descriptionSize: 30 });
  assert.deepEqual(loadViewPreferences("D:/DataA/projects/another"), defaults);
  saveViewPreferences(first, { releaseId: null });
  assert.equal(loadViewPreferences(first).releaseId, null);
}));

test("description-size endpoints and reset to automatic layout survive saving", () => withStorage(() => {
  for (const descriptionSize of [0, 100, 42.75, null]) {
    saveViewPreferences("project", { descriptionSize });
    assert.equal(loadViewPreferences("project").descriptionSize, descriptionSize);
  }
  for (const descriptionSize of [-1, 101, NaN, Infinity]) {
    saveViewPreferences("project", { descriptionSize });
    assert.equal(loadViewPreferences("project").descriptionSize, null);
  }
}));

test("unavailable or full local storage does not throw into task editing", () => withStorage((_values, storage) => {
  storage.getItem = () => { throw new Error("Storage unavailable"); };
  assert.deepEqual(loadViewPreferences("project"), defaults);
  storage.setItem = () => { throw new Error("Quota exceeded"); };
  assert.doesNotThrow(() => saveViewPreferences("project", { filtersOpen: true }));
}));
