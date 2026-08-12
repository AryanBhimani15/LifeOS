import { db } from "@/lib/db";
import { requireOwned, type DbClient } from "@/lib/authz";
import { badRequest, confirmationRequired, notFound } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { assertSafeMinorUnits, toMinorUnits } from "@/lib/money";
import { parseCalendarDate, todayDateInZone } from "@/lib/dates";
import { answerQuery, type QueryAnswer } from "./queries";
import { resolveOrCreateCategory, resolveOrCreateTags } from "./resolver";
import { assertPlanUsable, type ResolvedAction } from "./planner";
import { planIsDestructive } from "./actions";
import { createTaskInTransaction } from "@/lib/repositories/tasks";

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
  /** Results for read-only `query` actions, answered from the database. */
  answers: QueryAnswer[];
}

/** Interactive transactions default to 5s; a plan may perform many writes. */
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export async function executePlan(
  userId: string,
  planId: string,
  confirmed: boolean,
  idempotencyKey?: string,
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
      result: true,
      idempotencyKey: true,
    },
  });
  if (!plan) throw notFound("Plan");

  // A retry after a dropped response: the work already happened, so replay the
  // stored outcome rather than reporting an error for a request that succeeded.
  // The mutation itself was never at risk — the conditional claim below makes
  // double execution impossible — but the client cannot know that.
  if (
    idempotencyKey &&
    plan.status === "EXECUTED" &&
    plan.idempotencyKey === idempotencyKey &&
    plan.result
  ) {
    return plan.result as unknown as ExecutionOutcome;
  }

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

  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const timeZone = settings?.timezone ?? "UTC";

  const outcome = await db.$transaction(async (tx) => {
    // Atomic claim. The conditional update locks the row, so a concurrent
    // execute blocks here and then matches zero rows once we commit.
    const claimed = await tx.aiCommandPlan.updateMany({
      where: { id: plan.id, userId, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "EXECUTED", executedAt: new Date(), idempotencyKey: idempotencyKey ?? null },
    });
    if (claimed.count === 0) {
      throw badRequest("That plan has already been dealt with.");
    }

    const result: ExecutionOutcome = { executed: 0, created: [], notes: [], answers: [] };
    for (const action of actions) {
      await runAction(tx, userId, action, result, timeZone);
    }

    await tx.aiCommandPlan.update({
      where: { id: plan.id },
      data: { result: result as never },
    });

    return result;
  }, TRANSACTION_OPTIONS);

  // Read-only questions are answered AFTER the transaction commits, so they see
  // the writes this plan just made rather than the pre-transaction snapshot.
  for (const action of actions) {
    if (action.type === "query") {
      outcome.answers.push(await answerQuery(userId, action.kind));
    }
  }

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
  timeZone: string,
): Promise<void> {
  switch (action.type) {
    case "create_task": {
      const tagIds = await resolveOrCreateTags(userId, action.tagNames ?? [], tx);
      const task = await createTaskInTransaction(tx, userId, {
        title: action.title,
        description: action.description ?? null,
        status: "TODO",
        priority: action.priority ?? "MEDIUM",
        dueAt: action.dueAt ? new Date(action.dueAt) : null,
        dueHasTime: Boolean(action.dueAt),
        projectId: action.projectId,
        parentId: null,
        tagIds,
      });
      for (const title of action.subtasks ?? []) {
        await createTaskInTransaction(tx, userId, {
          title,
          status: "TODO",
          priority: "MEDIUM",
          parentId: task.id,
          projectId: null,
          tagIds: [],
        });
      }
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
      const on = parseCalendarDate(action.on) ?? todayDateInZone(timeZone);
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
      const currency = (action.currency ?? "INR").toUpperCase();
      const categoryId = await resolveOrCreateCategory(userId, action.categoryName, tx);
      // Currency drives the minor-unit exponent: JPY has none, BHD has three.
      // Converting every amount as if it were USD stores the wrong number.
      const amountMinor = toMinorUnits(action.amount, currency);
      try {
        assertSafeMinorUnits(amountMinor);
      } catch {
        // A plain Error here would surface as a generic 500 and leave the plan
        // permanently unexecutable with no explanation.
        throw badRequest(
          `That amount is too large to record in ${currency}. Please split it into smaller entries.`,
        );
      }

      const expense = await tx.expense.create({
        data: {
          userId,
          categoryId,
          description: action.description,
          amountMinor,
          currency,
          spentOn: parseCalendarDate(action.spentOn) ?? todayDateInZone(timeZone),
        },
        select: { id: true, description: true },
      });
      outcome.created.push({ type: "expense", id: expense.id, label: expense.description });
      outcome.executed += 1;
      return;
    }

    case "query":
      // Answered after the transaction commits — see executePlan.
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
