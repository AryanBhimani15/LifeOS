import { db } from "@/lib/db";
import { requireOwned, type DbClient } from "@/lib/authz";
import { badRequest, confirmationRequired, notFound } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { assertSafeMinorUnits, toMinorUnits } from "@/lib/money";
import { parseCalendarDate } from "@/lib/dates";
import { resolveOrCreateCategory, resolveOrCreateTags } from "./resolver";
import { assertPlanUsable, type ResolvedAction } from "./planner";
import { planIsDestructive } from "./actions";

/**
 * Executes a previously planned, validated, resolved command.
 *
 * Three guarantees, all enforced here rather than by the client:
 *
 *  1. CONFIRMATION. A destructive plan cannot run without `confirmed: true`, so
 *     a client that skips the dialog — or a crafted request that never rendered
 *     one — is still refused. Destructiveness is recomputed from the stored
 *     actions, so a tampered `needsConfirm` column changes nothing.
 *
 *  2. EXACTLY ONCE. The plan is claimed with a conditional UPDATE inside the
 *     transaction, which takes a row lock. Two concurrent execute requests
 *     serialize: the second finds no PENDING row and is rejected instead of
 *     duplicating every action.
 *
 *  3. ALL OR NOTHING. Every action runs in that same transaction. A failure
 *     half-way rolls back the earlier actions, so a plan can never leave behind
 *     a partial result that a retry would then duplicate.
 *
 * Ownership is re-verified for every stored id even though the planner already
 * checked it: rows can be deleted or reassigned between planning and
 * confirmation, and a plan is not a capability grant.
 */

export interface ExecutionOutcome {
  executed: number;
  created: { type: string; id: string; label: string }[];
  notes: string[];
}

