import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "@/lib/repositories/tasks";
import { requireAllOwned, requireOwned } from "@/lib/authz";
import {
  makeGoal,
  makeNote,
  makeProject,
  makeTag,
  makeTask,
  makeTwoUsers,
  resetDatabase,
} from "./helpers/factories";
import { taskQuerySchema } from "@/lib/validation/task";

/**
 * Cross-user isolation.
 *
 * This is the suite that has to be exhaustive. A gap here is a data breach, not
 * a bug, so each test asserts on a concrete attack rather than on a happy path.
 */

const defaultQuery = taskQuerySchema.parse({});

/** Asserts the promise rejects with the given HTTP status from an AppError. */
async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toThrow(AppError);
  await promise.catch((error: unknown) => {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(status);
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("direct cross-user access", () => {
  it("cannot read another user's task", async () => {
    const { alice, bob } = await makeTwoUsers();
    const task = await makeTask(alice.id, { title: "Alice private" });

    await expectStatus(getTask(bob.id, task.id), 404);
  });

  it("cannot update another user's task", async () => {
    const { alice, bob } = await makeTwoUsers();
    const task = await makeTask(alice.id);

    await expectStatus(updateTask(bob.id, task.id, { title: "hijacked" }), 404);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.title).not.toBe("hijacked");
  });

  it("cannot delete another user's task", async () => {
    const { alice, bob } = await makeTwoUsers();
    const task = await makeTask(alice.id);

    await expectStatus(deleteTask(bob.id, task.id), 404);
    expect(await db.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("reports a foreign resource as 404, never 403", async () => {
    // 403 would confirm the id exists and turn list endpoints into an
    // enumeration oracle.
    const { alice, bob } = await makeTwoUsers();
    const task = await makeTask(alice.id);

    // Asserting only inside .catch() would make this test pass vacuously if the
    // call ever succeeded — the callback simply would not run. Assert that it
    // rejects first, then inspect the error.
    const error = await getTask(bob.id, task.id).then(
      () => {
        throw new Error("expected getTask to reject for a foreign task");
      },
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(404);
    expect((error as AppError).code).toBe("NOT_FOUND");
    expect((error as AppError).message).not.toContain(task.id);
  });
});

describe("list endpoints", () => {
  it("never returns another user's rows", async () => {
    const { alice, bob } = await makeTwoUsers();
    await makeTask(alice.id, { title: "alice one" });
    await makeTask(alice.id, { title: "alice two" });
    await makeTask(bob.id, { title: "bob one" });

    const forBob = await listTasks(bob.id, defaultQuery);
    expect(forBob.items).toHaveLength(1);
    expect(forBob.items[0]!.title).toBe("bob one");

    const forAlice = await listTasks(alice.id, defaultQuery);
    expect(forAlice.items.map((t) => t.title).sort()).toEqual(["alice one", "alice two"]);
  });

  it("cannot filter into another user's project", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceProject = await makeProject(alice.id, "Alice project");
    await makeTask(alice.id, { title: "secret", projectId: aliceProject.id });

    const result = await listTasks(bob.id, { ...defaultQuery, projectId: aliceProject.id });
    expect(result.items).toHaveLength(0);
  });

  it("cannot filter by another user's tag", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceTag = await makeTag(alice.id, "confidential");
    const task = await makeTask(alice.id);
    await db.taskTag.create({ data: { taskId: task.id, tagId: aliceTag.id } });

    const result = await listTasks(bob.id, { ...defaultQuery, tagId: aliceTag.id });
    expect(result.items).toHaveLength(0);
  });
});

describe("foreign-key hijacking", () => {
  /**
   * The vulnerability that motivated src/lib/authz.ts: scoping only the
   * top-level where clause leaves relation ids unchecked, so a request can
   * attach another user's row to its own.
   */
  it("cannot attach another user's project to an owned task on create", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceProject = await makeProject(alice.id, "Alice project");

    await expectStatus(
      createTask(bob.id, {
        title: "bob task",
        status: "TODO",
        priority: "MEDIUM",
        tagIds: [],
        projectId: aliceProject.id,
      }),
      404,
    );

    expect(await db.task.count({ where: { projectId: aliceProject.id } })).toBe(0);
  });

  it("cannot attach another user's project to an owned task on update", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceProject = await makeProject(alice.id);
    const bobTask = await makeTask(bob.id);

    await expectStatus(updateTask(bob.id, bobTask.id, { projectId: aliceProject.id }), 404);

    const after = await db.task.findUniqueOrThrow({ where: { id: bobTask.id } });
    expect(after.projectId).toBeNull();
  });

  it("cannot apply another user's tag to an owned task", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceTag = await makeTag(alice.id, "alice-tag");
    const bobTask = await makeTask(bob.id);

    await expectStatus(updateTask(bob.id, bobTask.id, { tagIds: [aliceTag.id] }), 404);
    expect(await db.taskTag.count({ where: { tagId: aliceTag.id } })).toBe(0);
  });

  it("cannot nest an owned task under another user's task", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceTask = await makeTask(alice.id);

    await expectStatus(
      createTask(bob.id, {
        title: "child",
        status: "TODO",
        priority: "MEDIUM",
        tagIds: [],
        parentId: aliceTask.id,
      }),
      404,
    );
  });

  it("rejects a batch where only some ids belong to the caller", async () => {
    // A partial check that passed when *any* id matched would let one foreign
    // id ride along with several valid ones.
    const { alice, bob } = await makeTwoUsers();
    const bobTag = await makeTag(bob.id, "bob-tag");
    const aliceTag = await makeTag(alice.id, "alice-tag");

    await expectStatus(requireAllOwned("tag", [bobTag.id, aliceTag.id], bob.id), 404);
    await expect(requireAllOwned("tag", [bobTag.id], bob.id)).resolves.toBeUndefined();
  });
});

describe("requireOwned", () => {
  it("passes for owned rows and rejects foreign and non-existent ones", async () => {
    const { alice, bob } = await makeTwoUsers();
    const note = await makeNote(alice.id);
    const goal = await makeGoal(alice.id);

    await expect(requireOwned("note", note.id, alice.id)).resolves.toBeUndefined();
    await expect(requireOwned("goal", goal.id, alice.id)).resolves.toBeUndefined();

    await expectStatus(requireOwned("note", note.id, bob.id), 404);
    await expectStatus(requireOwned("goal", goal.id, bob.id), 404);
    await expectStatus(requireOwned("note", "does-not-exist", alice.id), 404);
  });
});

describe("account deletion", () => {
  it("removes only the deleted user's data", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceProject = await makeProject(alice.id);
    await makeTask(alice.id, { projectId: aliceProject.id });
    await makeNote(alice.id);
    await makeTag(alice.id);

    const bobTask = await makeTask(bob.id, { title: "bob keeps this" });
    const bobNote = await makeNote(bob.id, "bob note");

    await db.user.delete({ where: { id: alice.id } });

    expect(await db.task.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.project.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.note.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.tag.count({ where: { userId: alice.id } })).toBe(0);

    expect(await db.task.count({ where: { id: bobTask.id } })).toBe(1);
    expect(await db.note.count({ where: { id: bobNote.id } })).toBe(1);
    expect(await db.user.count({ where: { id: bob.id } })).toBe(1);
  });
});
