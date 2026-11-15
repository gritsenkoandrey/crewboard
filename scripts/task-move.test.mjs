import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

async function load(file) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
}
const { recordTaskMove, undoTaskMove } = await load("../src/taskMove.ts");
const { stampBoard } = await load("../src/taskMetadata.ts");
const board = () => ({ taskPrefix: "TT", nextTaskNumber: 3, labels: [], todo: [{ id: "a", number: 1, title: "First", updatedAt: 123 }], inProgress: [{ id: "b", number: 2, title: "Other", updatedAt: 123 }], done: [] });
function move(before, id, from, to) {
  const task = before[from].find((task) => task.id === id);
  return { ...before, [from]: before[from].filter((task) => task.id !== id), [to]: [...before[to], task] };
}

test("undo changes only status and preserves subsequent edits and unrelated tasks", () => {
  const before = board();
  const moved = move(before, "a", "todo", "inProgress");
  const action = recordTaskMove(before, moved, "a");
  const edited = { ...moved.inProgress.find((task) => task.id === "a"), title: "Edited after moving", description: "Keep this", acceptanceCriteria: "Keep criteria", labels: ["new"], assigneeId: "human", updatedAt: 222, reports: [{ text: "Keep report" }] };
  const fresh = { ...moved, nextTaskNumber: 10, labels: [{ id: "new", name: "New", color: "blue" }], inProgress: [moved.inProgress[0], edited] };
  const result = undoTaskMove(fresh, action);
  assert.strictEqual(result.todo[0], edited);
  assert.strictEqual(result.inProgress[0], fresh.inProgress[0]);
  assert.strictEqual(result.labels, fresh.labels);
  assert.equal(result.nextTaskNumber, 10);
  assert.equal(fresh.todo.length, 0);
  assert.equal(fresh.inProgress.length, 2);
  const stamped = stampBoard(fresh, result, 333);
  assert.equal(stamped.todo[0].updatedAt, 333);
  assert.equal(stamped.inProgress[0].updatedAt, 123);
  assert.equal(stamped.todo[0].number, 1);
});

test("same-column drops and cancelled moves create no undo action", () => {
  const before = board();
  assert.equal(recordTaskMove(before, before, "a"), null);
  assert.equal(recordTaskMove(before, { ...before, todo: [] }, "a"), null);
  assert.equal(recordTaskMove(before, before, "missing"), null);
});

test("deleted, archived or subsequently moved tasks cannot be returned using a stale action", () => {
  const before = board();
  const moved = move(before, "a", "todo", "inProgress");
  const action = recordTaskMove(before, moved, "a");
  assert.equal(undoTaskMove({ ...moved, inProgress: moved.inProgress.filter((task) => task.id !== "a") }, action), null);
  assert.equal(undoTaskMove(move(moved, "a", "inProgress", "done"), action), null);
  assert.equal(undoTaskMove({ ...moved, inProgress: moved.inProgress.map((task) => ({ ...task, archived: true })) }, action), null);
});

test("a new agent session, report submission or question invalidates the old undo action", () => {
  const before = board();
  const moved = move(before, "a", "todo", "inProgress");
  const action = recordTaskMove(before, moved, "a");
  for (const patch of [
    { claim: { assigneeId: "agent", sessionId: "new", startedAt: 500, token: "test-token" } },
    { readyForReview: true },
    { question: "New question" },
  ]) {
    const fresh = { ...moved, inProgress: moved.inProgress.map((task) => task.id === "a" ? { ...task, ...patch } : task) };
    assert.equal(undoTaskMove(fresh, action), null);
  }
});

test("undoing Done never revives the agent session cleared by the backend", () => {
  const before = board();
  before.inProgress[0] = { ...before.inProgress[0], claim: { assigneeId: "agent", sessionId: "old", startedAt: 10, token: "test-token" }, readyForReview: true, question: "Old question", reports: [{ text: "Preserve report" }] };
  const moved = move(before, "b", "inProgress", "done");
  const action = recordTaskMove(before, moved, "b");
  const completed = { ...moved.done[0], claim: undefined, readyForReview: false, question: undefined };
  const restored = undoTaskMove({ ...moved, done: [completed] }, action);
  assert.strictEqual(restored.inProgress[0], completed);
  assert.equal(restored.inProgress[0].claim, undefined);
  assert.equal(restored.inProgress[0].readyForReview, false);
  assert.deepEqual(restored.inProgress[0].reports, [{ text: "Preserve report" }]);
  assert.ok(!JSON.stringify(action).includes("test-token"));
});

test("undoing the last of two moves leaves the earlier move intact", () => {
  const before = board();
  const first = move(before, "a", "todo", "inProgress");
  const second = move(first, "b", "inProgress", "todo");
  const lastAction = recordTaskMove(first, second, "b");
  const restored = undoTaskMove(second, lastAction);
  assert.deepEqual(restored.todo, []);
  assert.deepEqual(restored.inProgress.map((task) => task.id), ["a", "b"]);
});