/** Interactive transactions default to 5s; a plan may perform many writes. */
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export async function executePlan(
  userId: string,
  planId: string,
  confirmed: boolean,
): Promise<ExecutionOutcome> {
  const plan = await db.aiCommandPlan.findFirst({
    where: { id: planId, userId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      needsConfirm: true,
      summary: true,
      actions: true,
    },
  });
  if (!plan) throw notFound("Plan");

  assertPlanUsable(plan);

  const actions = plan.actions as unknown as ResolvedAction[];
  const destructive = plan.needsConfirm || planIsDestructive(actions as never);

  if (destructive && !confirmed) {
    throw confirmationRequired({
      planId: plan.id,
      summary: plan.summary,
      destructiveActions: actions.filter((a) => a.type === "delete_task").map(describe),
    });
  }

  const outcome = await db.$transaction(async (tx) => {
    // Atomic claim. The conditional update locks the row, so a concurrent
    // execute blocks here and then matches zero rows once we commit.
    const claimed = await tx.aiCommandPlan.updateMany({
      where: { id: plan.id, userId, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "EXECUTED", executedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw badRequest("That plan has already been dealt with.");
    }

    const result: ExecutionOutcome = { executed: 0, created: [], notes: [] };
    for (const action of actions) {
      await runAction(tx, userId, action, result);
    }

    await tx.aiCommandPlan.update({
      where: { id: plan.id },
      data: { result: result as never },
    });

    return result;
  }, TRANSACTION_OPTIONS);

  await recordAudit({
    userId,
    action: "AI_EXECUTE",
    entityType: "AiCommandPlan",
    entityId: plan.id,
    summary: `Executed ${outcome.executed} action(s): ${plan.summary}`.slice(0, 200),
    metadata: { confirmed, destructive, created: outcome.created.length },
  });

  return outcome;
}

async function runAction(
  tx: DbClient,
  userId: string,
  action: ResolvedAction,
  outcome: ExecutionOutcome,
): Promise<void> {
  switch (action.type) {
    case "create_task": {
      if (action.projectId) await requireOwned("project", action.projectId, userId, tx);
      const tagIds = await resolveOrCreateTags(userId, action.tagNames ?? [], tx);

      const task = await tx.task.create({
        data: {
          userId,
          title: action.title,
          description: action.description ?? null,
          dueAt: action.dueAt ? new Date(action.dueAt) : null,
          priority: action.priority ?? "MEDIUM",
          projectId: action.projectId,
          tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
          subtasks: action.subtasks?.length
            ? {
                create: action.subtasks.map((title, index) => ({
                  userId,
                  title,
                  boardOrder: (index + 1) * 1024,
                })),
              }
            : undefined,
        },
        select: { id: true, title: true },
      });
      outcome.created.push({ type: "task", id: task.id, label: task.title });
      outcome.executed += 1;
      return;
    }

    case "update_task": {
      await requireOwned("task", action.taskId, userId, tx);
      if (action.projectId) await requireOwned("project", action.projectId, userId, tx);
      await tx.task.update({
        where: { id: action.taskId },
        data: {
          ...(action.title ? { title: action.title } : {}),
          ...(action.dueAt !== undefined
            ? { dueAt: action.dueAt ? new Date(action.dueAt) : null }
            : {}),
          ...(action.priority ? { priority: action.priority } : {}),
          ...(action.status ? { status: action.status } : {}),
          ...(action.status === "DONE" ? { completedAt: new Date() } : {}),
          ...(action.projectId ? { projectId: action.projectId } : {}),
        },
      });
      outcome.executed += 1;
      return;
    }

    case "complete_task": {
      await requireOwned("task", action.taskId, userId, tx);
      await tx.task.update({
        where: { id: action.taskId },
        data: { status: "DONE", completedAt: new Date() },
      });
      outcome.executed += 1;
      return;
    }

    case "delete_task": {
      await requireOwned("task", action.taskId, userId, tx);
      await tx.task.delete({ where: { id: action.taskId } });
      outcome.executed += 1;
      return;
    }

    case "create_project": {
      const project = await tx.project.create({
        data: {
          userId,
          name: action.name,
          description: action.description ?? null,
          priority: action.priority ?? "MEDIUM",
          dueDate: parseCalendarDate(action.dueDate),
          milestones: action.milestones?.length
            ? {
                create: action.milestones.map((m, index) => ({
                  title: m.title,
                  targetDate: parseCalendarDate(m.targetDate),
                  sortOrder: (index + 1) * 1024,
                })),
              }
            : undefined,
        },
        select: { id: true, name: true },
      });
      outcome.created.push({ type: "project", id: project.id, label: project.name });
      outcome.executed += 1;
      return;
    }

    case "create_goal": {
      const goal = await tx.goal.create({
        data: {
          userId,
          title: action.title,
          description: action.description ?? null,
          targetDate: parseCalendarDate(action.targetDate),
          milestones: action.milestones?.length
            ? {
                create: action.milestones.map((m, index) => ({
                  title: m.title,
                  targetDate: parseCalendarDate(m.targetDate),
                  sortOrder: (index + 1) * 1024,
                })),
              }
            : undefined,
        },
        select: { id: true, title: true },
      });
      outcome.created.push({ type: "goal", id: goal.id, label: goal.title });
      outcome.executed += 1;
      return;
    }

    case "create_event": {
      const startAt = new Date(action.startAt);
      const endAt = new Date(action.endAt);
      // The database CHECK would reject this anyway; failing here gives a
      // message the user can act on instead of a constraint violation.
      if (endAt < startAt) throw badRequest("An event cannot end before it starts.");

      const event = await tx.event.create({
        data: {
          userId,
          title: action.title,
          startAt,
          endAt,
          location: action.location ?? null,
          allDay: action.allDay ?? false,
        },
        select: { id: true, title: true },
      });
      outcome.created.push({ type: "event", id: event.id, label: event.title });
      outcome.executed += 1;
      return;
    }

    case "complete_habit": {
      await requireOwned("habit", action.habitId, userId, tx);
      const on = parseCalendarDate(action.on) ?? todayUtcDate();
      // Completing twice in a day is a no-op, not an error.
      await tx.habitCompletion.upsert({
        where: { habitId_completedOn: { habitId: action.habitId, completedOn: on } },
        create: { habitId: action.habitId, userId, completedOn: on },
        update: {},
      });
      outcome.executed += 1;
      return;
    }

    case "create_note": {
      if (action.projectId) await requireOwned("project", action.projectId, userId, tx);
      const note = await tx.note.create({
        data: {
          userId,
          title: action.title,
          content: action.content,
          projectId: action.projectId,
        },
        select: { id: true, title: true },
      });
      outcome.created.push({ type: "note", id: note.id, label: note.title });
      outcome.executed += 1;
      return;
    }

    case "log_expense": {
      const currency = (action.currency ?? "USD").toUpperCase();
      const categoryId = await resolveOrCreateCategory(userId, action.categoryName, tx);
      // Currency drives the minor-unit exponent: JPY has none, BHD has three.
      // Converting every amount as if it were USD stores the wrong number.
      const amountMinor = toMinorUnits(action.amount, currency);
      assertSafeMinorUnits(amountMinor);

      const expense = await tx.expense.create({
        data: {
          userId,
          categoryId,
          description: action.description,
          amountMinor,
          currency,
          spentOn: parseCalendarDate(action.spentOn) ?? todayUtcDate(),
        },
        select: { id: true, description: true },
      });
      outcome.created.push({ type: "expense", id: expense.id, label: expense.description });
      outcome.executed += 1;
      return;
    }

    case "query":
      // Read-only: answered by the caller from the database, nothing to execute.
      outcome.notes.push(`Answered question: ${action.kind}`);
      return;
  }
}

export async function rejectPlan(userId: string, planId: string) {
  const plan = await db.aiCommandPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!plan) throw notFound("Plan");
  assertPlanUsable(plan);

  // Conditional update for the same reason execution uses one: concurrent
  // reject/execute must not both succeed.
  const rejected = await db.aiCommandPlan.updateMany({
    where: { id: plan.id, userId, status: "PENDING" },
    data: { status: "REJECTED" },
  });
  if (rejected.count === 0) throw badRequest("That plan has already been dealt with.");

  await recordAudit({
    userId,
    action: "AI_REJECT",
    entityType: "AiCommandPlan",
    entityId: plan.id,
    summary: "Plan rejected by user",
  });
}

function describe(action: ResolvedAction) {
  return action.type === "delete_task"
    ? { type: action.type, label: action.taskTitle }
    : { type: action.type, label: "" };
}

/** Midnight UTC for @db.Date columns, which carry no time component. */
function todayUtcDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
