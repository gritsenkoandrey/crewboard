import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadModule(file) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
}
const { sortTasksByNumber, compareTaskNumbers } = await loadModule("../src/taskOrdering.ts");
const { stampBoard, setTaskArchived } = await loadModule("../src/taskMetadata.ts");
const task = (number) => ({ id: String(number), title: `Task ${number}`, number, updatedAt: 123 });
const numbers = (tasks) => tasks.map((task) => task.number);
const board = () => ({ taskPrefix: "TT", nextTaskNumber: 11, todo: [task(10), task(2)], inProgress: [task(1)], done: [] });

test("numeric display order ignores stored order without changing task content or dates", () => {
  const tasks = Object.freeze([Object.freeze(task(10)), Object.freeze(task(2)), Object.freeze(task(1))]);
  const sorted = sortTasksByNumber(tasks);
  assert.deepEqual(numbers(sorted), [1, 2, 10]);
  assert.deepEqual(numbers(tasks), [10, 2, 1]);
  assert.strictEqual(sorted[0], tasks[2]);
  assert.strictEqual(sorted[1], tasks[1]);
  assert.strictEqual(sorted[2], tasks[0]);
});

test("empty lists and pending tasks without assigned numbers keep a stable display order", () => {
  assert.deepEqual(sortTasksByNumber([]), []);
  const tasks = [{ id: "pending-a" }, task(10), { id: "pending-b" }, task(2)];
  assert.deepEqual(sortTasksByNumber(tasks).map((task) => task.id), ["2", "10", "pending-a", "pending-b"]);
});

test("new and moved tasks appear at their numeric position while retaining their assigned numbers", () => {
  const before = board();
  const created = stampBoard(before, { ...before, todo: [...before.todo, { id: "new", title: "New" }] }, 456);
  assert.deepEqual(numbers(sortTasksByNumber(created.todo)), [2, 10, 11]);
  assert.equal(created.nextTaskNumber, 12);

  const moving = created.todo.find((task) => task.number === 2);
  const moved = stampBoard(created, {
    ...created,
    todo: created.todo.filter((task) => task.id !== moving.id),
    inProgress: [...created.inProgress, moving],
  }, 789);
  assert.deepEqual(numbers(sortTasksByNumber(moved.inProgress)), [1, 2]);
  assert.equal(moved.inProgress.find((task) => task.id === moving.id).updatedAt, 789);
  assert.equal(moved.todo.find((task) => task.number === 10).updatedAt, 123);
  assert.equal(moved.nextTaskNumber, 12);
});

test("archive order spans statuses and restoring keeps a task at its numeric position", () => {
  let archived = board();
  for (const id of ["1", "2", "10"]) archived = setTaskArchived(archived, id, true);
  const entries = ["todo", "inProgress", "done"].flatMap((column) => archived[column].map((task) => ({ task, column })));
  entries.sort((a, b) => compareTaskNumbers(a.task, b.task));
  assert.deepEqual(entries.map(({ task }) => task.number), [1, 2, 10]);
  const restored = setTaskArchived(archived, "2", false);
  assert.deepEqual(numbers(sortTasksByNumber(restored.todo)), [2, 10]);
  assert.equal(restored.todo.find((task) => task.id === "2").archived, false);
  assert.equal(restored.todo.find((task) => task.id === "2").updatedAt, 123);
});
