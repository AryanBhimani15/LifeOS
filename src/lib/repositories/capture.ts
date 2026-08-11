import { db } from "@/lib/db";
import { toMinorUnits, assertSafeMinorUnits } from "@/lib/money";
import { todayDateInZone } from "@/lib/dates";
import { badRequest } from "@/lib/errors";
import { extractAmount, tidyTitle, type CaptureInput } from "@/lib/validation/capture";

/**
 * Direct capture, no AI in the path.
 *
 * The user has already told us the type by tapping a button, so there is
 * nothing to interpret. That makes capture free, instant, and immune to the AI
 * being rate limited — which is exactly the failure that motivated it.
 */

export interface CaptureResult {
  type: CaptureInput["type"];
  id: string;
  label: string;
  /** Shown back to the user so an imperfect guess is visible, not hidden. */
  detail?: string;
}

export async function capture(userId: string, input: CaptureInput): Promise<CaptureResult> {
  const title = tidyTitle(input.text);

  switch (input.type) {
    case "task": {
      const task = await db.task.create({
        data: {
          userId,
          title: title.slice(0, 200),
          dueAt: input.dueAt ?? null,
          priority: input.priority ?? "MEDIUM",
          boardOrder: Date.now() % 1_000_000,
        },
        select: { id: true, title: true, dueAt: true },
      });
      return {
        type: "task",
        id: task.id,
        label: task.title,
        detail: task.dueAt ? `due ${task.dueAt.toISOString().slice(0, 10)}` : undefined,
      };
    }

    case "goal": {
      const goal = await db.goal.create({
        data: {
          userId,
          title: title.slice(0, 200),
          targetDate: input.dueAt ?? null,
        },
        select: { id: true, title: true },
      });
      return { type: "goal", id: goal.id, label: goal.title };
    }

    case "project": {
      const project = await db.project.create({
        data: { userId, name: title.slice(0, 150), dueDate: input.dueAt ?? null },
        select: { id: true, name: true },
      });
      return { type: "project", id: project.id, label: project.name };
    }

    case "note": {
      // The first line becomes the title, the whole text stays as the body, so
      // nothing spoken is lost to truncation.
      const firstLine = title.split(/[.\n]/)[0]!.trim() || title;
      const note = await db.note.create({
        data: {
          userId,
          title: firstLine.slice(0, 200),
          content: input.text.trim(),
        },
        select: { id: true, title: true },
      });
      return { type: "note", id: note.id, label: note.title };
    }

    case "expense": {
      const settings = await db.userSettings.findUnique({
        where: { userId },
        select: { currency: true, timezone: true },
      });
      const parsed = extractAmount(input.text);
      const currency = parsed?.currency ?? settings?.currency ?? "USD";
      const amountMinor = parsed ? toMinorUnits(parsed.amountMajor, currency) : 0;

      try {
        assertSafeMinorUnits(amountMinor);
      } catch {
        throw badRequest("That amount is too large to record.");
      }

      const expense = await db.expense.create({
        data: {
          userId,
          description: title.slice(0, 200),
          amountMinor,
          currency,
          spentOn: todayDateInZone(settings?.timezone ?? "UTC"),
        },
        select: { id: true, description: true },
      });

      return {
        type: "expense",
        id: expense.id,
        label: expense.description,
        // Said plainly so a missing amount is obvious rather than silently zero.
        detail: parsed
          ? `${currency} ${parsed.amountMajor}`
          : "no amount detected — edit it on the web app",
      };
    }
  }
}
