import { db } from "@/lib/db";
import { requireOwned } from "@/lib/authz";
import { confirmationRequired, notFound } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { toMinorUnits } from "@/lib/money";
import { resolveOrCreateCategory, resolveOrCreateTags } from "./resolver";
import { assertPlanUsable, type ResolvedAction } from "./planner";
import { planIsDestructive } from "./actions";

/**
 * Executes a previously planned, validated, resolved command.
 *
 * Confirmation is enforced HERE, on the server. A plan flagged destructive
 * cannot run without `confirmed: true` on the execute request, so a client that
 * skips the dialog — or a crafted request that never rendered one — still gets
 * refused. UI wording is not a control.
 *
 * Ownership is re-verified for every stored id even though the planner already
 * checked it: rows can be deleted or reassigned between planning and
 * confirmation, and the plan is not a capability grant.
 */

export interface ExecutionOutcome {
  executed: number;
  created: { type: string; id: string; label: string }[];
  notes: string[];
}

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

  // Recomputed from the stored actions rather than trusting the persisted flag,
  // so a tampered `needsConfirm` column cannot bypass the gate.
  const destructive = plan.needsConfirm || planIsDestructive(actions as never);

  if (destructive && !confirmed) {
    throw confirmationRequired({
      planId: plan.id,
      summary: plan.summary,
      destructiveActions: actions.filter((a) => a.type === "delete_task").map(describe),
    });
  }

  const outcome: ExecutionOutcome = { executed: 0, created: [], notes: [] };

  for (const action of actions) {
    switch (action.type) {
      case "create_task": {
        if (action.projectId) await requireOwned("project", action.projectId, userId);
        const tagIds = await resolveOrCreateTags(userId, action.tagNames ?? []);

        const task = await db.task.create({
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
        break;
      }

      case "update_task": {
        await requireOwned("task", action.taskId, userId);
        if (action.projectId) await requireOwned("project", action.projectId, userId);
        await db.task.update({
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
        break;
      }

      case "complete_task": {
        await requireOwned("task", action.taskId, userId);
        await db.task.update({
          where: { id: action.taskId },
          data: { status: "DONE", completedAt: new Date() },
        });
        outcome.executed += 1;
        break;
      }

      case "delete_task": {
        await requireOwned("task", action.taskId, userId);
        await db.task.delete({ where: { id: action.taskId } });
        await recordAudit({
          userId,
          action: "DELETE",
          entityType: "Task",
          entityId: action.taskId,
          summary: `Task “${action.taskTitle}” deleted by AI command`,
        });
        outcome.executed += 1;
        break;
      }

      case "create_project": {
        const project = await db.project.create({
          data: {
            userId,
            name: action.name,
            description: action.description ?? null,
            priority: action.priority ?? "MEDIUM",
            dueDate: action.dueDate ? new Date(`${action.dueDate}T00:00:00Z`) : null,
            milestones: action.milestones?.length
              ? {
                  create: action.milestones.map((m, index) => ({
                    title: m.title,
                    targetDate: m.targetDate ? new Date(`${m.targetDate}T00:00:00Z`) : null,
                    sortOrder: (index + 1) * 1024,
                  })),
                }
              : undefined,
          },
          select: { id: true, name: true },
        });
        outcome.created.push({ type: "project", id: project.id, label: project.name });
        outcome.executed += 1;
        break;
      }

      case "create_goal": {
        const goal = await db.goal.create({
          data: {
            userId,
            title: action.title,
            description: action.description ?? null,
            targetDate: action.targetDate ? new Date(`${action.targetDate}T00:00:00Z`) : null,
            milestones: action.milestones?.length
              ? {
                  create: action.milestones.map((m, index) => ({
                    title: m.title,
                    targetDate: m.targetDate ? new Date(`${m.targetDate}T00:00:00Z`) : null,
                    sortOrder: (index + 1) * 1024,
                  })),
                }
              : undefined,
          },
          select: { id: true, title: true },
        });
        outcome.created.push({ type: "goal", id: goal.id, label: goal.title });
        outcome.executed += 1;
        break;
      }

      case "create_event": {
        const event = await db.event.create({
          data: {
            userId,
            title: action.title,
            startAt: new Date(action.startAt),
            endAt: new Date(action.endAt),
            location: action.location ?? null,
            allDay: action.allDay ?? false,
          },
          select: { id: true, title: true },
        });
        outcome.created.push({ type: "event", id: event.id, label: event.title });
        outcome.executed += 1;
        break;
      }

      case "complete_habit": {
        await requireOwned("habit", action.habitId, userId);
        const on = action.on ? new Date(`${action.on}T00:00:00Z`) : todayUtcDate();
        // Completing twice in a day is a no-op, not an error.
        await db.habitCompletion.upsert({
          where: { habitId_completedOn: { habitId: action.habitId, completedOn: on } },
          create: { habitId: action.habitId, userId, completedOn: on },
          update: {},
        });
        outcome.executed += 1;
        break;
      }

      case "create_note": {
        if (action.projectId) await requireOwned("project", action.projectId, userId);
        const note = await db.note.create({
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
        break;
      }

      case "log_expense": {
        const categoryId = await resolveOrCreateCategory(userId, action.categoryName);
        const expense = await db.expense.create({
          data: {
            userId,
            categoryId,
            description: action.description,
            amountMinor: toMinorUnits(action.amount),
            currency: action.currency ?? "USD",
            spentOn: action.spentOn ? new Date(`${action.spentOn}T00:00:00Z`) : todayUtcDate(),
          },
          select: { id: true, description: true },
        });
        outcome.created.push({ type: "expense", id: expense.id, label: expense.description });
        outcome.executed += 1;
        break;
      }

      case "query":
        // Read-only: answered by the caller from the database, nothing to execute.
        outcome.notes.push(`Answered question: ${action.kind}`);
        break;
    }
  }

  await db.aiCommandPlan.update({
    where: { id: plan.id },
    data: { status: "EXECUTED", executedAt: new Date(), result: outcome as never },
  });

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

export async function rejectPlan(userId: string, planId: string) {
  const plan = await db.aiCommandPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!plan) throw notFound("Plan");
  assertPlanUsable(plan);

  await db.aiCommandPlan.update({ where: { id: plan.id }, data: { status: "REJECTED" } });
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
