import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("../src/taskSearch.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { searchTasks } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
const entry = (number, title, column = "todo", archived = false) => ({ task: { id: String(number), number, title, archived }, code: `TT-${number}`, column, status: column });
const tasks = [
  entry(120, "Сортировка: старая версия", "done", true),
  entry(112, "Задача с похожим номером", "done"),
  entry(12, "Автоматическая сортировка задач", "inProgress"),
  entry(2, "Поиск по названию"),
  entry(3, "Отчёты по проектам", "done"),
];
const numbers = (matches) => matches.map(({ task }) => task.number);

test("exact task code is first, case and pasted dash variants are accepted", () => {
  assert.deepEqual(numbers(searchTasks(tasks, "tt-12")), [12, 120]);
  assert.deepEqual(numbers(searchTasks(tasks, " TT–12 ")), [12, 120]);
  assert.deepEqual(numbers(searchTasks(tasks, "12")), [12, 112, 120]);
});

test("title fragments and multiple words find tasks across all statuses and the archive", () => {
  assert.deepEqual(numbers(searchTasks(tasks, "сортиров")), [120, 12]);
  assert.deepEqual(numbers(searchTasks(tasks, "авто задач")), [12]);
  assert.deepEqual(numbers(searchTasks(tasks, "старая")), [120]);
  assert.equal(searchTasks(tasks, "старая")[0].task.archived, true);
});

test("Russian ё and whitespace differences do not prevent matching", () => {
  assert.deepEqual(numbers(searchTasks(tasks, " ОТЧЕТЫ   проектам ")), [3]);
  assert.deepEqual(numbers(searchTasks(tasks, "TT-12\nавтоматическая")), [12]);
});

test("empty queries are ordered numerically and unrelated queries return no results", () => {
  assert.deepEqual(numbers(searchTasks(tasks, "  ")), [2, 3, 12, 112, 120]);
  assert.deepEqual(searchTasks(tasks, "неизвестная задача"), []);
  assert.deepEqual(searchTasks([], "TT-12"), []);
});

test("ranking does not mutate board order, task content or object identity", () => {
  const frozen = Object.freeze(tasks.map((item) => Object.freeze({ ...item, task: Object.freeze({ ...item.task }) })));
  const originalOrder = numbers(frozen);
  const result = searchTasks(frozen, "tt-12");
  assert.deepEqual(numbers(frozen), originalOrder);
  assert.strictEqual(result[0], frozen[2]);
  assert.strictEqual(result[1], frozen[0]);
});
